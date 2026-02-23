import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderInlineMarkdown, markdownToSafeHtml } from '../markdown.js';
import { parseStoredSession, serializeSession, SESSION_STORAGE_KEY } from '../session.js';
import { parseApiError } from '../api.js';

test('SESSION_STORAGE_KEY remains stable', () => {
  assert.equal(SESSION_STORAGE_KEY, 'promptbuilder:last-session');
});

test('serializeSession and parseStoredSession round-trip valid messages', () => {
  const messages = [
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: 'Need a launch brief' }
  ];

  const serialized = serializeSession(messages);
  const parsed = parseStoredSession(serialized);

  assert.ok(parsed?.savedAt);
  assert.deepEqual(parsed?.messages, messages);
});

test('parseStoredSession rejects invalid payloads', () => {
  assert.equal(parseStoredSession(''), null);
  assert.equal(parseStoredSession('{"foo":1}'), null);
  assert.equal(parseStoredSession('not-json'), null);
  assert.equal(parseStoredSession(JSON.stringify({ messages: [{ role: 'system', content: 'x' }] })), null);
  assert.equal(parseStoredSession(JSON.stringify({ messages: [{ role: 'user', content: 42 }] })), null);
});

test('escapeHtml escapes dangerous HTML characters', () => {
  assert.equal(escapeHtml('<script>"x" & y</script>'), '&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;');
});

test('renderInlineMarkdown formats inline elements and preserves safety', () => {
  const result = renderInlineMarkdown('Use **bold** and `code` and [link](https://example.com) <b>tag</b>');
  assert.match(result, /<strong>bold<\/strong>/);
  assert.match(result, /<code>code<\/code>/);
  assert.match(result, /<a href="https:\/\/example.com" target="_blank" rel="noreferrer">link<\/a>/);
  assert.match(result, /&lt;b&gt;tag&lt;\/b&gt;/);
});

test('markdownToSafeHtml handles headings, lists, paragraphs, and code blocks', () => {
  const markdown = ['# Title', '', '- first', '- second', '', '1. alpha', '2. beta', '', '```', '<unsafe>', '```'].join('\n');

  const html = markdownToSafeHtml(markdown);

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li>first<\/li><li>second<\/li><\/ul>/);
  assert.match(html, /<ol><li>alpha<\/li><li>beta<\/li><\/ol>/);
  assert.match(html, /<pre><code>&lt;unsafe&gt;<\/code><\/pre>/);
});

const createMockResponse = ({ status, contentType = 'application/json', jsonBody, textBody = '' }) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null)
  },
  json: async () => jsonBody,
  text: async () => textBody
});

test('parseApiError maps 500 responses to generic server message', async () => {
  const response = createMockResponse({ status: 500, jsonBody: { error: 'db failed' } });
  const message = await parseApiError(response, 'fallback');

  assert.equal(
    message,
    'Something went wrong on our side while processing this request. Please try again in a moment.'
  );
});

test('parseApiError maps known 400 validation messages', async () => {
  const response = createMockResponse({
    status: 400,
    jsonBody: { message: 'Need at least one non-empty user message' }
  });
  const message = await parseApiError(response, 'fallback');

  assert.equal(message, 'Please add a message describing your goal, then try generating again.');
});

test('parseApiError falls back to raw status + message for unhandled codes', async () => {
  const response = createMockResponse({
    status: 404,
    contentType: 'text/plain',
    textBody: 'Not found'
  });
  const message = await parseApiError(response, 'fallback');

  assert.equal(message, '404 Not found');
});
