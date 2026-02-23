export const StageProgressPanel = ({ isProgressExpanded, setIsProgressExpanded, stageProgress }) => {
  if (!Array.isArray(stageProgress?.stages) || !stageProgress.stages.length) {
    return null;
  }

  return (
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
  );
};
