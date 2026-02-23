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

function segmentTurns(transcript = '') {
  return extractUserTurnsFromTranscript(transcript).filter((turn) => turn.role === 'user');
}

function extractCandidatesFromTurns(turns = []) {
  return turns.flatMap((turn, turnIndex) =>
    splitCandidateStatements(turn.content).map((statement, statementIndex) => ({
      statement,
      turnIndex,
      statementIndex,
      normalized: normalizeContent(statement)
    }))
  );
}

function detectImplicitField(statement, normalized) {
  if (/\bfor\s+(?:new|first[-\s]?time|beginner|beginners|executives?|managers?|students?|engineers?|admins?|leaders?|teams?|customers?|users?)\b/.test(normalized)) {
    return { key: 'audience', explicit: false, value: statement.trim(), implicit: true };
  }

  if (/\b(based on|using|from|given)\b/.test(normalized) && /\b(data|doc|docs|document|documents|transcript|report|notes?|dataset|source|background|input)\b/.test(normalized)) {
    return { key: 'context', explicit: false, value: statement.trim(), implicit: true };
  }

  return null;
}

function detectField(statement, normalized = normalizeContent(statement)) {
  const explicitMatch = statement.match(/^(.+?)\s*:\s*(.+)$/i);

  if (explicitMatch) {
    const explicitKey = explicitMatch[1].toLowerCase().trim();
    return {
      key: explicitBriefFieldAliasMap[explicitKey] || null,
      value: explicitMatch[2].trim(),
      explicit: Boolean(explicitBriefFieldAliasMap[explicitKey]),
      implicit: false
    };
  }

  if (/\bnon[-\s]?goals?\b|\bout of scope\b/.test(normalized)) {
    return { key: 'nonGoals', value: statement.trim(), explicit: false, implicit: false };
  }

  if (/\bconstraints?\b|\bno limits?\b/.test(normalized)) {
    return { key: 'constraints', value: statement.trim(), explicit: false, implicit: false };
  }

  for (const key of briefFieldKeys) {
    if (hasAny(normalized, briefFieldPatterns[key])) {
      const implicitHint =
        (key === 'audience' || key === 'context') &&
        Boolean(detectImplicitField(statement, normalized)?.key === key);
      return { key, value: statement.trim(), explicit: false, implicit: implicitHint };
    }
  }

  return detectImplicitField(statement, normalized) || { key: null, value: null, explicit: false, implicit: false };
}

function detectFieldNegation(fieldKey, normalizedStatement) {
  if (fieldKey === 'constraints') {
    return /\b(no|without|not)\s+(hard\s+)?constraints?\b/.test(normalizedStatement) || /\bno limits?\b/.test(normalizedStatement);
  }

  if (fieldKey === 'nonGoals') {
    return /\b(no|without|not)\s+non[-\s]?goals?\b/.test(normalizedStatement) || /\bnothing\s+is\s+out\s+of\s+scope\b/.test(normalizedStatement);
  }

  return false;
}

function classifyFieldCandidates(candidates = []) {
  const byField = Object.fromEntries(briefFieldKeys.map((key) => [key, []]));

  candidates.forEach((candidate) => {
    const detection = detectField(candidate.statement, candidate.normalized);
    if (!detection.key || !detection.value) return;

    byField[detection.key].push({
      ...candidate,
      key: detection.key,
      value: detection.value,
      explicit: detection.explicit,
      implicit: detection.implicit,
      negated: detectFieldNegation(detection.key, candidate.normalized),
      normalizedValue: normalizeContent(detection.value)
    });
  });

  return byField;
}

function clampConfidence(value) {
  return Math.max(0, Math.min(1, value));
}

const fieldConfidenceCalibrators = {
  objective: ({ selected, hasConflict }) => clampConfidence((selected.explicit ? 0.82 : 0.6) - (hasConflict ? 0.16 : 0)),
  audience: ({ selected, hasConflict }) =>
    clampConfidence((selected.explicit ? 0.78 : selected.implicit ? 0.58 : 0.5) - (hasConflict ? 0.14 : 0)),
  context: ({ selected, hasConflict }) =>
    clampConfidence((selected.explicit ? 0.76 : selected.implicit ? 0.56 : 0.48) - (hasConflict ? 0.14 : 0)),
  constraints: ({ selected, hasConflict }) =>
    clampConfidence((selected.explicit ? 0.8 : 0.63) - (selected.negated ? 0.08 : 0) - (hasConflict ? 0.12 : 0)),
  nonGoals: ({ selected, hasConflict }) =>
    clampConfidence((selected.explicit ? 0.78 : 0.62) - (selected.negated ? 0.08 : 0) - (hasConflict ? 0.12 : 0)),
  outputFormat: ({ selected, hasConflict }) => clampConfidence((selected.explicit ? 0.8 : 0.55) - (hasConflict ? 0.12 : 0)),
  tone: ({ selected, hasConflict }) => clampConfidence((selected.explicit ? 0.72 : 0.5) - (hasConflict ? 0.12 : 0)),
  examples: ({ selected, hasConflict }) => clampConfidence((selected.explicit ? 0.74 : 0.5) - (hasConflict ? 0.12 : 0)),
  acceptanceCriteria: ({ selected, hasConflict }) =>
    clampConfidence((selected.explicit ? 0.75 : 0.52) - (hasConflict ? 0.12 : 0))
};

function resolveFieldConflicts(classifiedByField = {}) {
  const fields = {};
  const unresolvedConflicts = [];

  briefFieldKeys.forEach((key) => {
    const values = classifiedByField[key] || [];

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
    const hasPolarityConflict = values.some((entry) => entry.negated !== selected.negated);
    const uniqueValues = [...new Set(values.filter((entry) => !entry.negated).map((entry) => entry.normalizedValue))];
    const hasValueConflict = uniqueValues.length > 1;
    const hasConflict = hasPolarityConflict || hasValueConflict;

    if (selected.negated && (key === 'constraints' || key === 'nonGoals')) {
      fields[key] = {
        value: null,
        confidence: fieldConfidenceCalibrators[key]({ selected, hasConflict }),
        source: 'heuristic',
        assumptions: ['Latest user turn explicitly negates this field.']
      };
    } else {
      const assumptions = [];
      if (!selected.explicit) {
        assumptions.push(selected.implicit ? 'Inferred from implicit phrasing in user statements.' : 'Inferred from nearby phrasing using heuristic pattern matching.');
      }

      fields[key] = {
        value: selected.value,
        confidence: fieldConfidenceCalibrators[key]({ selected, hasConflict }),
        source: 'heuristic',
        assumptions
      };
    }

    if (hasConflict) {
      unresolvedConflicts.push({
        field: key,
        selectedValue: fields[key].value,
        reason: hasPolarityConflict
          ? 'Contradictory statements across turns (affirmed vs negated). Latest user statement was prioritized.'
          : 'Multiple competing values observed across turns. Latest user statement was prioritized.',
        candidates: values.map((entry) => entry.value)
      });
    }
  });

  return { fields, unresolvedConflicts };
}

function extractHeuristicBrief(transcript = '') {
  const turns = segmentTurns(transcript);
  const candidates = extractCandidatesFromTurns(turns);
  const classified = classifyFieldCandidates(candidates);
  return resolveFieldConflicts(classified);
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
