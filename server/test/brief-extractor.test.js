import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBrief, normalizeHistoryInput } from '../brief-extractor.js';

test('normalizeHistoryInput accepts transcript fallback', () => {
  const result = normalizeHistoryInput({ transcript: 'Need a short executive summary.' });
  assert.equal(result.messageHistory.length, 1);
  assert.equal(result.messageHistory[0].role, 'user');
  assert.equal(result.hasMessageObjects, false);
});

test('extractBrief returns heuristic fallback with confidence + assumptions', async () => {
  const result = await extractBrief({
    transcript: [
      'user: objective: Draft a launch email campaign',
      'user: We should avoid legal claims and keep it under 150 words.'
    ].join('\n')
  });

  assert.equal(result.normalizationMethod, 'heuristic_fallback');
  assert.equal(result.brief.objective, 'draft a launch email campaign');
  assert.equal(result.fields.objective.source, 'heuristic');
  assert.ok(result.fields.objective.confidence > 0.6);
  assert.equal(result.brief.constraints, 'We should avoid legal claims and keep it under 150 words.');
});

test('extractBrief merges LLM inferred fields and preserves uncertainty metadata', async () => {
  const result = await extractBrief({
    transcript: 'user: I need something that helps new managers onboard quickly.',
    normalizeWithModel: async () =>
      JSON.stringify({
        fields: {
          objective: {
            value: 'Create an onboarding prompt for first-time managers.',
            confidence: 0.86,
            assumptions: ['Interpreted "helps ... onboard quickly" as onboarding task.']
          },
          audience: {
            value: 'First-time people managers',
            confidence: 0.83,
            assumptions: ['Audience inferred from natural phrasing.']
          }
        },
        unresolvedConflicts: [],
        globalAssumptions: ['No explicit output format was provided.']
      })
  });

  assert.equal(result.normalizationMethod, 'llm_assisted');
  assert.equal(result.fields.objective.source, 'llm');
  assert.equal(result.brief.audience, 'First-time people managers');
  assert.ok(result.fields.audience.assumptions.length > 0);
  assert.deepEqual(result.globalAssumptions, ['No explicit output format was provided.']);
});
