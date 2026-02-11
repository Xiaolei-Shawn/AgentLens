import { getSegments } from "../lib/segments";
import type { Session } from "../types/session";
import type { Segment } from "../lib/segments";

import "./PlanNodesPanel.css";

interface PlanNodesPanelProps {
  session: Session;
  selectedSegmentIndex: number | null;
  onSelectSegment: (index: number) => void;
}

function formatTime(at: string | undefined): string {
  if (!at) return "—";
  try {
    const d = new Date(at);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return at;
  }
}

export function PlanNodesPanel({ session, selectedSegmentIndex, onSelectSegment }: PlanNodesPanelProps) {
  const segments = getSegments(session);

  if (segments.length === 0) {
    return (
      <aside className="plan-nodes-panel">
        <h2 className="panel-title">Plan steps</h2>
        <p className="panel-empty">No plan steps in this session.</p>
      </aside>
    );
  }

  return (
    <aside className="plan-nodes-panel">
      <h2 className="panel-title">Plan steps</h2>
      <ul className="plan-nodes-list" role="list">
        {segments.map((seg, i) => (
          <PlanNode
            key={seg.planStepIndex}
            segment={seg}
            index={i}
            isSelected={selectedSegmentIndex === i}
            onClick={() => onSelectSegment(i)}
          />
        ))}
      </ul>
    </aside>
  );
}

function PlanNode({
  segment,
  index,
  isSelected,
  onClick,
}: {
  segment: Segment;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const time = formatTime(segment.planStep.at);
  const eventCount = segment.eventIndices.length;

  return (
    <li>
      <button
        type="button"
        className={`plan-node-btn ${isSelected ? "selected" : ""}`}
        onClick={onClick}
        aria-pressed={isSelected}
        aria-expanded={isSelected}
        title={`Step ${segment.planStep.index ?? index + 1} · ${time}`}
      >
        <span className="plan-node-label">{segment.planStep.step}</span>
        <span className="plan-node-meta">
          {time} · {eventCount} event{eventCount !== 1 ? "s" : ""}
        </span>
      </button>
    </li>
  );
}
