import type { CanonicalEvent } from "@xiaolei.shawn/schema/event-envelope";

export interface Session {
  id: string;
  started_at?: string;
  title: string;
  user_message: string;
  goal?: string;
  outcome?: "completed" | "partial" | "failed" | "aborted" | "unknown";
  events: SessionEvent[];
}

export type SessionEvent = CanonicalEvent;

export function isIntentEvent(e: SessionEvent): boolean {
  return e.kind === "intent";
}

export function isFileOpEvent(e: SessionEvent): boolean {
  return e.kind === "file_op";
}

export function isToolCallEvent(e: SessionEvent): boolean {
  return e.kind === "tool_call";
}

export function isDecisionEvent(e: SessionEvent): boolean {
  return e.kind === "decision";
}

export function isAssumptionEvent(e: SessionEvent): boolean {
  return e.kind === "assumption";
}

export function isVerificationEvent(e: SessionEvent): boolean {
  return e.kind === "verification";
}

export function getEventTimestamp(e: SessionEvent): string | undefined {
  return e.ts;
}

export function getPayloadString(e: SessionEvent, key: string): string | undefined {
  const value = e.payload?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function getFilePathFromFileOp(e: SessionEvent): string | undefined {
  if (!isFileOpEvent(e)) return undefined;
  const target = getPayloadString(e, "target");
  if (target) return target;
  return e.scope?.file;
}
