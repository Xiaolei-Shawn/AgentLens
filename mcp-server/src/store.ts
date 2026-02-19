import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

export interface SessionFileInfo {
  session_id: string;
  path: string;
  size_bytes: number;
  updated_at: string;
}

export interface NormalizedSessionSnapshot {
  session_id: string;
  goal: string;
  started_at: string;
  ended_at?: string;
  outcome: "completed" | "partial" | "failed" | "aborted" | "unknown";
  event_count: number;
  intent_count: number;
  verification: {
    pass: number;
    fail: number;
    unknown: number;
  };
  files_touched: string[];
  kinds: Record<string, number>;
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

function getSessionSnapshotPath(sessionId: string): string {
  const outDir = getSessionsDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  return join(outDir, `${safeFilename(sessionId)}.session.json`);
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

export function readSessionEvents(sessionId: string): CanonicalEvent[] {
  const path = getSessionLogPath(sessionId);
  if (!existsSync(path)) return [];
  const content = readFileSync(path, "utf-8").trim();
  if (!content) return [];
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const events = lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL in ${path} at line ${index + 1}`);
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid event object in ${path} at line ${index + 1}`);
    }
    return parsed as CanonicalEvent;
  });
  return events.sort((a, b) => (a.seq === b.seq ? a.ts.localeCompare(b.ts) : a.seq - b.seq));
}

function deriveSnapshot(session: SessionState, events: CanonicalEvent[]): NormalizedSessionSnapshot {
  const kinds: Record<string, number> = {};
  let pass = 0;
  let fail = 0;
  let unknown = 0;
  const files = new Set<string>();
  let intentCount = 0;

  for (const event of events) {
    kinds[event.kind] = (kinds[event.kind] ?? 0) + 1;
    if (event.kind === "intent") intentCount += 1;
    if (event.kind === "file_op") {
      const target =
        typeof event.payload.target === "string"
          ? event.payload.target
          : event.scope?.file;
      if (target && target.trim() !== "") files.add(target);
    }
    if (event.kind === "verification") {
      const result = event.payload.result;
      if (result === "pass") pass += 1;
      else if (result === "fail") fail += 1;
      else unknown += 1;
    }
  }

  const end = [...events].reverse().find((event) => event.kind === "session_end");
  const outcomeRaw = end?.payload?.outcome;
  const outcome =
    outcomeRaw === "completed" || outcomeRaw === "partial" || outcomeRaw === "failed" || outcomeRaw === "aborted"
      ? outcomeRaw
      : "unknown";

  return {
    session_id: session.session_id,
    goal: session.goal,
    started_at: session.started_at,
    ended_at: session.ended_at,
    outcome,
    event_count: events.length,
    intent_count: intentCount,
    verification: { pass, fail, unknown },
    files_touched: [...files].sort(),
    kinds,
  };
}

export async function persistNormalizedSnapshot(session: SessionState): Promise<NormalizedSessionSnapshot> {
  const events = readSessionEvents(session.session_id);
  const snapshot = deriveSnapshot(session, events);
  await withWriteLock(() => {
    const path = getSessionSnapshotPath(session.session_id);
    writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf-8");
  });
  return snapshot;
}

export function listSessionFiles(): SessionFileInfo[] {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  const out: SessionFileInfo[] = files.map((name) => {
    const path = join(dir, name);
    const stats = statSync(path);
    const session_id = name.replace(/\.jsonl$/, "");
    return {
      session_id,
      path,
      size_bytes: stats.size,
      updated_at: stats.mtime.toISOString(),
    };
  });
  out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return out;
}

export function exportSessionJson(sessionId: string): string {
  const state = sessionStates.get(sessionId);
  const events = readSessionEvents(sessionId);
  if (events.length === 0) throw new Error(`No events found for session: ${sessionId}`);
  const firstStart = events.find((event) => event.kind === "session_start");
  const startPayload = (firstStart?.payload ?? {}) as Record<string, unknown>;
  const inferredState: SessionState = state ?? {
    session_id: sessionId,
    goal: typeof startPayload.goal === "string" ? startPayload.goal : "Unknown goal",
    user_prompt: typeof startPayload.user_prompt === "string" ? startPayload.user_prompt : undefined,
    repo: typeof startPayload.repo === "string" ? startPayload.repo : undefined,
    branch: typeof startPayload.branch === "string" ? startPayload.branch : undefined,
    started_at: firstStart?.ts ?? events[0].ts,
    ended_at: [...events].reverse().find((event) => event.kind === "session_end")?.ts,
    next_seq: (events[events.length - 1]?.seq ?? 0) + 1,
  };
  const snapshot = deriveSnapshot(inferredState, events);
  return JSON.stringify(
    {
      ...buildSessionLog(inferredState, events),
      normalized: snapshot,
    },
    null,
    2
  );
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
