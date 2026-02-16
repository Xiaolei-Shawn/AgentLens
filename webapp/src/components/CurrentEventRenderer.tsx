import { createTwoFilesPatch } from "diff";
import {
  getFilePathFromFileOp,
  getPayloadString,
  isFileOpEvent,
  isToolCallEvent,
  isVerificationEvent,
} from "../types/session";
import type { SessionEvent } from "../types/session";

import "./CurrentEventRenderer.css";

interface CurrentEventRendererProps {
  event: SessionEvent;
  index: number;
}

function UnifiedDiff({ oldContent, newContent, path }: { oldContent: string; newContent: string; path: string }) {
  const patch = createTwoFilesPatch(path, path, oldContent || "", newContent || "", "before", "after");
  const lines = patch.split("\n").slice(5);

  return (
    <pre className="diff-block">
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

function readOldNew(event: SessionEvent): { oldContent?: string; newContent?: string } {
  const details = event.payload.details && typeof event.payload.details === "object"
    ? (event.payload.details as Record<string, unknown>)
    : {};
  const oldContent =
    (typeof details.old_content === "string" ? details.old_content : undefined) ??
    (typeof event.payload.old_content === "string" ? event.payload.old_content : undefined);
  const newContent =
    (typeof details.new_content === "string" ? details.new_content : undefined) ??
    (typeof event.payload.new_content === "string" ? event.payload.new_content : undefined) ??
    (typeof event.payload.content === "string" ? event.payload.content : undefined);
  return { oldContent, newContent };
}

export function CurrentEventRenderer({ event, index }: CurrentEventRendererProps) {
  const path = getFilePathFromFileOp(event);
  const action = getPayloadString(event, "action") ?? "unknown";
  const { oldContent, newContent } = readOldNew(event);

  return (
    <div className="current-event-renderer">
      <header className="event-header">
        <span className="event-type">{event.kind}</span>
        <span className="event-index">Event {index + 1}</span>
      </header>
      <div className="event-body">
        {event.kind === "session_start" && <p className="event-meta">Session started.</p>}
        {event.kind === "session_end" && <p className="event-meta">Session ended.</p>}

        {event.kind === "intent" && (
          <div className="event-text">
            <h3>{getPayloadString(event, "title") ?? "Intent"}</h3>
            {getPayloadString(event, "description") && <p>{getPayloadString(event, "description")}</p>}
          </div>
        )}

        {event.kind === "decision" && (
          <div className="event-text event-audit event-audit--readable">
            <h3 className="audit-type">Decision</h3>
            {getPayloadString(event, "summary") && (
              <p><strong>Summary:</strong> {getPayloadString(event, "summary")}</p>
            )}
            {getPayloadString(event, "rationale") && (
              <p><strong>Rationale:</strong> {getPayloadString(event, "rationale")}</p>
            )}
            {event.payload?.options != null && Array.isArray(event.payload.options) && event.payload.options.length > 0 && (
              <div className="event-audit-block">
                <strong>Options:</strong>
                <ul className="event-audit-list">
                  {(event.payload.options as string[]).map((opt, idx) => (
                    <li key={idx}>{opt}</li>
                  ))}
                </ul>
              </div>
            )}
            {getPayloadString(event, "chosen_option") && (
              <p><strong>Chosen:</strong> {getPayloadString(event, "chosen_option")}</p>
            )}
            {event.payload?.reversibility != null && (
              <p><strong>Reversibility:</strong> {String(event.payload.reversibility)}</p>
            )}
          </div>
        )}
        {event.kind === "assumption" && (
          <div className="event-text event-audit event-audit--readable">
            <h3 className="audit-type">Assumption</h3>
            {getPayloadString(event, "statement") && (
              <p><strong>Statement:</strong> {getPayloadString(event, "statement")}</p>
            )}
            {event.payload?.validated !== undefined && (
              <p><strong>Validated:</strong> {typeof event.payload.validated === "boolean" ? (event.payload.validated ? "Yes" : "No") : String(event.payload.validated)}</p>
            )}
            {event.payload?.risk != null && (
              <p><strong>Risk:</strong> {String(event.payload.risk)}</p>
            )}
          </div>
        )}

        {isVerificationEvent(event) && (
          <div className="event-text">
            <h3>
              {getPayloadString(event, "type") ?? "verification"}: {getPayloadString(event, "result") ?? "unknown"}
            </h3>
            {getPayloadString(event, "details") && <p>{getPayloadString(event, "details")}</p>}
          </div>
        )}

        {isFileOpEvent(event) && (
          <div className="event-file">
            <p className="event-path">{path ?? "(unknown path)"} ({action})</p>
            {action === "edit" && oldContent != null && newContent != null && (
              <UnifiedDiff oldContent={oldContent} newContent={newContent} path={path ?? "file"} />
            )}
            {action === "create" && newContent != null && <pre className="code-block">{newContent}</pre>}
            {action === "delete" && oldContent != null && <pre className="code-block">{oldContent}</pre>}
            {((action === "edit" && (oldContent == null || newContent == null)) ||
              ((action === "create" || action === "delete") && oldContent == null && newContent == null)) && (
              <p className="event-meta">No content captured for file diff.</p>
            )}
          </div>
        )}

        {isToolCallEvent(event) && (
          <div className="event-text">
            <h3>{getPayloadString(event, "action") ?? "tool_call"}</h3>
            <details>
              <summary>Payload</summary>
              <pre className="code-block">{JSON.stringify(event.payload, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

