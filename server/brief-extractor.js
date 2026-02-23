import { briefFieldKeys, briefFieldPatterns, explicitBriefFieldAliasMap } from './domain/brief-schema.js';

function normalizeContent(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function splitCandidateStatements(text = '') {
  return String(text || '')
    .split(/\n|[•*-]\s+|\d+\.\s+|;+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeHistoryInput({ transcript = '', messages = null } = {}) {
  const safeMessages = Array.isArray(messages) ? messages : null;
  const hasMessageObjects = safeMessages
    ? safeMessages.every(
        (message) =>
          message &&
          typeof message === 'object' &&
          typeof message.role === 'string' &&
          typeof message.content === 'string'
      )
    : false;

  const messageHistory = hasMessageObjects
    ? safeMessages
    : String(transcript || '').trim()
      ? [{ role: 'user', content: String(transcript || '').trim() }]
      : [];

  const transcriptText =
    String(transcript || '').trim() ||
    messageHistory.map((message) => `${message.role}: ${message.content}`).join('\n');

  return { messageHistory, transcriptText, hasMessageObjects };
}

function extractUserTurnsFromTranscript(transcript = '') {
  const lines = String(transcript || '').split(/\r?\n/);
  const turns = [];
  let currentRole = null;
  let buffer = [];

  const flush = () => {
    if (!currentRole) return;
    const content = buffer.join('\n').trim();
    if (content) turns.push({ role: currentRole, content });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const roleMatch = line.match(/^(user|assistant)\s*:\s*(.*)$/i);
    if (roleMatch) {
      flush();
      currentRole = roleMatch[1].toLowerCase();
      buffer = [roleMatch[2] || ''];
      continue;
    }

    if (currentRole) {
      buffer.push(rawLine);
    }
  }

  flush();

  if (!turns.length && transcript.trim()) {
    return [{ role: 'user', content: transcript.trim() }];
  }

  return turns;
}

function detectField(statement) {
  const normalized = normalizeContent(statement);
  const explicitMatch = normalized.match(/^(.+?)\s*:\s*(.+)$/i);

  if (explicitMatch) {
    const explicitKey = explicitMatch[1].toLowerCase().trim();
    return {
      key: explicitBriefFieldAliasMap[explicitKey] || null,
      value: explicitMatch[2].trim(),
      explicit: Boolean(explicitBriefFieldAliasMap[explicitKey])
    };
  }

  for (const key of briefFieldKeys) {
    if (hasAny(normalized, briefFieldPatterns[key])) {
      return { key, value: statement.trim(), explicit: false };
    }
  }

  return { key: null, value: null, explicit: false };
}

function extractHeuristicBrief(transcript = '') {
  const turns = extractUserTurnsFromTranscript(transcript);
  const userTurns = turns.filter((turn) => turn.role === 'user');
  const collected = Object.fromEntries(briefFieldKeys.map((key) => [key, []]));

  userTurns.forEach((turn, turnIndex) => {
    splitCandidateStatements(turn.content).forEach((statement, statementIndex) => {
      const { key, value, explicit } = detectField(statement);
      if (!key || !value) return;
      collected[key].push({
        value,
        turnIndex,
        statementIndex,
        explicit,
        normalized: normalizeContent(value)
      });
    });
  });

  const fields = {};
  const unresolvedConflicts = [];

  briefFieldKeys.forEach((key) => {
    const values = collected[key] || [];
    if (!values.length) {
      fields[key] = {
        value: null,
        confidence: 0,
        source: 'heuristic',
        assumptions: ['No direct user evidence found for this field.']
      };
      return;
    }

    const selected = values[values.length - 1];
    const uniqueValues = [...new Set(values.map((entry) => entry.normalized))];
    const sameTurnValues = values.filter((entry) => entry.turnIndex === selected.turnIndex);

    fields[key] = {
      value: selected.value,
      confidence: selected.explicit ? 0.72 : 0.48,
      source: 'heuristic',
      assumptions: selected.explicit ? [] : ['Inferred from nearby phrasing using heuristic pattern matching.']
    };

    if (uniqueValues.length > 1 && sameTurnValues.length > 1) {
      unresolvedConflicts.push({
        field: key,
        selectedValue: selected.value,
        reason: 'Multiple competing values in the latest user turn.',
        candidates: sameTurnValues.map((entry) => entry.value)
      });
    }
  });

  return { fields, unresolvedConflicts };
}

function stripJsonCodeFence(text = '') {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : trimmed;
}

function parseNormalizerResponse(rawResponse = '') {
  if (!rawResponse) return null;

  const candidate = stripJsonCodeFence(rawResponse);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function buildNormalizerPrompt(transcript) {
  return [
    'Normalize this conversation into a strict brief JSON object.',
    'Infer missing fields from natural language intent (not only explicit labels).',
    'Keep uncertainty explicit with confidence and assumptions for inferred values.',
    'Return JSON only with this exact shape:',
    JSON.stringify(
      {
        fields: Object.fromEntries(
          briefFieldKeys.map((key) => [key, { value: null, confidence: 0, assumptions: [] }])
        ),
        unresolvedConflicts: [
          { field: 'objective', reason: 'short explanation', candidates: ['candidate 1', 'candidate 2'] }
        ],
        globalAssumptions: ['assumption']
      },
      null,
      2
    ),
    'Rules:',
    '- confidence must be a number between 0 and 1.',
    '- assumptions should explain inferred or uncertain interpretations.',
    '- If field is unknown, set value = null and confidence = 0 with one assumption.',
    '',
    `Transcript:\n${transcript}`
  ].join('\n');
}

function mergeField(heuristicField, llmField) {
  const heuristicConfidence = Number(heuristicField?.confidence || 0);
  const llmConfidence = Number(llmField?.confidence || 0);
  const llmValue = llmField?.value ?? null;

  if (llmValue && llmConfidence >= heuristicConfidence * 0.9) {
    return {
      value: llmValue,
      confidence: Math.max(0, Math.min(1, llmConfidence)),
      source: 'llm',
      assumptions: Array.isArray(llmField?.assumptions) ? llmField.assumptions : []
    };
  }

  return {
    value: heuristicField?.value ?? null,
    confidence: Math.max(0, Math.min(1, heuristicConfidence)),
    source: 'heuristic',
    assumptions: Array.isArray(heuristicField?.assumptions) ? heuristicField.assumptions : []
  };
}

export async function extractBrief({ transcript = '', messages = null, normalizeWithModel } = {}) {
  const { transcriptText } = normalizeHistoryInput({ transcript, messages });
  const heuristic = extractHeuristicBrief(transcriptText);

  const response = {
    fields: Object.fromEntries(briefFieldKeys.map((key) => [key, heuristic.fields[key]])),
    brief: Object.fromEntries(briefFieldKeys.map((key) => [key, heuristic.fields[key].value])),
    unresolvedConflicts: [...heuristic.unresolvedConflicts],
    globalAssumptions: [],
    normalizationMethod: 'heuristic_fallback'
  };

  if (typeof normalizeWithModel !== 'function') {
    return response;
  }

  try {
    const llmRaw = await normalizeWithModel(buildNormalizerPrompt(transcriptText));
    const parsed = parseNormalizerResponse(llmRaw);
    if (!parsed || typeof parsed !== 'object') {
      return response;
    }

    briefFieldKeys.forEach((key) => {
      response.fields[key] = mergeField(heuristic.fields[key], parsed?.fields?.[key]);
      response.brief[key] = response.fields[key].value;
    });

    response.unresolvedConflicts = [
      ...heuristic.unresolvedConflicts,
      ...(Array.isArray(parsed?.unresolvedConflicts) ? parsed.unresolvedConflicts : [])
    ];
    response.globalAssumptions = Array.isArray(parsed?.globalAssumptions) ? parsed.globalAssumptions : [];
    response.normalizationMethod = 'llm_assisted';
    return response;
  } catch {
    return response;
  }
}

export { briefFieldKeys, normalizeHistoryInput };
