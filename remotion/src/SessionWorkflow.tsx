/**
 * SessionWorkflow: animated flow view for session lifecycle.
 * Frame drives current step; renders horizontal nodes (completed/current/pending) and progress bar.
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from "remotion";
import type { Session, SessionEvent } from "./types/session";
import {
  isPlanStepEvent,
  isAuditEvent,
  isDeliverableEvent,
} from "./types/session";

const FRAMES_PER_EVENT = 30;
const NODE_R = 28;
const GAP = 40;

function getEventLabel(e: SessionEvent): string {
  if (e.type === "session_start") return "Start";
  if (isPlanStepEvent(e))
    return e.step.slice(0, 20) + (e.step.length > 20 ? "…" : "");
  if (isAuditEvent(e)) return e.audit_type;
  if (isDeliverableEvent(e)) return e.title ?? "Deliverable";
  if (e.type === "tool_call") return e.name;
  if (
    e.type === "file_edit" ||
    e.type === "file_create" ||
    e.type === "file_delete"
  ) {
    const name = (e.path as string).split("/").pop() ?? e.path;
    return (
      (name as string).slice(0, 14) + ((name as string).length > 14 ? "…" : "")
    );
  }
  return "Event";
}

export interface SessionWorkflowProps {
  session: Session;
}

export const SessionWorkflow: React.FC<SessionWorkflowProps> = ({
  session,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const events = session.events;
  const lastIndex = events.length - 1;
  const currentIndex = Math.min(
    lastIndex,
    Math.max(0, Math.floor(frame / FRAMES_PER_EVENT)),
  );
  const stepNum = events.length === 0 ? 0 : currentIndex + 1;
  const percent = events.length <= 1 ? 100 : (stepNum / events.length) * 100;

  const nodeWidth = NODE_R * 2 + GAP;
  const totalWidth = events.length * nodeWidth - GAP;
  const positions = events.map((_, i) => i * nodeWidth + NODE_R);
  const startX = (width - totalWidth) / 2 + NODE_R;
  const centerY = height * 0.38;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0f0f12",
        color: "#e4e4e7",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ color: "#3b82f6", fontSize: 20 }}>◇</span>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          Workflow Visualizer
        </h1>
      </div>

      {/* Flow: horizontal nodes */}
      <svg width={width} height={centerY + 80} style={{ overflow: "visible" }}>
        {events.length > 1 &&
          events.slice(0, -1).map((_, i) => {
            const cx_i = startX + positions[i] - NODE_R;
            const cx_next = startX + positions[i + 1] - NODE_R;
            const x1 = cx_i + NODE_R;
            const x2 = cx_next - NODE_R;
            return (
              <line
                key={i}
                x1={x1}
                y1={centerY}
                x2={x2}
                y2={centerY}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={2}
              />
            );
          })}
        {events.map((event, i) => {
          const isCompleted = i < currentIndex;
          const isRunning = i === currentIndex;
          const cx = startX + positions[i] - NODE_R;
          const cy = centerY;
          const label = getEventLabel(event);
          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r={NODE_R}
                fill={
                  isCompleted
                    ? "rgba(59,130,246,0.4)"
                    : isRunning
                      ? "rgba(59,130,246,0.25)"
                      : "rgba(255,255,255,0.06)"
                }
                stroke={
                  isRunning ? "rgba(59,130,246,0.9)" : "rgba(255,255,255,0.2)"
                }
                strokeWidth={2}
                strokeDasharray={isRunning ? "8 4" : undefined}
              />
              {isCompleted && (
                <circle
                  cx={cx + NODE_R - 6}
                  cy={cy - NODE_R + 6}
                  r={10}
                  fill="#22c55e"
                />
              )}
              <text
                x={cx}
                y={cy + NODE_R + 16}
                textAnchor="middle"
                fill="rgba(255,255,255,0.9)"
                fontSize={11}
              >
                {label}
              </text>
              {isRunning && (
                <text
                  x={cx}
                  y={cy + NODE_R + 30}
                  textAnchor="middle"
                  fill="#3b82f6"
                  fontSize={9}
                  fontWeight={700}
                >
                  RUNNING
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Progress bar */}
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 24,
          right: 24,
          padding: "12px 16px",
          background: "rgba(255,255,255,0.06)",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.7)",
            marginBottom: 6,
            textTransform: "uppercase",
          }}
        >
          STEP {stepNum} OF {events.length || 1}
        </div>
        <div
          style={{
            height: 8,
            background: "rgba(255,255,255,0.15)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              background: "linear-gradient(90deg, #3b82f6, #06b6d4)",
              borderRadius: 4,
            }}
          />
        </div>
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.5)",
            marginTop: 4,
          }}
        >
          {events.length <= 1 ? "100" : Math.round(percent)}% COMPLETE
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const defaultSessionWorkflowProps: SessionWorkflowProps = {
  session: {
    id: "workflow-demo",
    started_at: new Date().toISOString(),
    title: "Session Workflow",
    user_message: "Demo",
    events: [
      { type: "session_start", at: new Date().toISOString() },
      { type: "plan_step", step: "Plan step 1", index: 0 },
      { type: "plan_step", step: "Plan step 2", index: 1 },
      { type: "deliverable", title: "Done", at: new Date().toISOString() },
    ],
  },
};
