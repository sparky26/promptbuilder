import test from 'node:test';
import assert from 'node:assert/strict';
import { briefFieldKeys, requiredStageKeys, stageDefinitions } from '../domain/brief-schema.js';

test('schema consistency: required stages only reference existing brief field keys', () => {
  const validKeys = new Set(briefFieldKeys);

  const missingReferences = Object.values(stageDefinitions)
    .filter((stage) => requiredStageKeys.includes(stage.key))
    .flatMap((stage) =>
      (stage.completionRules || []).flatMap((ruleSet) => {
        const rules = [...(ruleSet.allOf || []), ...(ruleSet.anyOf || [])];
        return rules
          .filter((rule) => !validKeys.has(rule.fieldKey))
          .map((rule) => ({ stageKey: stage.key, fieldKey: rule.fieldKey }));
      })
    );

  assert.deepEqual(missingReferences, []);
});
