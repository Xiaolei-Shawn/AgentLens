import type { SessionEvent } from "../types/session";
import {
  getEventTimestamp,
  getFilePathFromFileOp,
  getPayloadString,
  isAssumptionEvent,
  isDecisionEvent,
  isFileOpEvent,
  isIntentEvent,
  isToolCallEvent,
  isVerificationEvent,
} from "../types/session";

export type NodeKind =
  | "start"
  | "intent"
  | "decision"
  | "assumption"
  | "verification"
  | "tool"
  | "file"
  | "end"
  | "other";

export function isKeyMoment(event: SessionEvent, index: number, lastIndex: number): boolean {
  if (event.kind === "session_start" || index === 0) return true;
  if (event.kind === "session_end" || index === lastIndex) return true;
  return isIntentEvent(event) || isDecisionEvent(event) || isVerificationEvent(event);
}

export function getNodeKind(event: SessionEvent, index: number, lastIndex: number): NodeKind {
  if (event.kind === "session_start" || index === 0) return "start";
  if (event.kind === "session_end" || index === lastIndex) return "end";
  if (isIntentEvent(event)) return "intent";
  if (isDecisionEvent(event)) return "decision";
  if (isAssumptionEvent(event)) return "assumption";
  if (isVerificationEvent(event)) return "verification";
  if (isToolCallEvent(event)) return "tool";
  if (isFileOpEvent(event)) return "file";
  return "other";
}

export function getIconPath(kind: NodeKind | string): string {
  const r = 7;
  const paths: Record<string, string> = {
    start: `M 0,-${r} a ${r},${r} 0 1 1 0,${2 * r} a ${r},${r} 0 1 1 0,${-2 * r}`,
    intent: `M 0,-${r} L ${r},0 L 0,${r} L ${-r},0 Z`,
    decision: `M ${-r},0 L 0,${-r} L ${r},0 L 0,${r} Z`,
    assumption: `M 0,-${r} L ${r},${r} L ${-r},${r} Z`,
    verification: `M ${-r},${-r} L ${r},${-r} L ${r},${r} L ${-r},${r} Z`,
    tool: `M 0,-${r} L ${r},${r} L ${-r},${r} Z`,
    file: `M ${-r},${-r} L ${r},${-r} L ${r},${r} L ${-r},${r} Z`,
    end: `M 0,-${r} L ${r * 0.95},${-r * 0.31} L ${r * 0.59},${r * 0.81} L ${-r * 0.59},${r * 0.81} L ${-r * 0.95},${-r * 0.31} Z`,
    other: `M 0,-${r} a ${r},${r} 0 1 1 0,${2 * r} a ${r},${r} 0 1 1 0,${-2 * r}`,
  };
  return paths[kind] ?? paths.other;
}

export function getEventShortLabel(event: SessionEvent): string {
  if (event.kind === "session_start") return "Start";
  if (event.kind === "session_end") return "End";
  if (isIntentEvent(event)) return getPayloadString(event, "title") ?? "Intent";
  if (isDecisionEvent(event)) return "Decision";
  if (isAssumptionEvent(event)) return "Assumption";
  if (isVerificationEvent(event)) {
    const result = getPayloadString(event, "result");
    return result ? `Verify:${result}` : "Verification";
  }
  if (isToolCallEvent(event)) return getPayloadString(event, "action") ?? "Tool";
  if (isFileOpEvent(event)) {
    const path = getFilePathFromFileOp(event) ?? "file";
    const name = path.split("/").pop() ?? path;
    return name.slice(0, 18) + (name.length > 18 ? "…" : "");
  }
  return event.kind;
}

export function getEventSummary(event: SessionEvent): string {
  if (event.kind === "session_start") return `Session started: ${getPayloadString(event, "goal") ?? "goal unknown"}`;
  if (event.kind === "session_end") return `Session ended: ${getPayloadString(event, "outcome") ?? "unknown outcome"}`;
  if (isIntentEvent(event)) {
    const title = getPayloadString(event, "title") ?? "Intent";
    const desc = getPayloadString(event, "description");
    return desc ? `${title} — ${desc}` : title;
  }
  if (isDecisionEvent(event)) return getPayloadString(event, "summary") ?? "Decision recorded";
  if (isAssumptionEvent(event)) return getPayloadString(event, "statement") ?? "Assumption recorded";
  if (isVerificationEvent(event)) {
    const type = getPayloadString(event, "type") ?? "verification";
    const result = getPayloadString(event, "result") ?? "unknown";
    return `${type}: ${result}`;
  }
  if (isToolCallEvent(event)) {
    const action = getPayloadString(event, "action") ?? "tool call";
    const category = getPayloadString(event, "category");
    return category ? `${category}: ${action}` : action;
  }
  if (isFileOpEvent(event)) {
    const action = getPayloadString(event, "action") ?? "edit";
    const path = getFilePathFromFileOp(event) ?? "(unknown file)";
    return `${action}: ${path}`;
  }
  return event.kind;
}

export function formatEventLogLine(event: SessionEvent, _index: number): string {
  const at = getEventTimestamp(event);
  const time = at ? new Date(at).toLocaleTimeString(undefined, { hour12: false }) : "--:--:--";
  const label = getEventShortLabel(event);
  return `[${time}] ${event.kind}: ${label}`;
}

export function getDurationMs(events: SessionEvent[], fromIndex: number, toIndex: number): number | null {
  if (fromIndex < 0 || toIndex >= events.length || fromIndex >= toIndex) return null;
  const fromAt = getEventTimestamp(events[fromIndex]);
  const toAt = getEventTimestamp(events[toIndex]);
  if (!fromAt || !toAt) return null;
  const a = new Date(fromAt).getTime();
  const b = new Date(toAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b - a;
}

export function formatDurationMs(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

