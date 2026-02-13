import type { SessionEvent } from "../types/session";
import {
  isPlanStepEvent,
  isAuditEvent,
  isDeliverableEvent,
} from "../types/session";

export type NodeKind =
  | "start"
  | "plan"
  | "audit"
  | "tool"
  | "file"
  | "deliverable"
  | "other";

/** True for session_start, plan_step, deliverable — "key moments" in the flow. */
export function isKeyMoment(
  event: SessionEvent,
  index: number,
  lastIndex: number,
): boolean {
  if (event.type === "session_start" || index === 0) return true;
  if (event.type === "deliverable" || index === lastIndex) return true;
  if (isPlanStepEvent(event)) return true;
  return false;
}

export function getNodeKind(
  event: SessionEvent,
  index: number,
  lastIndex: number,
): NodeKind {
  if (event.type === "session_start" || index === 0) return "start";
  if (event.type === "deliverable" || index === lastIndex) return "deliverable";
  if (isPlanStepEvent(event)) return "plan";
  if (isAuditEvent(event)) return "audit";
  if (event.type === "tool_call") return "tool";
  if (
    event.type === "file_edit" ||
    event.type === "file_create" ||
    event.type === "file_delete"
  )
    return "file";
  return "other";
}

/** SVG path d for a simple geometric shape by node kind (same as Flow View). */
export function getIconPath(kind: NodeKind | string): string {
  const r = 7;
  const paths: Record<string, string> = {
    start: `M 0,-${r} a ${r},${r} 0 1 1 0,${2 * r} a ${r},${r} 0 1 1 0,${-2 * r}`,
    plan: `M 0,-${r} L ${r},0 L 0,${r} L ${-r},0 Z`,
    audit: `M ${r},0 L ${r * 0.5},${-r * 0.87} L ${-r * 0.5},${-r * 0.87} L ${-r},0 L ${-r * 0.5},${r * 0.87} L ${r * 0.5},${r * 0.87} Z`,
    tool: `M 0,-${r} L ${r},${r} L ${-r},${r} Z`,
    file: `M ${-r},${-r} L ${r},${-r} L ${r},${r} L ${-r},${r} Z`,
    deliverable: `M 0,-${r} L ${r * 0.95},${-r * 0.31} L ${r * 0.59},${r * 0.81} L ${-r * 0.59},${r * 0.81} L ${-r * 0.95},${-r * 0.31} Z`,
    other: `M 0,-${r} a ${r},${r} 0 1 1 0,${2 * r} a ${r},${r} 0 1 1 0,${-2 * r}`,
  };
  return paths[kind] ?? paths.other;
}

export function getEventShortLabel(event: SessionEvent): string {
  if (event.type === "session_start") return "Start";
  if (isPlanStepEvent(event))
    return event.step.slice(0, 30) + (event.step.length > 30 ? "…" : "");
  if (isAuditEvent(event)) return event.audit_type;
  if (isDeliverableEvent(event)) return event.title ?? "Deliverable";
  if (event.type === "tool_call") return event.name;
  if (
    event.type === "file_edit" ||
    event.type === "file_create" ||
    event.type === "file_delete"
  ) {
    const path = (event as { path: string }).path;
    const name = path.split("/").pop() ?? path;
    return name.slice(0, 18) + (name.length > 18 ? "…" : "");
  }
  return "Event";
}

/** One-line summary for event (for bottom strip). */
export function getEventSummary(event: SessionEvent): string {
  if (event.type === "session_start") return "Session started.";
  if (isPlanStepEvent(event))
    return event.step.slice(0, 80) + (event.step.length > 80 ? "…" : "");
  if (isAuditEvent(event))
    return (
      event.description.slice(0, 80) +
      (event.description.length > 80 ? "…" : "")
    );
  if (isDeliverableEvent(event)) {
    const title = event.title ?? "Deliverable";
    const content = event.content ? String(event.content).slice(0, 50) : "";
    return content
      ? title + ": " + content + (String(event.content).length > 50 ? "…" : "")
      : title;
  }
  if (event.type === "tool_call") return `${event.name}`;
  if (
    event.type === "file_edit" ||
    event.type === "file_create" ||
    event.type === "file_delete"
  ) {
    const path = (event as { path: string }).path;
    return `${event.type}: ${path.split("/").pop() ?? path}`;
  }
  return event.type;
}

export function formatEventLogLine(
  event: SessionEvent,
  _index: number,
): string {
  const at = "at" in event && event.at ? event.at : "";
  const time = at
    ? new Date(at).toLocaleTimeString(undefined, { hour12: false })
    : "--:--:--";
  const label = getEventShortLabel(event);
  return `[${time}] ${event.type}: ${label}`;
}

/** Duration in ms from event at fromIndex to event at toIndex (using .at if present). */
export function getDurationMs(
  events: { at?: string }[],
  fromIndex: number,
  toIndex: number,
): number | null {
  if (fromIndex < 0 || toIndex >= events.length || fromIndex >= toIndex)
    return null;
  const fromAt = events[fromIndex]?.at;
  const toAt = events[toIndex]?.at;
  if (!fromAt || !toAt) return null;
  const a = new Date(fromAt).getTime();
  const b = new Date(toAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b - a;
}

/** Format duration for display (e.g. "1.2s" or "—"). */
export function formatDurationMs(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
