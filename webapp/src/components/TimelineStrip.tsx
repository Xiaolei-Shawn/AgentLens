import "./TimelineStrip.css";

interface TimelineStripProps {
  eventCount: number;
  currentIndex: number;
  onSeek: (index: number) => void;
}

export function TimelineStrip({ eventCount, currentIndex, onSeek }: TimelineStripProps) {
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
    </div>
  );
}
