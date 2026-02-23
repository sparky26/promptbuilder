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
  assert.equal(result.brief.objective, 'Draft a launch email campaign');
  assert.equal(result.fields.objective.source, 'heuristic');
  assert.ok(result.fields.objective.confidence > 0.6);
  assert.equal(result.brief.constraints, 'We should avoid legal claims and keep it under 150 words.');
});

test('extractBrief handles explicit negation for constraints and non-goals', async () => {
  const result = await extractBrief({
    transcript: [
      'user: constraints: Keep it concise and under 150 words.',
      'user: No constraints for now.',
      "user: non-goals: Don't mention competitors.",
      'user: no non-goals this time.'
    ].join('\n')
  });

  assert.equal(result.brief.constraints, null);
  assert.equal(result.brief.nonGoals, null);
  assert.ok(
    result.unresolvedConflicts.some(
      (conflict) => conflict.field === 'constraints' && conflict.reason.includes('Contradictory statements across turns')
    )
  );
  assert.ok(
    result.unresolvedConflicts.some(
      (conflict) => conflict.field === 'nonGoals' && conflict.reason.includes('Contradictory statements across turns')
    )
  );
});

test('extractBrief prioritizes latest turn for contradictory objective statements', async () => {
  const result = await extractBrief({
    transcript: [
      'user: objective: Draft a formal policy memo.',
      'assistant: Got it.',
      'user: objective: Actually make it a concise FAQ for onboarding.'
    ].join('\n')
  });

  assert.equal(result.brief.objective, 'Actually make it a concise FAQ for onboarding.');
  assert.ok(
    result.unresolvedConflicts.some(
      (conflict) => conflict.field === 'objective' && conflict.reason.includes('Multiple competing values observed')
    )
  );
});

test('extractBrief identifies implicit audience and context mentions', async () => {
  const result = await extractBrief({
    transcript: [
      'user: Build a checklist for first-time managers.',
      'user: Base it on the onboarding docs and incident notes from last quarter.'
    ].join('\n')
  });

  assert.equal(result.brief.audience, 'Build a checklist for first-time managers.');
  assert.equal(result.brief.context, 'Base it on the onboarding docs and incident notes from last quarter.');
  assert.ok(result.fields.audience.assumptions.some((entry) => entry.includes('implicit')));
  assert.ok(result.fields.context.assumptions.some((entry) => entry.includes('implicit')));
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
