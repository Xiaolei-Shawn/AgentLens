import { createTwoFilesPatch } from "diff";
import type { Session } from "../types/session";
import {
  getFilePathFromFileOp,
  getPayloadString,
  isAssumptionEvent,
  isDecisionEvent,
  isFileOpEvent,
  isToolCallEvent,
  isVerificationEvent,
} from "../types/session";
import type { Segment } from "../lib/segments";
import { getSegmentTitle } from "../lib/segments";

import "./SegmentDetailView.css";

interface SegmentDetailViewProps {
  session: Session;
  segment: Segment;
  segmentIndex: number;
  onOpenFileEvolution?: (path: string, eventIndex: number) => void;
}

function formatTimestamp(at: string | undefined): string {
  if (!at) return "—";
  try {
    const d = new Date(at);
    return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return at;
  }
}

function UnifiedDiff({ oldContent, newContent, path }: { oldContent: string; newContent: string; path: string }) {
  const patch = createTwoFilesPatch(path, path, oldContent || "", newContent || "", "before", "after");
  const lines = patch.split("\n").slice(5);
  return (
    <pre className="segment-diff-block">
      {lines.map((line, i) => {
        const className =
          line.startsWith("+") && !line.startsWith("+++") ? "diff-add" : line.startsWith("-") && !line.startsWith("---") ? "diff-remove" : "";
        return (
          <div key={i} className={className ? `diff-line ${className}` : "diff-line"}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

function readDetailsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readOldNew(event: Session["events"][number]): { oldContent?: string; newContent?: string } {
  const details = readDetailsObject(event.payload.details);
  const oldContent =
    (typeof details.old_content === "string" ? details.old_content : undefined) ??
    (typeof event.payload.old_content === "string" ? event.payload.old_content : undefined);
  const newContent =
    (typeof details.new_content === "string" ? details.new_content : undefined) ??
    (typeof event.payload.new_content === "string" ? event.payload.new_content : undefined) ??
    (typeof event.payload.content === "string" ? event.payload.content : undefined);
  return { oldContent, newContent };
}

export function SegmentDetailView({ session, segment, segmentIndex, onOpenFileEvolution }: SegmentDetailViewProps) {
  const events = session.events;
  const actionEvents = segment.eventIndices
    .map((i) => ({ index: i, event: events[i] }))
    .filter(({ event }) => isToolCallEvent(event));
  const fileChanges = segment.eventIndices
    .map((i) => ({ index: i, event: events[i] }))
    .filter(({ event }) => isFileOpEvent(event));
  const reasoning = segment.eventIndices
    .map((i) => ({ index: i, event: events[i] }))
    .filter(({ event }) => isDecisionEvent(event) || isAssumptionEvent(event) || isVerificationEvent(event));

  const title = getSegmentTitle(segment, segmentIndex);
  const timestamp = formatTimestamp(segment.planStep.ts);
  const intentId = segment.planStep.scope?.intent_id ?? getPayloadString(segment.planStep, "intent_id") ?? "fallback";

  return (
    <div className="segment-detail-view">
      <header className="segment-detail-header">
        <h2 className="segment-detail-title">{title}</h2>
        <dl className="segment-detail-meta">
          <div>
            <dt>Intent</dt>
            <dd>{intentId}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{timestamp}</dd>
          </div>
        </dl>
      </header>

      <div className="segment-detail-sections">
        {actionEvents.length > 0 && (
          <section className="segment-section">
            <h3 className="segment-section-title">Activities</h3>
            <ul className="segment-list">
              {actionEvents.map(({ index, event }) => (
                <li key={index} className="segment-card">
                  <details className="action-details">
                    <summary>
                      <span className="action-name">{getPayloadString(event, "action") ?? "tool_call"}</span>
                      <span className="event-index-badge">Event {index + 1}</span>
                    </summary>
                    <div className="action-body">
                      <pre className="segment-code">{JSON.stringify(event.payload, null, 2)}</pre>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        )}

        {fileChanges.length > 0 && (
          <section className="segment-section">
            <h3 className="segment-section-title">File changes</h3>
            <ul className="segment-list">
              {fileChanges.map(({ index, event }) => {
                const path = getFilePathFromFileOp(event) ?? "(unknown path)";
                const action = getPayloadString(event, "action") ?? "edit";
                const { oldContent, newContent } = readOldNew(event);
                return (
                  <li key={index} className="segment-card file-card">
                    {onOpenFileEvolution && (
                      <button
                        type="button"
                        className="segment-open-evolution-btn"
                        onClick={() => onOpenFileEvolution(path, index)}
                      >
                        Open in file evolution
                      </button>
                    )}
                    <p className="file-path">
                      {path} <span className="file-op">({action})</span>
                    </p>
                    {action === "edit" && oldContent != null && newContent != null && (
                      <UnifiedDiff oldContent={oldContent} newContent={newContent} path={path} />
                    )}
                    {action === "create" && newContent != null && <pre className="segment-code">{newContent}</pre>}
                    {action === "delete" && oldContent != null && <pre className="segment-code">{oldContent}</pre>}
                    {((action === "edit" && (oldContent == null || newContent == null)) ||
                      ((action === "create" || action === "delete") && oldContent == null && newContent == null)) && (
                      <p className="segment-meta">No content captured for this change.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {reasoning.length > 0 && (
          <section className="segment-section">
            <h3 className="segment-section-title">Reasoning & checks</h3>
            <ul className="segment-list">
              {reasoning.map(({ index, event }) => (
                <li key={index} className="segment-card deliverable-card">
                  <h4 className="deliverable-title">{event.kind}</h4>
                  <p className="deliverable-content">{JSON.stringify(event.payload)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {actionEvents.length === 0 && fileChanges.length === 0 && reasoning.length === 0 && (
          <p className="segment-empty">No activities recorded in this segment.</p>
        )}
      </div>
    </div>
  );
}

