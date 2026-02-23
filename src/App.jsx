import { useEffect, useMemo, useRef } from 'react';
import { usePromptSession } from './hooks/usePromptSession';
import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { StageProgressPanel } from './components/StageProgressPanel';

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
    const hasStageReadinessSignal = typeof stageProgress?.canGenerateFinalPrompt === 'boolean';
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
      hasStageReadinessSignal,
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
            I am an expert prompt builder, who will help you build the perfect prompt for your agent
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
          <MessageList loading={loading} messages={messages} />
        </section>

        <StageProgressPanel
          isProgressExpanded={isProgressExpanded}
          setIsProgressExpanded={setIsProgressExpanded}
          stageProgress={stageProgress}
        />

        {error ? <p className="error">{error}</p> : null}

        <Composer
          finalPromptReadiness={finalPromptReadiness}
          hasFinalPrompt={hasFinalPrompt}
          input={input}
          loading={loading}
          sendMessage={sendMessage}
          setInput={setInput}
        />
      </section>
    </main>
  );
}
