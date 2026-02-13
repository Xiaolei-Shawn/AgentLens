import "./WorkflowPlaybackBar.css";

interface WorkflowPlaybackBarProps {
  stepIndex: number;
  totalSteps: number;
  isPlaying: boolean;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  currentLabel?: string;
  estEnd?: string;
  disabled?: boolean;
}

export function WorkflowPlaybackBar({
  stepIndex,
  totalSteps,
  isPlaying,
  speed,
  onPlay,
  onPause,
  onSeek,
  onSpeedChange,
  currentLabel,
  estEnd,
  disabled = false,
}: WorkflowPlaybackBarProps) {
  const stepNum = totalSteps === 0 ? 0 : stepIndex + 1;
  const percent = totalSteps <= 1 ? 100 : (stepNum / totalSteps) * 100;
  const speeds = [0.5, 1, 1.5, 2];
  const currentIdx = speeds.indexOf(speed);
  const nextSpeed =
    currentIdx >= 0 ? speeds[(currentIdx + 1) % speeds.length] : 1;

  return (
    <div className="workflow-playback-bar">
      <div className="workflow-playback-bar__controls">
        <button
          type="button"
          className="workflow-playback-bar__btn"
          onClick={() => onSeek(Math.max(0, stepIndex - 1))}
          disabled={disabled || stepIndex <= 0}
          aria-label="Previous step"
        >
          <span aria-hidden>⏮</span>
        </button>
        <button
          type="button"
          className="workflow-playback-bar__btn workflow-playback-bar__btn--play"
          onClick={isPlaying ? onPause : onPlay}
          disabled={disabled}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          <span aria-hidden>{isPlaying ? "⏸" : "▶"}</span>
        </button>
        <button
          type="button"
          className="workflow-playback-bar__btn"
          onClick={() => onSeek(Math.min(totalSteps - 1, stepIndex + 1))}
          disabled={disabled || stepIndex >= totalSteps - 1}
          aria-label="Next step"
        >
          <span aria-hidden>⏭</span>
        </button>
      </div>
      <div className="workflow-playback-bar__progress">
        <span className="workflow-playback-bar__step-label">
          STEP {stepNum} OF {totalSteps || 1}
          {currentLabel ? `: ${currentLabel.toUpperCase()}` : ""}
        </span>
        <div
          className="workflow-playback-bar__track"
          role="progressbar"
          aria-valuenow={stepNum}
          aria-valuemin={1}
          aria-valuemax={totalSteps || 1}
          onClick={(e) => {
            if (totalSteps <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const idx = Math.min(
              totalSteps - 1,
              Math.floor((x / rect.width) * totalSteps),
            );
            onSeek(Math.max(0, idx));
          }}
        >
          <div
            className="workflow-playback-bar__fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="workflow-playback-bar__percent">
          {totalSteps <= 1 ? "100" : Math.round(percent)}% COMPLETE
        </span>
      </div>
      {estEnd && (
        <span className="workflow-playback-bar__est">Est. End {estEnd}</span>
      )}
      <button
        type="button"
        className="workflow-playback-bar__speed"
        onClick={() => onSpeedChange(nextSpeed)}
        disabled={disabled}
        aria-label={`Speed ${speed}x`}
      >
        SPEED {speed}x
      </button>
    </div>
  );
}
