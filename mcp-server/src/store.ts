/**
 * In-memory session assembler (S06).
 * Store keyed by session id. Events are timestamped and ordered for flush.
 *
 * Out-of-order and duplicates:
 * - Events are stored with a receipt index. For flush we sort by (at ?? receiptTime, receiptIndex).
 * - Duplicates: we dedupe by a hash of (type + key fields). Same event payload appended twice
 *   is stored only once (first occurrence wins), so flush is deterministic.
 */

import type { Session, SessionEvent } from "@al/schema/session-schema";

const eventKey = (e: SessionEvent): string => {
  const t = e.type;
  if (t === "session_start") return `session_start:${(e as { at?: string }).at ?? ""}`;
  if (t === "plan_step") return `plan_step:${(e as { index?: number }).index ?? ""}:${(e as { step: string }).step}`;
  if (t === "file_edit") return `file_edit:${(e as { path: string }).path}:${(e as { at?: string }).at ?? ""}`;
  if (t === "file_create") return `file_create:${(e as { path: string }).path}:${(e as { at?: string }).at ?? ""}`;
  if (t === "file_delete") return `file_delete:${(e as { path: string }).path}:${(e as { at?: string }).at ?? ""}`;
  if (t === "audit_event") return `audit_event:${(e as { audit_type: string }).audit_type}:${(e as { at?: string }).at ?? ""}`;
  if (t === "deliverable") return `deliverable:${(e as { at?: string }).at ?? ""}`;
  if (t === "tool_call") return `tool_call:${(e as { name: string }).name}:${(e as { at?: string }).at ?? ""}`;
  return `unknown:${JSON.stringify(e)}`;
};

export interface StoredEvent {
  event: SessionEvent;
  receiptIndex: number;
  receiptTime: string; // ISO
}

export interface SessionState {
  id: string;
  started_at: string;
  title: string;
  user_message: string;
  events: StoredEvent[];
  completed: boolean;
}

const sessions = new Map<string, SessionState>();
let receiptCounter = 0;

function nextReceipt(): { index: number; time: string } {
  receiptCounter += 1;
  return { index: receiptCounter, time: new Date().toISOString() };
}

export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

export function ensureSession(
  id: string,
  started_at: string,
  title: string,
  user_message: string
): SessionState {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      started_at,
      title,
      user_message,
      events: [],
      completed: false,
    };
    sessions.set(id, s);
  }
  return s;
}

export function appendEvent(sessionId: string, event: SessionEvent): { appended: boolean; error?: string } {
  const s = sessions.get(sessionId);
  if (!s) return { appended: false, error: `Session not found: ${sessionId}` };
  if (s.completed) return { appended: false, error: "Session already completed" };

  const key = eventKey(event);
  const already = s.events.some((st) => eventKey(st.event) === key);
  if (already) return { appended: false }; // dedupe, no error

  const { index, time } = nextReceipt();
  s.events.push({ event, receiptIndex: index, receiptTime: time });
  return { appended: true };
}

export function markCompleted(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (s) s.completed = true;
}

export function toSession(state: SessionState): Session {
  const sorted = [...state.events].sort((a, b) => {
    const atA = "at" in a.event && a.event.at ? a.event.at : a.receiptTime;
    const atB = "at" in b.event && b.event.at ? b.event.at : b.receiptTime;
    const c = atA.localeCompare(atB);
    if (c !== 0) return c;
    return a.receiptIndex - b.receiptIndex;
  });
  return {
    id: state.id,
    started_at: state.started_at,
    title: state.title,
    user_message: state.user_message,
    events: sorted.map((s) => ({ ...s.event, at: s.event.at ?? s.receiptTime })),
  };
}

export function listSessionIds(): string[] {
  return Array.from(sessions.keys());
}

export function getCompletedSessions(): SessionState[] {
  return Array.from(sessions.values()).filter((s) => s.completed);
}
