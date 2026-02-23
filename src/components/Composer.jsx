export const Composer = ({
  finalPromptReadiness,
  hasFinalPrompt,
  input,
  loading,
  sendMessage,
  setInput
}) => (
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
        {finalPromptReadiness.hasStageReadinessSignal
          ? finalPromptReadiness.canGenerateByStageProgress
            ? 'Ready to generate. Add more detail anytime to improve quality.'
            : `Not ready yet — answer a bit more before generating${
                finalPromptReadiness.missingStageLabels.length
                  ? ` (missing: ${finalPromptReadiness.missingStageLabels.join(', ')})`
                  : ''
              }.`
          : 'Add your first request to start readiness tracking.'}
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
);
