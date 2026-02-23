process.env.VERCEL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';

function mockGroqResponse(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] })
  };
}

test('POST /api/chat returns stageProgress and normalized brief metadata', async (t) => {
  process.env.GROQ_API_KEY = 'test-key';
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }

    const body = JSON.parse(options.body);
    const firstSystemPrompt = body.messages?.[0]?.content || '';

    if (firstSystemPrompt.includes('normalize conversation history into concise structured brief JSON')) {
      return mockGroqResponse(
        JSON.stringify({
          fields: {
            objective: { value: 'Create onboarding checklist', confidence: 0.85, assumptions: [] },
            audience: { value: 'First-time managers', confidence: 0.82, assumptions: [] },
            context: { value: 'HR onboarding process', confidence: 0.79, assumptions: [] },
            constraints: { value: 'Keep under 12 bullets', confidence: 0.8, assumptions: [] },
            outputFormat: { value: 'Markdown bullets', confidence: 0.8, assumptions: [] }
          },
          unresolvedConflicts: [],
          globalAssumptions: ['No examples supplied.']
        })
      );
    }

    return mockGroqResponse('Draft reply from coach');
  };

  const { default: app } = await import('../index.js');
  const server = app.listen(0);
  t.after(() => {
    global.fetch = originalFetch;
    server.close();
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Need an onboarding checklist for first-time managers.' }]
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.reply, 'Draft reply from coach');
  assert.equal(payload.brief.normalizationMethod, 'llm_assisted');
  assert.deepEqual(payload.brief.globalAssumptions, ['No examples supplied.']);
  assert.ok(payload.stageProgress);
  assert.equal(payload.stageProgress.requiredTotal, 5);
  assert.equal(payload.stageProgress.stages.length, 7);
});

test('POST /api/generate-prompt returns 400 with stage diagnostics when required stages are insufficient', async (t) => {
  process.env.GROQ_API_KEY = 'test-key';
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }

    const body = JSON.parse(options.body);
    const firstSystemPrompt = body.messages?.[0]?.content || '';

    if (firstSystemPrompt.includes('normalize conversation history into concise structured brief JSON')) {
      return mockGroqResponse(
        JSON.stringify({
          fields: {
            objective: { value: 'Create onboarding checklist', confidence: 0.86, assumptions: [] },
            audience: { value: 'First-time managers', confidence: 0.84, assumptions: [] },
            context: { value: null, confidence: 0.2, assumptions: [] },
            constraints: { value: null, confidence: 0.2, assumptions: [] },
            outputFormat: { value: null, confidence: 0.2, assumptions: [] }
          },
          unresolvedConflicts: [],
          globalAssumptions: ['Examples not provided.']
        })
      );
    }

    return mockGroqResponse('Generated final prompt');
  };

  const { default: app } = await import('../index.js');
  const server = app.listen(0);
  t.after(() => {
    global.fetch = originalFetch;
    server.close();
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/generate-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Need onboarding checklist prompt for new managers.' }]
    })
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(
    payload.error,
    'Not enough required prompt stages are complete to generate a final prompt yet.'
  );
  assert.ok(payload.stageProgress);
  assert.equal(payload.stageProgress.canGenerateFinalPrompt, false);
  assert.ok(Array.isArray(payload.missingRequiredItems));
  assert.ok(payload.missingRequiredItems.length >= 1);
});

test('POST /api/generate-prompt returns final prompt when required readiness is met', async (t) => {
  process.env.GROQ_API_KEY = 'test-key';
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) {
      return originalFetch(url, options);
    }

    const body = JSON.parse(options.body);
    const firstSystemPrompt = body.messages?.[0]?.content || '';

    if (firstSystemPrompt.includes('normalize conversation history into concise structured brief JSON')) {
      return mockGroqResponse(
        JSON.stringify({
          fields: {
            objective: { value: 'Create onboarding checklist', confidence: 0.86, assumptions: [] },
            audience: { value: 'First-time managers', confidence: 0.84, assumptions: [] },
            context: { value: 'Existing HR playbook', confidence: 0.8, assumptions: [] },
            constraints: { value: 'Limit to concise bullets', confidence: 0.79, assumptions: [] },
            outputFormat: { value: 'Markdown list', confidence: 0.78, assumptions: [] }
          },
          unresolvedConflicts: [],
          globalAssumptions: ['Examples not provided.']
        })
      );
    }

    return mockGroqResponse('Generated final prompt');
  };

  const { default: app } = await import('../index.js');
  const server = app.listen(0);
  t.after(() => {
    global.fetch = originalFetch;
    server.close();
  });

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/generate-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Need onboarding checklist prompt for new managers.' }]
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.prompt, 'Generated final prompt');
  assert.equal(payload.brief.normalizationMethod, 'llm_assisted');
  assert.deepEqual(payload.brief.globalAssumptions, ['Examples not provided.']);
  assert.ok(payload.stageProgress);
  assert.equal(payload.stageProgress.canGenerateFinalPrompt, true);
  assert.equal(payload.stageProgress.requiredTotal, 5);
  assert.equal(payload.stageProgress.stages.length, 7);
});
