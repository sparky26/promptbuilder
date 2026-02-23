import { useEffect, useMemo, useState } from 'react';

const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderInlineMarkdown = (text) => {
  const escaped = escapeHtml(text);

  return escaped
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
};

const markdownToSafeHtml = (markdown) => {
  const lines = markdown.split(/\r?\n/);
  let html = '';
  let paragraph = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let listType = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html += `<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`;
    paragraph = [];
  };

  const closeList = () => {
    if (!listType) return;
    html += listType === 'ol' ? '</ol>' : '</ul>';
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('```')) {
      flushParagraph();
      closeList();

      if (inCodeBlock) {
        html += `<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`;
        codeBuffer = [];
      }

      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line) {
      flushParagraph();
      closeList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      html += `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`;
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        html += '<ul>';
        listType = 'ul';
      }
      html += `<li>${renderInlineMarkdown(unorderedMatch[1])}</li>`;
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        html += '<ol>';
        listType = 'ol';
      }
      html += `<li>${renderInlineMarkdown(orderedMatch[1])}</li>`;
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();

  if (inCodeBlock) {
    html += `<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`;
  }

  return html;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787').replace(
  /\/$/,
  ''
);

const STARTER_MESSAGE = {
  role: 'assistant',
  content:
    "Hi! I'm your Prompt Architect. Tell me what you want ChatGPT/Claude to help with, and I'll guide you through goal, context, constraints, and output format before generating a polished final prompt."
};

const SESSION_STORAGE_KEY = 'promptbuilder:last-session';

const serializeSession = (sessionMessages) =>
  JSON.stringify({
    savedAt: new Date().toISOString(),
    messages: sessionMessages
  });

const parseStoredSession = (value) => {
  if (!value) return null;

  try {
    const payload = JSON.parse(value);
    const savedAt = typeof payload.savedAt === 'string' ? payload.savedAt : null;
    const savedMessages = Array.isArray(payload.messages) ? payload.messages : null;

    if (!savedMessages) return null;

    const validMessages = savedMessages.every(
      (message) =>
        message &&
        (message.role === 'assistant' || message.role === 'user') &&
        typeof message.content === 'string'
    );

    if (!validMessages) return null;

    return { savedAt, messages: savedMessages };
  } catch {
    return null;
  }
};

const parseApiError = async (response, fallbackMessage) => {
  const contentType = response.headers.get('content-type') || '';
  let message = fallbackMessage;

  if (contentType.includes('application/json')) {
    const payload = await response.json();
    message = payload.error || payload.message || fallbackMessage;
  } else {
    const text = (await response.text()).trim();
    if (text) {
      message = text;
    }
  }

  return `${response.status} ${message}`;
};

export function App() {
  const [messages, setMessages] = useState([STARTER_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [stageProgress, setStageProgress] = useState(null);

  const transcript = useMemo(
    () =>
      messages
        .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n'),
    [messages]
  );

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'coach', messages: nextMessages })
      });

      if (!response.ok) {
        const message = await parseApiError(response, 'Failed to generate assistant response');
        throw new Error(message);
      }

      const payload = await response.json();
      setMessages((prev) => [...prev, { role: 'assistant', content: payload.reply }]);
      setStageProgress(payload.stageProgress || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const serialized = serializeSession(messages);
    localStorage.setItem(SESSION_STORAGE_KEY, serialized);

    const parsed = parseStoredSession(serialized);
    setLastSavedAt(parsed?.savedAt || null);
  }, [messages]);

  const startNewSession = () => {
    if (loading) return;
    setMessages([STARTER_MESSAGE]);
    setInput('');
    setError('');
    setStageProgress(null);
  };

  const restoreLastSession = () => {
    if (loading) return;

    const stored = parseStoredSession(localStorage.getItem(SESSION_STORAGE_KEY));

    if (!stored) {
      setError('No previous session found in local storage.');
      return;
    }

    setMessages(stored.messages);
    setError('');
    setLastSavedAt(stored.savedAt);
    setStageProgress(null);
  };

  const exportTranscript = () => {
    const lastPromptMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.content.startsWith('## Final Prompt'));

    const exportedPrompt = lastPromptMessage ? `${lastPromptMessage.content}\n\n` : '';
    const body = `${exportedPrompt}## Transcript\n\n${transcript}`;
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replaceAll(':', '-');

    anchor.href = url;
    anchor.download = `promptbuilder-session-${timestamp}.txt`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const buildFinalPrompt = async () => {
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/generate-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, messages })
      });

      if (!response.ok) {
        const message = await parseApiError(response, 'Failed to build final prompt');
        throw new Error(message);
      }

      const payload = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `## Final Prompt\n\n${payload.prompt}`
        }
      ]);
      setStageProgress(payload.stageProgress || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <header>
        <h1>Prompt Builder Agent</h1>
        <p>
          Conversationally shape your idea, then generate a detailed, reusable prompt for ChatGPT or
          Claude.
        </p>
      </header>

      <section className="chat-window">
        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`bubble ${message.role}`}>
            <strong>{message.role === 'assistant' ? 'Architect' : 'You'}</strong>
            {message.role === 'assistant' ? (
              <div
                className="assistant-markdown"
                dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(message.content) }}
              />
            ) : (
              <p className="user-content">{message.content}</p>
            )}
          </article>
        ))}
      </section>

      {error ? <p className="error">{error}</p> : null}

      <section className="session-actions" aria-label="session controls">
        <button className="secondary" onClick={startNewSession} disabled={loading}>
          New Session
        </button>
        <button className="secondary" onClick={restoreLastSession} disabled={loading}>
          Restore Last Session
        </button>
        <button className="secondary" onClick={exportTranscript} disabled={messages.length < 2}>
          Export Prompt/Transcript
        </button>
        {lastSavedAt ? <p className="save-meta">Saved {new Date(lastSavedAt).toLocaleString()}</p> : null}
      </section>

      {Array.isArray(stageProgress?.stages) && stageProgress.stages.length ? (
        <section className="progress-panel" aria-label="stage progress">
          {(() => {
            const requiredStages = stageProgress.stages.filter(
              (stage) => stage.isRequired ?? stage.required
            );
            const completedRequiredCount = requiredStages.filter(
              (stage) => stage.isComplete ?? stage.complete
            ).length;
            const missingRequiredStages = requiredStages.filter(
              (stage) => !(stage.isComplete ?? stage.complete)
            );

            return (
              <>
                <p>
                  {completedRequiredCount}/{requiredStages.length} required stages complete
                </p>
                <div>
                  {stageProgress.stages.map((stage, index) => {
                    const isComplete = stage.isComplete ?? stage.complete;
                    const label = stage.label || stage.name || `Stage ${index + 1}`;

                    return (
                      <p
                        key={`${label}-${index}`}
                        className={`progress-item ${isComplete ? 'is-complete' : 'is-missing'}`}
                      >
                        <span aria-hidden="true">{isComplete ? '●' : '○'}</span> {label}
                      </p>
                    );
                  })}
                </div>
                {missingRequiredStages.length ? (
                  <p className="is-missing">
                    Missing required: {missingRequiredStages.map((stage) => stage.label || stage.name).join(', ')}
                  </p>
                ) : null}
              </>
            );
          })()}
        </section>
      ) : null}

      <section className="composer">
        <textarea
          rows={3}
          placeholder="Describe your task, audience, and desired outcome..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              sendMessage();
            }
          }}
        />
        <div className="actions">
          <button onClick={sendMessage} disabled={loading || !input.trim()}>
            {loading ? 'Thinking…' : 'Send'}
          </button>
          <button onClick={buildFinalPrompt} disabled={loading || messages.length < 3}>
            Generate Final Prompt
          </button>
        </div>
      </section>
    </main>
  );
}
