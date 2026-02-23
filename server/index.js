import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { coachingSystemPrompt, finalPromptSystemPrompt } from './prompts.js';

const app = express();
const port = process.env.PORT || 8787;
const groqApiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const STAGE_DEFINITIONS = {
  objective: {
    key: 'objective',
    label: 'Objective',
    required: true,
    requiredFields: ['task', 'successOutcome'],
    doneCriteria:
      'Complete when the user clearly states what they want the model to do and what a successful result looks like.',
    followUpQuestion:
      'What exact outcome do you want, and how will you judge whether the answer is successful?'
  },
  audience: {
    key: 'audience',
    label: 'Audience',
    required: true,
    requiredFields: ['readerOrUser', 'skillLevelOrRole'],
    doneCriteria:
      'Complete when the intended audience or end-user is named, including role, expertise level, or context.',
    followUpQuestion:
      'Who is the output for (role/experience level), and what do they already know?'
  },
  contextData: {
    key: 'contextData',
    label: 'Context/Data',
    required: true,
    requiredFields: ['background', 'inputsOrSources'],
    doneCriteria:
      'Complete when the user provides relevant background, source material, or data the model should use.',
    followUpQuestion:
      'What background information, source material, or data should the model use?'
  },
  constraints: {
    key: 'constraints',
    label: 'Constraints',
    required: true,
    requiredFields: ['limits', 'nonGoalsOrBoundaries'],
    doneCriteria:
      'Complete when hard constraints are clear (scope, tone, length, boundaries, or forbidden content).',
    followUpQuestion:
      'What constraints should I enforce (length, tone, boundaries, must/avoid requirements)?'
  },
  outputFormat: {
    key: 'outputFormat',
    label: 'Output Format',
    required: true,
    requiredFields: ['structure', 'deliveryStyle'],
    doneCriteria:
      'Complete when expected output structure is explicit (format, sections, bullets/table/json, etc.).',
    followUpQuestion:
      'How should the final answer be formatted (for example: bullets, table, JSON schema, sections)?'
  },
  qualityBar: {
    key: 'qualityBar',
    label: 'Quality Bar',
    required: false,
    requiredFields: ['evaluationCriteria'],
    doneCriteria:
      'Complete when measurable quality criteria are provided (accuracy, depth, citations, checklist, edge cases).',
    followUpQuestion:
      'What quality bar should the response meet (e.g., depth, accuracy checks, citation style, acceptance criteria)?'
  },
  examples: {
    key: 'examples',
    label: 'Examples',
    required: false,
    requiredFields: ['sampleInputOrOutput'],
    doneCriteria:
      'Complete when there is at least one example of desired (or undesired) input/output style.',
    followUpQuestion:
      'Do you have an example of a good output (or a bad one to avoid) so I can match style and quality?'
  }
};

const REQUIRED_STAGE_KEYS = Object.values(STAGE_DEFINITIONS)
  .filter((stage) => stage.required)
  .map((stage) => stage.key);

const MIN_COMPLETENESS_THRESHOLD = 0.72;

const BRIEF_SCHEMA_KEYS = [
  'objective',
  'audience',
  'context',
  'constraints',
  'nonGoals',
  'outputFormat',
  'tone',
  'examples',
  'acceptanceCriteria'
];

const BRIEF_FIELD_PATTERNS = {
  objective: [/\bobjective\b/, /\bgoal\b/, /\bi need\b/, /\bi want\b/, /\btask\b/],
  audience: [/\baudience\b/, /\bfor\b/, /\btarget\b/, /\breaders?\b/, /\busers?\b/],
  context: [/\bcontext\b/, /\bbackground\b/, /\bsource\b/, /\bdata\b/, /\binput\b/],
  constraints: [/\bconstraint\b/, /\bmust\b/, /\bshould\b/, /\blimit\b/, /\bavoid\b/],
  nonGoals: [/\bnon-goals?\b/, /\bout of scope\b/, /\bdo not\b/, /\bdon't\b/, /\bnot include\b/],
  outputFormat: [/\boutput\s*format\b/, /\bformat\b/, /\bjson\b/, /\bmarkdown\b/, /\btable\b/],
  tone: [/\btone\b/, /\bvoice\b/, /\bstyle\b/, /\bformal\b/, /\bcasual\b/],
  examples: [/\bexample\b/, /\bsample\b/, /\bfew-shot\b/, /\blike this\b/],
  acceptanceCriteria: [/\bacceptance\s*criteria\b/, /\bsuccess\s*criteria\b/, /\bdefinition of done\b/, /\bquality bar\b/]
};

function normalizeContent(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extractUserTurnsFromTranscript(transcript = '') {
  const lines = String(transcript || '').split(/\r?\n/);
  const turns = [];
  let currentRole = null;
  let buffer = [];

  const flush = () => {
    if (!currentRole) return;
    const content = buffer.join('\n').trim();
    if (content) {
      turns.push({ role: currentRole, content });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const roleMatch = line.match(/^(user|assistant)\s*:\s*(.*)$/i);
    if (roleMatch) {
      flush();
      currentRole = roleMatch[1].toLowerCase();
      buffer = [roleMatch[2] || ''];
    } else if (currentRole) {
      buffer.push(rawLine);
    }
  }

  flush();

  if (!turns.length && transcript.trim()) {
    return [{ role: 'user', content: transcript.trim() }];
  }

  return turns;
}

function splitCandidateStatements(text = '') {
  return text
    .split(/\n|[•*-]\s+|\d+\.\s+|;+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectField(statement) {
  const normalized = normalizeContent(statement);
  const explicitMatch = normalized.match(
    /^(objective|audience|context|constraints|non-goals?|non goals|output format|tone|examples?|acceptance criteria)\s*:\s*(.+)$/i
  );

  if (explicitMatch) {
    const explicitKey = explicitMatch[1].toLowerCase();
    const explicitMap = {
      objective: 'objective',
      audience: 'audience',
      context: 'context',
      constraints: 'constraints',
      'non-goal': 'nonGoals',
      'non-goals': 'nonGoals',
      'non goals': 'nonGoals',
      'output format': 'outputFormat',
      tone: 'tone',
      example: 'examples',
      examples: 'examples',
      'acceptance criteria': 'acceptanceCriteria'
    };
    return {
      key: explicitMap[explicitKey] || null,
      value: explicitMatch[2].trim()
    };
  }

  for (const key of BRIEF_SCHEMA_KEYS) {
    if (hasAny(normalized, BRIEF_FIELD_PATTERNS[key])) {
      return { key, value: statement.trim() };
    }
  }

  return { key: null, value: null };
}

export function extractBriefFromTranscript(transcript = '') {
  const turns = extractUserTurnsFromTranscript(transcript);
  const userTurns = turns.filter((turn) => turn.role === 'user');

  const collected = Object.fromEntries(BRIEF_SCHEMA_KEYS.map((key) => [key, []]));

  userTurns.forEach((turn, turnIndex) => {
    const statements = splitCandidateStatements(turn.content);
    statements.forEach((statement, statementIndex) => {
      const { key, value } = detectField(statement);
      if (!key || !value) return;
      collected[key].push({
        value,
        turnIndex,
        statementIndex,
        normalized: normalizeContent(value)
      });
    });
  });

  const brief = {};
  const conflicts = [];

  BRIEF_SCHEMA_KEYS.forEach((key) => {
    const values = collected[key];
    if (!values.length) {
      brief[key] = null;
      return;
    }

    const uniqueValues = [...new Set(values.map((entry) => entry.normalized))];
    const selected = values[values.length - 1];
    brief[key] = selected.value;

    const hasAmbiguousLatestTurn =
      values.filter((entry) => entry.turnIndex === selected.turnIndex).length > 1;
    if (uniqueValues.length > 1 && hasAmbiguousLatestTurn) {
      conflicts.push({
        field: key,
        selectedValue: selected.value,
        reason: 'Multiple competing values in the latest user turn.',
        candidates: values
          .filter((entry) => entry.turnIndex === selected.turnIndex)
          .map((entry) => entry.value)
      });
    }
  });

  return {
    brief,
    unresolvedConflicts: conflicts
  };
}

function getUserTextFromHistory(history = []) {
  return history
    .filter((message) => message?.role === 'user')
    .map((message) => message?.content || '')
    .join('\n')
    .toLowerCase();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function inspectConversationStages(history = []) {
  const userText = getUserTextFromHistory(history);

  const stageChecks = {
    objective:
      userText.length > 30 &&
      hasAny(userText, [
        /\b(i need|i want|goal|objective|task|build|create|write|generate|help me)\b/,
        /\bso that\b|\boutcome\b|\bsuccess\b/
      ]),
    audience: hasAny(userText, [
      /\baudience\b/,
      /\bfor\s+(developers|engineers|students|executives|customers|users|beginners|experts|children|managers|team)\b/,
      /\bpersona\b|\breader\b|\bend user\b|\bstakeholder\b/
    ]),
    contextData: hasAny(userText, [
      /\bcontext\b|\bbackground\b|\bdata\b|\bdataset\b|\bsource\b|\btranscript\b|\bdocs?\b|\bnotes\b/,
      /\bhere is\b|\binput\b|\breference\b/
    ]),
    constraints: hasAny(userText, [
      /\bmust\b|\bshould\b|\bavoid\b|\bdon't\b|\bdo not\b|\bno\b|\blimit\b|\bconstraint\b|\bunder\b\s*\d+\s*(words?|tokens?)/,
      /\btone\b|\bstyle\b|\bdeadline\b|\bscope\b|\bnon-goal\b|\bnot include\b/
    ]),
    outputFormat: hasAny(userText, [
      /\bformat\b|\bjson\b|\bmarkdown\b|\btable\b|\bbullets?\b|\bsections?\b|\btemplate\b|\bstructure\b|\bheadings?\b/
    ]),
    qualityBar: hasAny(userText, [
      /\bquality\b|\baccurac(y|te)\b|\bcriteria\b|\bchecklist\b|\bevaluate\b|\bself-critique\b|\bmeasure\b|\bacceptance\b/
    ]),
    examples: hasAny(userText, [
      /\bexample\b|\bsample\b|\blike this\b|\bsuch as\b|\bfew-shot\b|\binput\/output\b/
    ])
  };

  const stages = Object.values(STAGE_DEFINITIONS).map((definition) => ({
    ...definition,
    complete: Boolean(stageChecks[definition.key])
  }));

  const completedRequired = stages.filter((stage) => stage.required && stage.complete).length;
  const requiredTotal = REQUIRED_STAGE_KEYS.length;
  const optionalTotal = stages.length - requiredTotal;
  const completedOptional = stages.filter((stage) => !stage.required && stage.complete).length;

  const requiredCompleteness = requiredTotal ? completedRequired / requiredTotal : 1;
  const overallCompleteness =
    (completedRequired + completedOptional * 0.5) / (requiredTotal + optionalTotal * 0.5);

  return {
    stages,
    completedRequired,
    requiredTotal,
    requiredCompleteness,
    overallCompleteness,
    missingRequiredStageKeys: stages.filter((stage) => stage.required && !stage.complete).map((s) => s.key),
    canGenerateFinalPrompt: requiredCompleteness >= MIN_COMPLETENESS_THRESHOLD
  };
}

function buildFollowUpMessage(progress) {
  const missingRequiredStages = progress.stages.filter((stage) => stage.required && !stage.complete);
  const nextQuestions = missingRequiredStages.slice(0, 2).map((stage) => `- ${stage.followUpQuestion}`);

  if (!nextQuestions.length) {
    return null;
  }

  return [
    "Great start. Before we generate the final prompt, I still need a bit more detail:",
    ...nextQuestions,
    'Reply with short bullet points and I will assemble the final prompt-ready specification.'
  ].join('\n');
}

async function callGroq(messages) {
  if (!groqApiKey) {
    throw new Error('Missing GROQ_API_KEY. Add it to .env file.');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.5
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Groq API error (${response.status}): ${raw}`);
  }

  const payload = await response.json();
  return payload.choices?.[0]?.message?.content?.trim() || '';
}

app.post('/api/chat', async (req, res) => {
  try {
    const incoming = req.body.messages || [];
    const progress = inspectConversationStages(incoming);

    const followUp = buildFollowUpMessage(progress);
    let reply = '';

    if (followUp) {
      reply = followUp;
    } else {
      const messages = [{ role: 'system', content: coachingSystemPrompt }, ...incoming];
      reply = await callGroq(messages);
    }

    res.json({
      reply,
      stageProgress: {
        minCompletenessThreshold: MIN_COMPLETENESS_THRESHOLD,
        canGenerateFinalPrompt: progress.canGenerateFinalPrompt,
        requiredCompleteness: Number(progress.requiredCompleteness.toFixed(3)),
        overallCompleteness: Number(progress.overallCompleteness.toFixed(3)),
        completedRequired: progress.completedRequired,
        requiredTotal: progress.requiredTotal,
        stages: progress.stages.map((stage) => ({
          key: stage.key,
          label: stage.label,
          required: stage.required,
          requiredFields: stage.requiredFields,
          doneCriteria: stage.doneCriteria,
          complete: stage.complete
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate-prompt', async (req, res) => {
  try {
    const transcript = normalizeContent(req.body.transcript || '');
    const messagesForInspection = req.body.messages || [
      {
        role: 'user',
        content: transcript
      }
    ];
    const progress = inspectConversationStages(messagesForInspection);

    if (!progress.canGenerateFinalPrompt) {
      return res.status(400).json({
        error:
          'Not enough information to generate a final prompt yet. Fill in more required stages first.',
        stageProgress: {
          minCompletenessThreshold: MIN_COMPLETENESS_THRESHOLD,
          canGenerateFinalPrompt: false,
          requiredCompleteness: Number(progress.requiredCompleteness.toFixed(3)),
          overallCompleteness: Number(progress.overallCompleteness.toFixed(3)),
          missingRequiredStageKeys: progress.missingRequiredStageKeys,
          stages: progress.stages.map((stage) => ({
            key: stage.key,
            label: stage.label,
            required: stage.required,
            requiredFields: stage.requiredFields,
            doneCriteria: stage.doneCriteria,
            complete: stage.complete
          }))
        }
      });
    }

    const briefExtraction = extractBriefFromTranscript(req.body.transcript || '');

    const messages = [
      { role: 'system', content: finalPromptSystemPrompt },
      {
        role: 'user',
        content: `Normalized brief JSON:\n${JSON.stringify(briefExtraction.brief, null, 2)}\n\nUnresolved conflicts:\n${JSON.stringify(briefExtraction.unresolvedConflicts, null, 2)}`
      }
    ];
    const prompt = await callGroq(messages);
    return res.json({
      brief: {
        ...briefExtraction.brief,
        unresolvedConflicts: briefExtraction.unresolvedConflicts
      },
      prompt,
      stageProgress: {
        minCompletenessThreshold: MIN_COMPLETENESS_THRESHOLD,
        canGenerateFinalPrompt: true,
        requiredCompleteness: Number(progress.requiredCompleteness.toFixed(3)),
        overallCompleteness: Number(progress.overallCompleteness.toFixed(3))
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Prompt Builder API listening on http://localhost:${port}`);
});
