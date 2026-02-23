import { useEffect, useMemo, useRef } from 'react';
import { usePromptSession } from './hooks/usePromptSession';
import { AssistantMarkdown } from './utils/markdown';

export function App() {
  const {
    canGenerateFinalPrompt,
    error,
    hasFinalPrompt,
    input,
    isProgressExpanded,
    lastSavedAt,
    loading,
    messages,
    setInput,
    setIsProgressExpanded,
    stageProgress,
    transcript,
    buildFinalPrompt,
    restoreLastSession,
    sendMessage,
    startNewSession
  } = usePromptSession();
  const chatWindowRef = useRef(null);

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
                  <AssistantMarkdown content={message.content} />
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
