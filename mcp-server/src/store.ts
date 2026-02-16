import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSessionsDir } from "./config.js";
import {
  EVENT_SCHEMA_VERSION,
  type ActorType,
  type CanonicalEvent,
  type SessionLogFile,
} from "./event-envelope.js";

export interface SessionState {
  session_id: string;
  goal: string;
  user_prompt?: string;
  repo?: string;
  branch?: string;
  started_at: string;
  ended_at?: string;
  next_seq: number;
  active_intent_id?: string;
}

const sessionStates = new Map<string, SessionState>();
let activeSessionId: string | undefined;

let writeQueue: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getSessionLogPath(sessionId: string): string {
  const outDir = getSessionsDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  return join(outDir, `${safeFilename(sessionId)}.jsonl`);
}

function toCanonicalTs(rawTs?: string): string {
  if (!rawTs) return new Date().toISOString();
  const parsed = new Date(rawTs);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid timestamp: ${rawTs}`);
  return parsed.toISOString();
}

function assertConfidence(confidence?: number): void {
  if (confidence === undefined) return;
  if (Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("confidence must be a number between 0 and 1");
  }
}

export function createSession(input: {
  goal: string;
  user_prompt?: string;
  repo?: string;
  branch?: string;
}): SessionState {
  const startedAt = new Date().toISOString();
  const sessionId = `sess_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const state: SessionState = {
    session_id: sessionId,
    goal: input.goal,
    user_prompt: input.user_prompt,
    repo: input.repo,
    branch: input.branch,
    started_at: startedAt,
    next_seq: 1,
  };
  sessionStates.set(sessionId, state);
  activeSessionId = sessionId;
  return state;
}

export function getActiveSession(): SessionState | undefined {
  if (!activeSessionId) return undefined;
  return sessionStates.get(activeSessionId);
}

export function ensureActiveSession(): SessionState {
  const active = getActiveSession();
  if (!active) {
    throw new Error("No active session. Call record_session_start first.");
  }
  if (active.ended_at) {
    throw new Error("Active session has ended. Call record_session_start to begin a new one.");
  }
  return active;
}

export function setActiveIntent(intentId: string): void {
  const s = ensureActiveSession();
  s.active_intent_id = intentId;
}

export interface CreateEventInput {
  session_id: string;
  kind: string;
  actor: {
    type: ActorType;
    id?: string;
  };
  payload: Record<string, unknown>;
  ts?: string;
  scope?: {
    intent_id?: string;
    file?: string;
    module?: string;
  };
  derived?: boolean;
  confidence?: number;
  visibility?: "raw" | "review" | "debug";
}

export function createEvent(state: SessionState, input: CreateEventInput): CanonicalEvent {
  const seq = state.next_seq;
  state.next_seq += 1;
  const ts = toCanonicalTs(input.ts);
  assertConfidence(input.confidence);

  return {
    id: `${state.session_id}:${seq}:${randomUUID().slice(0, 8)}`,
    session_id: input.session_id,
    seq,
    ts,
    kind: input.kind,
    actor: input.actor,
    scope: input.scope,
    payload: input.payload,
    derived: input.derived,
    confidence: input.confidence,
    visibility: input.visibility,
    schema_version: EVENT_SCHEMA_VERSION,
  };
}

export async function persistEvent(event: CanonicalEvent): Promise<void> {
  await withWriteLock(() => {
    const path = getSessionLogPath(event.session_id);
    appendFileSync(path, JSON.stringify(event) + "\n", "utf-8");
  });
}

export async function endActiveSession(endedAt?: string): Promise<SessionState> {
  const state = ensureActiveSession();
  state.ended_at = toCanonicalTs(endedAt);
  await withWriteLock(() => undefined);
  if (activeSessionId === state.session_id) {
    activeSessionId = undefined;
  }
  return state;
}

export function buildSessionLog(state: SessionState, events: CanonicalEvent[]): SessionLogFile {
  return {
    session_id: state.session_id,
    goal: state.goal,
    user_prompt: state.user_prompt,
    repo: state.repo,
    branch: state.branch,
    started_at: state.started_at,
    ended_at: state.ended_at,
    events,
  };
}

export function initializeSessionLog(state: SessionState): void {
  const path = getSessionLogPath(state.session_id);
  if (existsSync(path)) return;
  writeFileSync(path, "", "utf-8");
}
