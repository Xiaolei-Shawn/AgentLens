import "./PlaybackControls.css";

interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: 1 | 2;
  onPlay: () => void;
  onPause: () => void;
  onSpeedChange: (speed: 1 | 2) => void;
  disabled?: boolean;
}

export function PlaybackControls({
  isPlaying,
  speed,
  onPlay,
  onPause,
  onSpeedChange,
  disabled = false,
}: PlaybackControlsProps) {
  return (
    <div className="playback-controls">
      <button
        type="button"
        className="playback-btn"
        onClick={isPlaying ? onPause : onPlay}
        disabled={disabled}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <div className="speed-group">
        <span className="speed-label">Speed:</span>
        <button
          type="button"
          className={`speed-btn ${speed === 1 ? "active" : ""}`}
          onClick={() => onSpeedChange(1)}
          disabled={disabled}
          aria-pressed={speed === 1}
        >
          1×
        </button>
        <button
          type="button"
          className={`speed-btn ${speed === 2 ? "active" : ""}`}
          onClick={() => onSpeedChange(2)}
          disabled={disabled}
          aria-pressed={speed === 2}
        >
          2×
        </button>
      </div>
    </div>
  );
}
