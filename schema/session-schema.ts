/**
 * Canonical session schema — shared contract for MCP and web app tooling.
 * Events are a discriminated union on the `type` field.
 * MCP middleware: file_op emits file_* with content fields; record_plan → plan_step; audit_event → audit_event (audit_type, description).
 */

// ——— Top-level session ———

export interface Session {
  id: string;
  started_at: string; // ISO 8601
  title: string;
  user_message: string;
  events: SessionEvent[];
}

// ——— Event discriminated union ———

export type SessionEvent =
  | SessionStartEvent
  | PlanStepEvent
  | AuditEvent
  | FileEditEvent
  | FileCreateEvent
  | FileDeleteEvent
  | DeliverableEvent
  | ToolCallEvent;

/** Reasoning, interpretation, decisions — recorded via MCP audit_event tool. */
export interface AuditEvent {
  type: "audit_event";
  /** e.g. "interpretation", "reasoning", "decision", "milestone" */
  audit_type: string;
  description: string;
  at?: string;
}

export interface SessionStartEvent {
  type: "session_start";
  at?: string; // ISO 8601, optional for backward compat
}

export interface PlanStepEvent {
  type: "plan_step";
  step: string;
  index?: number;
  at?: string;
}

export interface FileEditEvent {
  type: "file_edit";
  path: string;
  old_content?: string;
  new_content?: string;
  at?: string;
}

export interface FileCreateEvent {
  type: "file_create";
  path: string;
  content?: string;
  at?: string;
}

export interface FileDeleteEvent {
  type: "file_delete";
  path: string;
  /** Last content before delete (e.g. from file_op); optional for backward compat. */
  old_content?: string;
  at?: string;
}

export interface DeliverableEvent {
  type: "deliverable";
  title?: string;
  content?: string;
  at?: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  name: string;
  args?: unknown;
  result?: unknown;
  at?: string;
}

// ——— Type guards ———

export function isSessionStartEvent(e: SessionEvent): e is SessionStartEvent {
  return e.type === "session_start";
}
export function isPlanStepEvent(e: SessionEvent): e is PlanStepEvent {
  return e.type === "plan_step";
}
export function isAuditEvent(e: SessionEvent): e is AuditEvent {
  return e.type === "audit_event";
}
export function isFileEditEvent(e: SessionEvent): e is FileEditEvent {
  return e.type === "file_edit";
}
export function isFileCreateEvent(e: SessionEvent): e is FileCreateEvent {
  return e.type === "file_create";
}
export function isFileDeleteEvent(e: SessionEvent): e is FileDeleteEvent {
  return e.type === "file_delete";
}
export function isDeliverableEvent(e: SessionEvent): e is DeliverableEvent {
  return e.type === "deliverable";
}
export function isToolCallEvent(e: SessionEvent): e is ToolCallEvent {
  return e.type === "tool_call";
}
