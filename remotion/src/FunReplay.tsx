/**
 * Fun session replay: bouncy event cards, spring entrances, typewriter-style text.
 * Same session format as SessionReplay; tuned for a more playful animation.
 */

import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  AbsoluteFill,
  interpolate,
  spring,
} from "remotion";
import type { Session, SessionEvent } from "./types/session";
import { getEventSegments, getCurrentEvent } from "./FrameToEvent";

interface FunReplayProps {
  session: Session;
}

const EVENT_COLORS: Record<string, { bg: string; accent: string; label: string }> = {
  session_start: { bg: "#2d2d30", accent: "#888", label: "Start" },
  plan_step: { bg: "#1e3a5f", accent: "#60a5fa", label: "Plan" },
  audit_event: { bg: "#1e2d3a", accent: "#38bdf8", label: "Reasoning" },
  tool_call: { bg: "#422c1e", accent: "#fbbf24", label: "Tool" },
  file_edit: { bg: "#1e3d2e", accent: "#34d399", label: "Edit" },
  file_create: { bg: "#1e3d2e", accent: "#6ee7b7", label: "New" },
  file_delete: { bg: "#3d1e1e", accent: "#f87171", label: "Delete" },
  deliverable: { bg: "#3d1e3d", accent: "#c084fc", label: "Done" },
};

function getEventStyle(e: SessionEvent) {
  const key =
    e.type === "file_edit"
      ? "file_edit"
      : e.type === "file_create"
        ? "file_create"
        : e.type === "file_delete"
          ? "file_delete"
          : e.type;
  return EVENT_COLORS[key] ?? EVENT_COLORS.tool_call;
}

function getAuditLabel(e: SessionEvent): string {
  if (e.type !== "audit_event") return "";
  const t = (e as { audit_type: string }).audit_type;
  return t === "interpretation" ? "Interpretation" : t === "reasoning" ? "Reasoning" : t === "decision" ? "Decision" : t;
}

function getMainText(event: SessionEvent): string {
  if (event.type === "plan_step") return event.step ?? "";
  if (event.type === "audit_event") return (event as { audit_type: string }).audit_type + ": " + ((event as { description: string }).description?.slice(0, 60) ?? "");
  if (event.type === "deliverable") return event.title ?? event.content?.slice(0, 80) ?? "";
  if (event.type === "tool_call") return event.name ?? "";
  if (
    event.type === "file_edit" ||
    event.type === "file_create" ||
    event.type === "file_delete"
  )
    return event.path ?? "";
  if (event.type === "session_start") return "Session started";
  return "";
}

export const FunReplay: React.FC<FunReplayProps> = ({ session }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const segments = React.useMemo(
    () => getEventSegments(session, durationInFrames, "equal"),
    [session, durationInFrames]
  );
  const current = getCurrentEvent(segments, frame);
  const eventIndex = current?.eventIndex ?? 0;
  const event = session.events[eventIndex] ?? null;
  const segment = current?.segment;
  const progressInSegment = current?.progress ?? 0;

  // Progress bar: driven by frame (no CSS transition)
  const progressWidth = interpolate(
    frame,
    [0, durationInFrames],
    [0, 100],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  if (!event) {
    return (
      <AbsoluteFill
        style={{
          background: "linear-gradient(180deg, #0f0f12 0%, #1a1a24 100%)",
          alignItems: "center",
          justifyContent: "center",
          color: "#888",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p>No events</p>
      </AbsoluteFill>
    );
  }

  const style = getEventStyle(event);
  const mainText = getMainText(event);

  // Card entrance: spring from segment start (bouncy)
  const segmentStart = segment?.startFrame ?? 0;
  const entrance = spring({
    frame: frame - segmentStart,
    fps,
    config: { damping: 10, stiffness: 120 },
  });
  const scale = 0.85 + entrance * 0.15;
  const opacity = interpolate(entrance, [0, 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Typewriter: reveal characters over first ~60% of segment
  const segmentFrames = segment ? segment.endFrame - segment.startFrame : 30;
  const typewriterFrames = Math.min(segmentFrames * 0.6, fps * 2);
  const frameInSegment = frame - segmentStart;
  const charsVisible = Math.floor(
    interpolate(
      frameInSegment,
      [0, typewriterFrames],
      [0, mainText.length],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    )
  );
  const visibleText = mainText.slice(0, charsVisible);

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #0f0f12 0%, #1a1a24 50%, #0d0d10 100%)",
        fontFamily: "system-ui, sans-serif",
        padding: 32,
      }}
    >
      {/* Title */}
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff" }}>
          {session.title}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "#888" }}>
          Event {eventIndex + 1} of {session.events.length}
        </p>
      </header>

      {/* Progress bar (frame-driven) */}
      <div
        style={{
          height: 6,
          background: "#2a2a2e",
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 24,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressWidth}%`,
            background: `linear-gradient(90deg, ${style.accent}, #646cff)`,
            borderRadius: 3,
          }}
        />
      </div>

      {/* Event card with spring entrance */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            opacity,
            transform: `scale(${scale})`,
            background: style.bg,
            borderRadius: 16,
            borderLeft: `4px solid ${style.accent}`,
            padding: 24,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          <span
            style={{
              display: "inline-block",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: style.accent,
              marginBottom: 12,
            }}
          >
            {event.type === "audit_event" ? getAuditLabel(event) : style.label}
          </span>
          <h2
            style={{
              margin: "0 0 8px",
              fontSize: 20,
              fontWeight: 600,
              color: "#fff",
              lineHeight: 1.35,
              minHeight: 28,
            }}
          >
            {visibleText}
            {(charsVisible < mainText.length || mainText.length === 0) && (
              <span style={{ opacity: 0.7 }}>▌</span>
            )}
          </h2>
          {event.type === "deliverable" && event.content && (
            <p
              style={{
                margin: "8px 0 0",
                fontSize: 14,
                color: "rgba(255,255,255,0.8)",
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflow: "hidden",
              }}
            >
              {event.content}
            </p>
          )}
          {event.type === "tool_call" && event.result != null && (
            <pre
              style={{
                margin: "8px 0 0",
                fontSize: 12,
                color: "rgba(255,255,255,0.7)",
                whiteSpace: "pre-wrap",
                maxHeight: 120,
                overflow: "hidden",
              }}
            >
              {typeof event.result === "string"
                ? event.result
                : JSON.stringify(event.result).slice(0, 200)}
            </pre>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const defaultFunReplayProps: FunReplayProps = {
  session: {
    id: "placeholder",
    started_at: new Date().toISOString(),
    title: "Load a session",
    user_message: "",
    events: [],
  },
};
