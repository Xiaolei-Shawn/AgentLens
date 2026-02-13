/**
 * S25: Root composition for session replay.
 * S27: Timeline strip + story steps. S28: Current event content.
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from "remotion";
import type { Session } from "./types/session";
import { getEventSegments, getCurrentEvent } from "./FrameToEvent";
import { isPlanStepEvent, isDeliverableEvent } from "./types/session";

const FPS = 30;
const FRAMES_PER_EVENT = 30;

interface SessionReplayProps {
  session: Session;
}

export const SessionReplay: React.FC<SessionReplayProps> = ({ session }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const segments = React.useMemo(
    () => getEventSegments(session, durationInFrames, "equal"),
    [session, durationInFrames]
  );
  const current = getCurrentEvent(segments, frame);
  const eventIndex = current?.eventIndex ?? 0;
  const event = session.events[eventIndex] ?? null;

  const stepIndices = React.useMemo(
    () =>
      session.events
        .map((e, i) => (isPlanStepEvent(e) || isDeliverableEvent(e) ? i : -1))
        .filter((i) => i >= 0),
    [session.events]
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#1a1a1a",
        color: "#eee",
        fontFamily: "system-ui, sans-serif",
        padding: 24,
      }}
    >
      <header style={{ marginBottom: 16, borderBottom: "1px solid #333", paddingBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>{session.title}</h1>
        <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#888" }}>
          Event {eventIndex + 1} / {session.events.length}
        </p>
      </header>

      {/* S27: Timeline strip + playhead */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            height: 8,
            background: "#333",
            borderRadius: 4,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${session.events.length > 0 ? ((eventIndex + 1) / session.events.length) * 100 : 0}%`,
              background: "#646cff",
              borderRadius: 4,
              transition: "width 0.05s linear",
            }}
          />
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 24 }}>
        {/* S27: Story steps list */}
        <aside
          style={{
            width: 200,
            flexShrink: 0,
            overflowY: "auto",
            borderRight: "1px solid #333",
            paddingRight: 16,
          }}
        >
          <h3 style={{ fontSize: 11, color: "#888", textTransform: "uppercase", margin: "0 0 8px 0" }}>
            Story steps
          </h3>
          {stepIndices.map((idx) => (
            <div
              key={idx}
              style={{
                padding: "6px 8px",
                marginBottom: 4,
                borderRadius: 6,
                background: idx === eventIndex ? "rgba(100,108,255,0.3)" : "transparent",
                fontSize: 13,
              }}
            >
              {isPlanStepEvent(session.events[idx]!)
                ? (session.events[idx] as { step: string }).step
                : (session.events[idx] as { title?: string; content?: string }).title ??
                  (session.events[idx] as { content?: string }).content ??
                  "Deliverable"}
            </div>
          ))}
        </aside>

        {/* S28: Current event content */}
        <main style={{ flex: 1, overflow: "auto", fontSize: 14 }}>
          {event && (
            <CurrentEventContent event={event} eventIndex={eventIndex} />
          )}
        </main>
      </div>
    </AbsoluteFill>
  );
};

function CurrentEventContent({
  event,
  eventIndex,
}: {
  event: Session["events"][number];
  eventIndex: number;
}) {
  if (event.type === "session_start") {
    return <p style={{ color: "#888" }}>Session started.</p>;
  }
  if (event.type === "audit_event") {
    return (
      <div>
        <h3 style={{ margin: "0 0 8px 0", color: "#9ca3af", textTransform: "capitalize" }}>{event.audit_type}</h3>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{event.description}</p>
      </div>
    );
  }
  if (event.type === "plan_step") {
    return (
      <div>
        <h3 style={{ margin: "0 0 8px 0" }}>{event.step}</h3>
        {event.index !== undefined && (
          <p style={{ margin: 0, fontSize: 12, color: "#888" }}>Step {event.index}</p>
        )}
      </div>
    );
  }
  if (event.type === "deliverable") {
    return (
      <div>
        {event.title && <h3 style={{ margin: "0 0 8px 0" }}>{event.title}</h3>}
        {event.content && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{event.content}</p>}
      </div>
    );
  }
  if (event.type === "file_edit") {
    return (
      <div>
        <p style={{ margin: "0 0 8px 0", color: "#646cff", fontFamily: "monospace" }}>{event.path}</p>
        {event.old_content != null && event.new_content != null ? (
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "#222",
              borderRadius: 6,
              fontSize: 12,
              overflow: "auto",
              whiteSpace: "pre",
            }}
          >
            {event.new_content}
          </pre>
        ) : (
          <p style={{ color: "#888" }}>Edit (no content captured)</p>
        )}
      </div>
    );
  }
  if (event.type === "file_create") {
    return (
      <div>
        <p style={{ margin: "0 0 8px 0", color: "#646cff", fontFamily: "monospace" }}>{event.path} (create)</p>
        {event.content != null ? (
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "#222",
              borderRadius: 6,
              fontSize: 12,
              overflow: "auto",
              whiteSpace: "pre",
            }}
          >
            {event.content}
          </pre>
        ) : (
          <p style={{ color: "#888" }}>Created (no content)</p>
        )}
      </div>
    );
  }
  if (event.type === "file_delete") {
    return (
      <div>
        <p style={{ margin: "0 0 8px 0", color: "#646cff", fontFamily: "monospace" }}>{event.path} (deleted)</p>
        {event.old_content != null && (
          <pre style={{ margin: 0, padding: 12, background: "#222", borderRadius: 6, fontSize: 12 }}>
            {event.old_content}
          </pre>
        )}
      </div>
    );
  }
  if (event.type === "tool_call") {
    return (
      <div>
        <h3 style={{ margin: "0 0 8px 0" }}>{event.name}</h3>
        {event.result != null && (
          <pre style={{ margin: 0, fontSize: 12, color: "#888" }}>
            {JSON.stringify(event.result, null, 2)}
          </pre>
        )}
      </div>
    );
  }
  return null;
}

export const defaultSessionReplayProps: SessionReplayProps = {
  session: {
    id: "placeholder",
    started_at: new Date().toISOString(),
    title: "Load a session",
    user_message: "",
    events: [],
  },
};
