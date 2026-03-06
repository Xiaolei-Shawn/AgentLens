import type { Session, SessionEvent } from "../types/session";
import type { DeliverableItem } from "../lib/deliverables";

import "./DeliverableWorkOverview.css";

interface DeliverableWorkOverviewProps {
  session: Session;
  deliverable: DeliverableItem;
  onSeek: (index: number) => void;
}

function actionLabel(event: SessionEvent): string {
  if (event.kind === "file_op") {
    const action = (event.payload as Record<string, unknown>)?.action;
    return typeof action === "string" ? action : "edit";
  }
  if (event.kind === "diff_summary") {
    const p = event.payload as Record<string, unknown>;
    const summary = typeof p.summary === "string" ? p.summary : null;
    if (summary) return summary;
    const add = typeof p.lines_added === "number" ? p.lines_added : 0;
    const rem = typeof p.lines_removed === "number" ? p.lines_removed : 0;
    if (add > 0 || rem > 0) return `+${add} −${rem} lines`;
    return "diff summary";
  }
  return event.kind;
}

function formatTs(ts: string | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return ts;
  }
}

export function DeliverableWorkOverview({
  session,
  deliverable,
  onSeek,
}: DeliverableWorkOverviewProps) {
  const indices = [...deliverable.event_indices].sort((a, b) => a - b);

  if (indices.length === 0) {
    return (
      <section className="deliverable-work-overview">
        <p className="deliverable-work-overview__empty">
          No file events recorded for this deliverable.
        </p>
        <p className="deliverable-work-overview__hint">
          For line-level diff, use Git or your editor.
        </p>
      </section>
    );
  }

  return (
    <section className="deliverable-work-overview">
      <h3 className="deliverable-work-overview__title">Work done on this file</h3>
      <p className="deliverable-work-overview__subtitle">
        {indices.length} event{indices.length !== 1 ? "s" : ""} touched this file. Jump to an event to see it in the timeline.
      </p>
      <ul className="deliverable-work-overview__list">
        {indices.map((index) => {
          const event = session.events[index];
          const label = event ? actionLabel(event) : "?";
          const ts = event?.ts;
          return (
            <li key={`${deliverable.id}-${index}`} className="deliverable-work-overview__item">
              <button
                type="button"
                className="deliverable-work-overview__btn"
                onClick={() => onSeek(index)}
              >
                #{index + 1}
              </button>
              <span className="deliverable-work-overview__action">{label}</span>
              {ts ? (
                <span className="deliverable-work-overview__ts">{formatTs(ts)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="deliverable-work-overview__hint">
        For line-level diff, use Git or your editor.
      </p>
    </section>
  );
}
