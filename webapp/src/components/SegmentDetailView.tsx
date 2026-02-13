import { createTwoFilesPatch } from "diff";
import {
  isFileEditEvent,
  isFileCreateEvent,
  isFileDeleteEvent,
  isToolCallEvent,
  isDeliverableEvent,
} from "../types/session";
import type { Session, FileEditEvent, FileCreateEvent, FileDeleteEvent } from "../types/session";
import type { Segment } from "../lib/segments";

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
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
    });
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

export function SegmentDetailView({ session, segment, segmentIndex, onOpenFileEvolution }: SegmentDetailViewProps) {
  const events = session.events;
  const actions = segment.eventIndices
    .map((i) => ({ index: i, event: events[i] }))
    .filter(({ event }) => isToolCallEvent(event));
  const fileChanges = segment.eventIndices
    .map((i) => ({ index: i, event: events[i] }))
    .filter(
      (item): item is { index: number; event: FileEditEvent | FileCreateEvent | FileDeleteEvent } =>
        isFileEditEvent(item.event) || isFileCreateEvent(item.event) || isFileDeleteEvent(item.event)
    );
  const results = segment.eventIndices
    .map((i) => ({ index: i, event: events[i] }))
    .filter(({ event }) => isDeliverableEvent(event));

  const stepIndex = segment.planStep.index ?? segmentIndex;
  const timestamp = formatTimestamp(segment.planStep.at);

  return (
    <div className="segment-detail-view">
      <header className="segment-detail-header">
        <h2 className="segment-detail-title">{segment.planStep.step}</h2>
        <dl className="segment-detail-meta">
          <div>
            <dt>Index</dt>
            <dd>{stepIndex}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{timestamp}</dd>
          </div>
        </dl>
      </header>

      <div className="segment-detail-sections">
        {actions.length > 0 && (
          <section className="segment-section">
            <h3 className="segment-section-title">Actions</h3>
            <ul className="segment-list">
              {actions.map(({ index, event }) =>
                isToolCallEvent(event) ? (
                  <li key={index} className="segment-card">
                    <details className="action-details">
                      <summary>
                        <span className="action-name">{event.name}</span>
                        <span className="event-index-badge">Event {index + 1}</span>
                      </summary>
                      <div className="action-body">
                        {event.args != null && (
                          <div>
                            <strong>Args</strong>
                            <pre className="segment-code">{JSON.stringify(event.args, null, 2)}</pre>
                          </div>
                        )}
                        {event.result != null && (
                          <div>
                            <strong>Result</strong>
                            <pre className="segment-code">{JSON.stringify(event.result, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                ) : null
              )}
            </ul>
          </section>
        )}

        {fileChanges.length > 0 && (
          <section className="segment-section">
            <h3 className="segment-section-title">File changes</h3>
            <ul className="segment-list">
              {fileChanges.map(({ index, event }) => (
                <li key={index} className="segment-card file-card">
                  {onOpenFileEvolution && (
                    <button
                      type="button"
                      className="segment-open-evolution-btn"
                      onClick={() => onOpenFileEvolution(event.path, index)}
                    >
                      Open in file evolution
                    </button>
                  )}
                  {isFileEditEvent(event) && (
                    <>
                      <p className="file-path">{event.path} <span className="file-op">(edit)</span></p>
                      {event.old_content != null && event.new_content != null ? (
                        <UnifiedDiff oldContent={event.old_content} newContent={event.new_content} path={event.path} />
                      ) : (
                        <p className="segment-meta">No content captured for diff.</p>
                      )}
                    </>
                  )}
                  {isFileCreateEvent(event) && (
                    <>
                      <p className="file-path">{event.path} <span className="file-op">(create)</span></p>
                      {event.content != null ? (
                        <pre className="segment-code">{event.content}</pre>
                      ) : (
                        <p className="segment-meta">No content captured.</p>
                      )}
                    </>
                  )}
                  {isFileDeleteEvent(event) && (
                    <>
                      <p className="file-path">{event.path} <span className="file-op">(delete)</span></p>
                      {event.old_content != null && (
                        <pre className="segment-code">{event.old_content}</pre>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {results.length > 0 && (
          <section className="segment-section">
            <h3 className="segment-section-title">Results / Deliverables</h3>
            <ul className="segment-list">
              {results.map(({ index, event }) =>
                isDeliverableEvent(event) ? (
                  <li key={index} className="segment-card deliverable-card">
                    {event.title && <h4 className="deliverable-title">{event.title}</h4>}
                    {event.content && <p className="deliverable-content">{event.content}</p>}
                  </li>
                ) : null
              )}
            </ul>
          </section>
        )}

        {actions.length === 0 && fileChanges.length === 0 && results.length === 0 && (
          <p className="segment-empty">No actions, file changes, or deliverables in this step.</p>
        )}
      </div>
    </div>
  );
}
