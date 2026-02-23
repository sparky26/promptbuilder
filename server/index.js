import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { coachingSystemPrompt, finalPromptSystemPrompt } from './prompts.js';
import { normalizeHistoryInput } from './brief-extractor.js';
import { buildNormalizedBrief } from './brief-service.js';

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

function inspectConversationStages(briefExtraction) {
  const field = (key) => briefExtraction?.fields?.[key] || { value: null, confidence: 0 };
  const hasHighConfidence = (key, threshold = 0.45) => {
    const item = field(key);
    return Boolean(item?.value) && Number(item?.confidence || 0) >= threshold;
  };

  const stageChecks = {
    objective: hasHighConfidence('objective', 0.45),
    audience: hasHighConfidence('audience', 0.4),
    contextData: hasHighConfidence('context', 0.4),
    constraints: hasHighConfidence('constraints', 0.4) || hasHighConfidence('nonGoals', 0.35),
    outputFormat: hasHighConfidence('outputFormat', 0.4) || hasHighConfidence('tone', 0.35),
    qualityBar: hasHighConfidence('acceptanceCriteria', 0.35),
    examples: hasHighConfidence('examples', 0.35)
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

function buildStageDiagnostics(progress) {
  const missingRequiredStages = progress.stages.filter((stage) => stage.required && !stage.complete);

  return {
    requiredCompleteness: Number(progress.requiredCompleteness.toFixed(3)),
    overallCompleteness: Number(progress.overallCompleteness.toFixed(3)),
    completedRequired: progress.completedRequired,
    requiredTotal: progress.requiredTotal,
    missingRequiredStageKeys: missingRequiredStages.map((stage) => stage.key),
    missingRequiredItems: missingRequiredStages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      requiredFields: stage.requiredFields,
      followUpQuestion: stage.followUpQuestion
    }))
  };
}

function buildStageProgressPayload(progress) {
  return {
    minCompletenessThreshold: MIN_COMPLETENESS_THRESHOLD,
    canGenerateFinalPrompt: progress.canGenerateFinalPrompt,
    requiredCompleteness: Number(progress.requiredCompleteness.toFixed(3)),
    overallCompleteness: Number(progress.overallCompleteness.toFixed(3)),
    completedRequired: progress.completedRequired,
    requiredTotal: progress.requiredTotal,
    missingRequiredStageKeys: progress.missingRequiredStageKeys,
    stages: progress.stages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      required: stage.required,
      requiredFields: stage.requiredFields,
      doneCriteria: stage.doneCriteria,
      complete: stage.complete
    }))
  };
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
    const { briefExtraction } = await buildNormalizedBrief({
      messages: incoming,
      callModel: callGroq
    });
    const progress = inspectConversationStages(briefExtraction);
    const stageDiagnostics = buildStageDiagnostics(progress);

    const messages = [
      { role: 'system', content: coachingSystemPrompt },
      {
        role: 'system',
        content: [
          'Stage diagnostics (advisory only, not a hard gate):',
          JSON.stringify(stageDiagnostics),
          '',
          'Structured brief (with confidence + assumptions):',
          JSON.stringify(briefExtraction, null, 2),
          '',
          'Response strategy:',
          '- Ask at most one concise clarifying question when possible.',
          '- If enough information exists, generate a direct draft prompt immediately.',
          '- If details are sparse, proceed with explicit assumptions instead of blocking.'
        ].join('\n')
      },
      ...incoming
    ];
    const reply = await callGroq(messages);

    res.json({
      reply,
      stageProgress: buildStageProgressPayload(progress),
      brief: briefExtraction
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/generate-prompt', async (req, res) => {
  try {
    const { transcript = '', messages = null } = req.body || {};

    const { messageHistory, transcriptText, hasMessageObjects } = normalizeHistoryInput({ transcript, messages });

    if (Array.isArray(messages) && !hasMessageObjects) {
      return res.status(400).json({
        error: 'Invalid payload: "messages" must be an array of { role, content } objects.'
      });
    }

    const hasBasicIntent = messageHistory.some(
      (message) => message.role === 'user' && String(message.content || '').trim().length > 0
    );

    if (!hasBasicIntent) {
      return res.status(400).json({
        error:
          'Invalid payload: provide at least one non-empty user message in "messages" or "transcript".',
        stageProgress: null
      });
    }

    const { briefExtraction } = await buildNormalizedBrief({
      transcript: transcriptText,
      messages: messageHistory,
      callModel: callGroq
    });
    const progress = inspectConversationStages(briefExtraction);
    const stageDiagnostics = buildStageDiagnostics(progress);

    const generationMessages = [
      { role: 'system', content: finalPromptSystemPrompt },
      {
        role: 'user',
        content: [
          'Build the best possible prompt from this partial or complete brief.',
          'Always provide a usable prompt draft even if some fields are missing.',
          'Include an "Assumptions" section that fills gaps using reasonable defaults.',
          'If helpful, include an optional "Questions to refine further" section with concise follow-ups.',
          '',
          `Stage diagnostics:\n${JSON.stringify(stageDiagnostics, null, 2)}`,
          '',
          `Normalized brief JSON:\n${JSON.stringify(briefExtraction.brief, null, 2)}`,
          '',
          `Field confidence + assumptions:\n${JSON.stringify(briefExtraction.fields, null, 2)}`,
          '',
          `Unresolved conflicts:\n${JSON.stringify(briefExtraction.unresolvedConflicts, null, 2)}`,
          '',
          `Global assumptions:\n${JSON.stringify(briefExtraction.globalAssumptions, null, 2)}`
        ].join('\n')
      }
    ];
    const prompt = await callGroq(generationMessages);
    return res.json({
      brief: briefExtraction,
      prompt,
      stageProgress: buildStageProgressPayload(progress)
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Prompt Builder API listening on http://localhost:${port}`);
  });
}

export default app;
