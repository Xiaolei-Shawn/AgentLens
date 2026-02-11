/**
 * Session types aligned with @al/schema (canonical contract).
 * Duplicated here so webapp runs without building the schema package.
 */

export interface Session {
  id: string;
  started_at: string;
  title: string;
  user_message: string;
  events: SessionEvent[];
}

export type SessionEvent =
  | SessionStartEvent
  | PlanStepEvent
  | FileEditEvent
  | FileCreateEvent
  | FileDeleteEvent
  | DeliverableEvent
  | ToolCallEvent;

export interface SessionStartEvent {
  type: "session_start";
  at?: string;
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

export function isPlanStepEvent(e: SessionEvent): e is PlanStepEvent {
  return e.type === "plan_step";
}
export function isDeliverableEvent(e: SessionEvent): e is DeliverableEvent {
  return e.type === "deliverable";
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
export function isToolCallEvent(e: SessionEvent): e is ToolCallEvent {
  return e.type === "tool_call";
}
