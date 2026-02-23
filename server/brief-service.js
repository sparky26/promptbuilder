import { extractBrief, normalizeHistoryInput } from './brief-extractor.js';

const NORMALIZER_SYSTEM_PROMPT =
  'You normalize conversation history into concise structured brief JSON for downstream prompt generation. Return JSON only.';

export async function buildNormalizedBrief({ transcript = '', messages = null, callModel }) {
  const { messageHistory, transcriptText, hasMessageObjects } = normalizeHistoryInput({ transcript, messages });

  const briefExtraction = await extractBrief({
    transcript: transcriptText,
    messages: messageHistory,
    normalizeWithModel: (normalizerPrompt) =>
      callModel([
        { role: 'system', content: NORMALIZER_SYSTEM_PROMPT },
        { role: 'user', content: normalizerPrompt }
      ])
  });

  return {
    briefExtraction,
    messageHistory,
    transcriptText,
    hasMessageObjects
  };
}

