import { useEffect, useMemo, useRef, useState } from 'react';

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
    .replace(
      /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    );
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

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:8787' : '')).replace(/\/$/, '');

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

  const rawMessage = `${response.status} ${message}`;

  if (response.status >= 500) {
    return 'Something went wrong on our side while processing this request. Please try again in a moment.';
  }

  if (response.status === 429) {
    return 'Too many requests right now. Please wait a few seconds and try again.';
  }

  if (response.status === 400) {
    if (message.toLowerCase().includes('at least one non-empty user message')) {
      return 'Please add a message describing your goal, then try generating again.';
    }

    if (message.toLowerCase().includes('messages')) {
      return 'We could not read the conversation history. Please send another message and try again.';
    }

    return 'We need a little more input to continue. Add context or constraints, then try again.';
  }

  return rawMessage;
};

export function App() {
  const [messages, setMessages] = useState([STARTER_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [stageProgress, setStageProgress] = useState(null);
  const [isProgressExpanded, setIsProgressExpanded] = useState(false);
  const chatWindowRef = useRef(null);

  const transcript = useMemo(
    () =>
      messages
        .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n'),
    [messages]
  );

  const finalPromptReadiness = useMemo(() => {
    const canGenerateByStageProgress = stageProgress?.canGenerateFinalPrompt === true;
    const stages = Array.isArray(stageProgress?.stages) ? stageProgress.stages : [];
    const missingRequiredStageKeys = Array.isArray(stageProgress?.missingRequiredStageKeys)
      ? stageProgress.missingRequiredStageKeys
      : [];

    const stageLabelByKey = new Map(
      stages
        .map((stage) => {
          const stageKey = stage.key || stage.stageKey || stage.id || stage.name;
          const stageLabel = stage.label || stage.name || stageKey;

          return stageKey ? [stageKey, stageLabel] : null;
        })
        .filter(Boolean)
    );

    const missingStageLabels = missingRequiredStageKeys
      .map((stageKey) => stageLabelByKey.get(stageKey) || stageKey)
      .filter(Boolean);

    return {
      canGenerateByStageProgress,
      missingStageLabels
    };
  }, [stageProgress]);

  const hasUserInput = messages.some(
    (message) => message.role === 'user' && Boolean(message.content.trim())
  );
  const hasFinalPrompt = messages.some(
    (message) => message.role === 'assistant' && message.content.startsWith('## Final Prompt')
  );
  const canGenerateFinalPrompt = !loading && hasUserInput;

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

  useEffect(() => {
    const chatWindow = chatWindowRef.current;
    if (!chatWindow) return;

    const scrollThresholdPx = 64;
    const distanceFromBottom =
      chatWindow.scrollHeight - chatWindow.scrollTop - chatWindow.clientHeight;

    if (distanceFromBottom <= scrollThresholdPx) {
      chatWindow.scrollTo({ top: chatWindow.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, loading]);

  const startNewSession = () => {
    if (loading) return;
    setMessages([STARTER_MESSAGE]);
    setInput('');
    setError('');
    setStageProgress(null);
    setIsProgressExpanded(false);
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
    setIsProgressExpanded(false);
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
      <aside className="sidebar">
        <div>
          <p className="sidebar-eyebrow">Prompt Builder</p>
          <h1>Prompt Architect</h1>
          <p className="sidebar-copy">
            ChatGPT-inspired workspace to shape requirements and generate a polished final prompt.
          </p>
        </div>

        <div className="sidebar-actions" aria-label="session controls">
          <button className="secondary" onClick={startNewSession} disabled={loading}>
            + New chat
          </button>
          <button className="secondary" onClick={restoreLastSession} disabled={loading}>
            Restore last
          </button>
          <button className="secondary" onClick={exportTranscript} disabled={messages.length < 2}>
            Export transcript
          </button>
          {lastSavedAt ? (
            <p className="save-meta">Last auto-save: {new Date(lastSavedAt).toLocaleString()}</p>
          ) : null}
        </div>
      </aside>

      <section className="chat-layout">
        <header className="chat-header">
          <div>
            <h2>Prompt Architecture Session</h2>
            <p>{messages.length} messages in this conversation</p>
          </div>
          <button onClick={buildFinalPrompt} disabled={!canGenerateFinalPrompt}>
            {hasFinalPrompt ? 'Regenerate Final Prompt' : 'Generate Final Prompt'}
          </button>
        </header>

        <section className="chat-window" ref={chatWindowRef}>
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={`message-row ${message.role}`}>
              <span className="avatar" aria-hidden="true">
                {message.role === 'assistant' ? 'AI' : 'You'}
              </span>
              <div className={`bubble ${message.role}`}>
                {message.role === 'assistant' ? (
                  <div
                    className="assistant-markdown"
                    dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(message.content) }}
                  />
                ) : (
                  <p className="user-content">{message.content}</p>
                )}
              </div>
            </article>
          ))}
          {loading ? (
            <article className="message-row assistant" aria-live="polite" aria-label="assistant is thinking">
              <span className="avatar" aria-hidden="true">
                AI
              </span>
              <div className="bubble assistant">
                <p className="user-content">Thinking…</p>
              </div>
            </article>
          ) : null}
        </section>

        {Array.isArray(stageProgress?.stages) && stageProgress.stages.length ? (
          <details
            className="progress-panel"
            aria-label="stage progress"
            open={isProgressExpanded}
            onToggle={(event) => setIsProgressExpanded(event.currentTarget.open)}
          >
            <summary className="progress-heading">Progress checklist (optional)</summary>
            <div className="progress-grid">
              {stageProgress.stages.map((stage, index) => {
                const isComplete = stage.isComplete ?? stage.complete;
                const label = stage.label || stage.name || `Stage ${index + 1}`;

                return (
                  <p key={`${label}-${index}`} className={`progress-item ${isComplete ? 'is-complete' : 'is-missing'}`}>
                    <span aria-hidden="true">{isComplete ? '●' : '○'}</span> {label}
                  </p>
                );
              })}
            </div>
          </details>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        <section className="composer">
          <textarea
            rows={3}
            placeholder="Message Prompt Architect..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />
          <div className="composer-actions">
            <p className={`hint ${finalPromptReadiness.canGenerateByStageProgress ? 'is-complete' : ''}`}>
              {finalPromptReadiness.canGenerateByStageProgress
                ? 'You can generate now. Add more detail anytime to improve quality.'
                : `Can generate now; add more detail for better quality${
                    finalPromptReadiness.missingStageLabels.length
                      ? ` (suggested: ${finalPromptReadiness.missingStageLabels.join(', ')})`
                      : ''
                  }.`}
            </p>
            {hasFinalPrompt ? (
              <div className="refine-actions" aria-label="quick refinement suggestions">
                {['Make it shorter', 'Make it more formal', 'Adapt it for executives'].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="secondary"
                    disabled={loading}
                    onClick={() => setInput(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
            <button onClick={sendMessage} disabled={loading || !input.trim()}>
              {loading ? 'Thinking…' : 'Send'}
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
