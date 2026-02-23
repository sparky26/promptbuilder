import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { coachingSystemPrompt, finalPromptSystemPrompt } from './prompts.js';
import { normalizeHistoryInput } from './brief-extractor.js';
import { buildNormalizedBrief } from './brief-service.js';
import { requiredStageKeys, stageDefinitions } from './domain/brief-schema.js';

const app = express();
const port = process.env.PORT || 8787;
const groqApiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const MIN_COMPLETENESS_THRESHOLD = 0.72;

function inspectConversationStages(briefExtraction) {
  const field = (key) => briefExtraction?.fields?.[key] || { value: null, confidence: 0 };
  const hasHighConfidence = (key, threshold = 0.45) => {
    const item = field(key);
    return Boolean(item?.value) && Number(item?.confidence || 0) >= threshold;
  };
  const evaluateRuleSet = (ruleSet = {}) => {
    const allOf = Array.isArray(ruleSet.allOf)
      ? ruleSet.allOf.every((rule) => hasHighConfidence(rule.fieldKey, rule.minConfidence))
      : true;

    const anyOf = Array.isArray(ruleSet.anyOf)
      ? ruleSet.anyOf.some((rule) => hasHighConfidence(rule.fieldKey, rule.minConfidence))
      : true;

    return allOf && anyOf;
  };

  const isStageComplete = (stageDefinition) =>
    (stageDefinition.completionRules || []).some((ruleSet) => evaluateRuleSet(ruleSet));

  const stages = Object.values(stageDefinitions).map((definition) => ({
    ...definition,
    complete: isStageComplete(definition)
  }));

  const completedRequired = stages.filter((stage) => stage.required && stage.complete).length;
  const requiredTotal = requiredStageKeys.length;
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

    if (!progress.canGenerateFinalPrompt) {
      return res.status(400).json({
        error:
          'Not enough required prompt stages are complete to generate a final prompt yet.',
        stageProgress: buildStageProgressPayload(progress),
        missingRequiredItems: stageDiagnostics.missingRequiredItems
      });
    }

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
