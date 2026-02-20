import type { CanonicalEvent } from "@xiaolei.shawn/schema/event-envelope";
import type { Session } from "../types/session";

interface SessionLogLike {
  session_id: string;
  goal?: string;
  user_prompt?: string;
  started_at?: string;
  ended_at?: string;
  events: CanonicalEvent[];
}

export interface ValidationError {
  instancePath: string;
  message?: string;
  keyword: string;
}

export interface ValidationFailure {
  success: false;
  errors: ValidationError[];
}

export interface ValidationSuccess {
  success: true;
  data: Session;
}

export type ValidateSessionResult = ValidationSuccess | ValidationFailure;

function toError(message: string, path = "/"): ValidationFailure {
  return { success: false, errors: [{ instancePath: path, keyword: "validation", message }] };
}

function isCanonicalEvent(raw: unknown): raw is CanonicalEvent {
  if (!raw || typeof raw !== "object") return false;
  const event = raw as Partial<CanonicalEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.session_id === "string" &&
    typeof event.seq === "number" &&
    typeof event.ts === "string" &&
    typeof event.kind === "string" &&
    typeof event.schema_version === "number" &&
    !!event.actor &&
    typeof event.actor.type === "string" &&
    !!event.payload &&
    typeof event.payload === "object"
  );
}

function deriveTitle(goal?: string, fallbackId?: string): string {
  if (goal && goal.trim()) return goal.trim();
  return fallbackId ? `Session ${fallbackId}` : "Session Replay";
}

function deriveOutcome(events: CanonicalEvent[]): Session["outcome"] {
  const end = [...events].reverse().find((e) => e.kind === "session_end");
  const raw = typeof end?.payload?.outcome === "string" ? end.payload.outcome : "unknown";
  if (raw === "completed" || raw === "partial" || raw === "failed" || raw === "aborted") return raw;
  return "unknown";
}

function toSessionFromEvents(events: CanonicalEvent[], meta?: Partial<SessionLogLike>): Session {
  const sorted = [...events].sort((a, b) => (a.seq === b.seq ? a.ts.localeCompare(b.ts) : a.seq - b.seq));
  const first = sorted[0];
  const sessionId = meta?.session_id ?? first?.session_id ?? "unknown-session";
  const goal = meta?.goal;
  return {
    id: sessionId,
    started_at: meta?.started_at ?? sorted[0]?.ts,
    title: deriveTitle(goal, sessionId),
    user_message: meta?.user_prompt ?? "",
    goal,
    outcome: deriveOutcome(sorted),
    events: sorted,
  };
}

function parseJsonl(text: string): CanonicalEvent[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const events: CanonicalEvent[] = [];
  for (const [i, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at line ${i + 1}`);
    }
    if (!isCanonicalEvent(parsed)) {
      throw new Error(`Invalid canonical event shape at line ${i + 1}`);
    }
    events.push(parsed);
  }
  return events;
}

function parseInput(data: unknown): Session {
  if (typeof data === "string") {
    const rawText = data.trim();
    if (!rawText) throw new Error("Empty input");
    if (rawText.startsWith("{") || rawText.startsWith("[")) {
      try {
        return parseInput(JSON.parse(rawText));
      } catch {
        // JSONL commonly starts with "{" on the first line; fallback when full JSON parse fails.
        return toSessionFromEvents(parseJsonl(rawText));
      }
    }
    return toSessionFromEvents(parseJsonl(rawText));
  }

  if (Array.isArray(data)) {
    if (!data.every((e) => isCanonicalEvent(e))) {
      throw new Error("Array input must contain canonical events");
    }
    return toSessionFromEvents(data);
  }

  if (data && typeof data === "object") {
    const obj = data as Partial<SessionLogLike>;
    if (Array.isArray(obj.events) && obj.events.every((e) => isCanonicalEvent(e))) {
      return toSessionFromEvents(obj.events, obj);
    }
  }

  throw new Error("Unsupported session file format. Provide canonical JSON, JSON array, or JSONL events.");
}

export function validateSession(data: unknown): ValidateSessionResult {
  try {
    const session = parseInput(data);
    if (session.events.length === 0) return toError("Session contains no events.");
    return { success: true, data: session };
  } catch (err) {
    return toError(err instanceof Error ? err.message : "Invalid session input");
  }
}
