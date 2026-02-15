import "./TimelineStrip.css";

interface TimelineStripProps {
  eventCount: number;
  currentIndex: number;
  onSeek: (index: number) => void;
  criticalIndices?: number[];
}

export function TimelineStrip({ eventCount, currentIndex, onSeek, criticalIndices = [] }: TimelineStripProps) {
  const max = Math.max(0, eventCount - 1);

  return (
    <div className="timeline-strip">
      <span className="timeline-label" aria-hidden>
        Event {currentIndex + 1} / {eventCount}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        value={currentIndex}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="timeline-scrubber"
        aria-label="Scrub to event"
      />
      <div className="timeline-critical-track" aria-hidden>
        {criticalIndices
          .filter((idx) => idx >= 0 && idx <= max)
          .map((idx) => {
            const left = max === 0 ? 0 : (idx / max) * 100;
            const isCurrent = idx === currentIndex;
            return (
              <button
                key={idx}
                type="button"
                className={`timeline-critical-dot ${isCurrent ? "is-current" : ""}`}
                style={{ left: `${left}%` }}
                onClick={() => onSeek(idx)}
                title={`Critical event ${idx + 1}`}
                aria-label={`Jump to critical event ${idx + 1}`}
              />
            );
          })}
      </div>
    </div>
  );
}
