import { createTwoFilesPatch } from "diff";
import {
  isPlanStepEvent,
  isAuditEvent,
  isDeliverableEvent,
  isFileEditEvent,
  isFileCreateEvent,
  isFileDeleteEvent,
  isToolCallEvent,
} from "../types/session";
import type { SessionEvent } from "../types/session";

import "./CurrentEventRenderer.css";

interface CurrentEventRendererProps {
  event: SessionEvent;
  index: number;
}

function UnifiedDiff({
  oldContent,
  newContent,
  path,
}: {
  oldContent: string;
  newContent: string;
  path: string;
}) {
  const patch = createTwoFilesPatch(
    path,
    path,
    oldContent || "",
    newContent || "",
    "before",
    "after",
  );
  const lines = patch.split("\n").slice(5); // skip header

  return (
    <pre className="diff-block">
      {lines.map((line, i) => {
        const className =
          line.startsWith("+") && !line.startsWith("+++")
            ? "diff-add"
            : line.startsWith("-") && !line.startsWith("---")
              ? "diff-remove"
              : "";
        return (
          <div
            key={i}
            className={className ? `diff-line ${className}` : "diff-line"}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function CurrentEventRenderer({
  event,
  index,
}: CurrentEventRendererProps) {
  return (
    <div className="current-event-renderer">
      <header className="event-header">
        <span className="event-type">{event.type}</span>
        <span className="event-index">Event {index + 1}</span>
      </header>
      <div className="event-body">
        {isPlanStepEvent(event) && (
          <div className="event-text">
            <h3>{event.step}</h3>
            {event.index !== undefined && (
              <p className="event-meta">Step index: {event.index}</p>
            )}
          </div>
        )}
        {isAuditEvent(event) && (
          <div className="event-text event-audit">
            <h3 className="audit-type">{event.audit_type}</h3>
            <p>{event.description}</p>
          </div>
        )}
        {isDeliverableEvent(event) && (
          <div className="event-text">
            {event.title && <h3>{event.title}</h3>}
            {event.content && <p>{event.content}</p>}
          </div>
        )}
        {isFileEditEvent(event) && (
          <div className="event-file">
            <p className="event-path">{event.path}</p>
            {event.old_content != null && event.new_content != null ? (
              <UnifiedDiff
                oldContent={event.old_content}
                newContent={event.new_content}
                path={event.path}
              />
            ) : (
              <p className="event-meta">No content captured for diff.</p>
            )}
          </div>
        )}
        {isFileCreateEvent(event) && (
          <div className="event-file">
            <p className="event-path">{event.path} (created)</p>
            {event.content != null ? (
              <pre className="code-block">{event.content}</pre>
            ) : (
              <p className="event-meta">No content captured.</p>
            )}
          </div>
        )}
        {isFileDeleteEvent(event) && (
          <div className="event-file">
            <p className="event-path">{event.path} (deleted)</p>
            {event.old_content != null && (
              <pre className="code-block">{event.old_content}</pre>
            )}
          </div>
        )}
        {isToolCallEvent(event) && (
          <div className="event-text">
            <h3>{event.name}</h3>
            {event.args != null && (
              <details>
                <summary>Args</summary>
                <pre className="code-block">
                  {JSON.stringify(event.args, null, 2)}
                </pre>
              </details>
            )}
            {event.result != null && (
              <details>
                <summary>Result</summary>
                <pre className="code-block">
                  {JSON.stringify(event.result, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
        {event.type === "session_start" && (
          <p className="event-meta">Session started.</p>
        )}
      </div>
    </div>
  );
}
