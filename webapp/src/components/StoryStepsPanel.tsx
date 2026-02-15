import { isIntentEvent, isVerificationEvent } from "../types/session";
import type { Session, SessionEvent } from "../types/session";

import "./StoryStepsPanel.css";

interface StoryStepsPanelProps {
  session: Session;
  currentIndex: number;
  onSelectIndex: (index: number) => void;
}

/** Event indices that are intent/verification/session_end (story steps). */
function getStepIndices(events: SessionEvent[]): number[] {
  return events
    .map((e, i) => (isIntentEvent(e) || isVerificationEvent(e) || e.kind === "session_end" ? i : -1))
    .filter((i) => i >= 0);
}

export function StoryStepsPanel({ session, currentIndex, onSelectIndex }: StoryStepsPanelProps) {
  const indices = getStepIndices(session.events);

  return (
    <aside className="story-steps-panel">
      <h2 className="panel-title">Story steps</h2>
      <ul className="story-steps-list" role="list">
        {indices.map((eventIndex) => {
          const event = session.events[eventIndex];
          const isActive = eventIndex === currentIndex;
          const label = isIntentEvent(event)
            ? (typeof event.payload.title === "string" ? event.payload.title : "Intent")
            : isVerificationEvent(event)
              ? `Verification: ${typeof event.payload.result === "string" ? event.payload.result : "unknown"}`
              : "Session end";
          return (
            <li key={eventIndex}>
              <button
                type="button"
                className={`story-step-btn ${isActive ? "active" : ""}`}
                onClick={() => onSelectIndex(eventIndex)}
                title={`Event ${eventIndex + 1}`}
              >
                {label || `Event ${eventIndex + 1}`}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
