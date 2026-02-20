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

interface CodexLogLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
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

function toIso(ts: unknown, fallback: string): string {
  if (typeof ts !== "string" || ts.trim() === "") return fallback;
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toShortString(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}...` : trimmed;
}

function toCanonicalFromCodexJsonl(text: string): Session {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const records: CodexLogLine[] = [];
  for (const [i, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL at line ${i + 1}`);
    }
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Invalid JSONL object at line ${i + 1}`);
    }
    records.push(parsed as CodexLogLine);
  }

  const sessionMeta = records.find((r) => r.type === "session_meta");
  if (!sessionMeta) {
    throw new Error("No session_meta found in JSONL.");
  }

  const nowIso = new Date().toISOString();
  const metaPayload = toObject(sessionMeta.payload);
  const rawSessionId = metaPayload.id;
  const sessionId =
    typeof rawSessionId === "string" && rawSessionId.trim() !== ""
      ? rawSessionId
      : "codex-session";
  const startTs = toIso(metaPayload.timestamp, toIso(sessionMeta.timestamp, nowIso));
  const events: CanonicalEvent[] = [];
  const activeIntentId = `intent_${sessionId}_main`;
  let seq = 1;

  events.push({
    id: `${sessionId}:${seq}:session_start`,
    session_id: sessionId,
    seq,
    ts: startTs,
    kind: "session_start",
    actor: { type: "system", id: "codex" },
    payload: {
      goal: toShortString(metaPayload.user_goal) ?? toShortString(metaPayload.goal) ?? "Codex session import",
      user_prompt: toShortString(metaPayload.user_prompt),
      source: "codex_jsonl",
      originator: toShortString(metaPayload.originator),
      model: toShortString(metaPayload.model),
    },
    visibility: "review",
    schema_version: 1,
  });

  for (const record of records) {
    const recordType = record.type;
    const payload = toObject(record.payload);
    const ts = toIso(record.timestamp, nowIso);

    if (recordType === "event_msg" && payload.type === "user_message") {
      const message = toShortString(payload.message, 4000);
      if (!message) continue;
      seq += 1;
      events.push({
        id: `${sessionId}:${seq}:intent`,
        session_id: sessionId,
        seq,
        ts,
        kind: "intent",
        actor: { type: "user", id: "codex-user" },
        scope: { intent_id: activeIntentId },
        payload: {
          intent_id: activeIntentId,
          title: message.split("\n")[0]?.slice(0, 120) || "User message",
          description: message,
          source: "codex_user_message",
        },
        visibility: "review",
        schema_version: 1,
      });
      continue;
    }

    if (recordType !== "response_item") continue;
    const itemType = typeof payload.type === "string" ? payload.type : "unknown";

    if (itemType === "function_call" || itemType === "custom_tool_call" || itemType === "web_search_call") {
      const action =
        toShortString(payload.name) ??
        toShortString(toObject(payload.action).type) ??
        itemType;
      const target =
        toShortString(payload.arguments, 1200) ??
        toShortString(payload.input, 1200) ??
        toShortString(JSON.stringify(toObject(payload.action)), 1200);
      seq += 1;
      events.push({
        id: `${sessionId}:${seq}:tool_call`,
        session_id: sessionId,
        seq,
        ts,
        kind: "tool_call",
        actor: { type: "agent", id: "codex" },
        scope: { intent_id: activeIntentId },
        payload: {
          category: itemType === "web_search_call" ? "search" : "tool",
          action,
          target,
          details: {
            call_id: toShortString(payload.call_id),
            status: toShortString(payload.status),
            source: "codex_response_item",
          },
        },
        visibility: "raw",
        schema_version: 1,
      });
      continue;
    }

    if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
      seq += 1;
      events.push({
        id: `${sessionId}:${seq}:execution`,
        session_id: sessionId,
        seq,
        ts,
        kind: "tool_call",
        actor: { type: "tool", id: "codex-tool" },
        scope: { intent_id: activeIntentId },
        payload: {
          category: "execution",
          action: itemType,
          target: toShortString(payload.call_id),
          details: {
            output: toShortString(payload.output, 4000),
            source: "codex_response_item",
          },
        },
        visibility: "raw",
        schema_version: 1,
      });
    }
  }

  const endTs = toIso(records[records.length - 1]?.timestamp, nowIso);
  seq += 1;
  events.push({
    id: `${sessionId}:${seq}:session_end`,
    session_id: sessionId,
    seq,
    ts: endTs,
    kind: "session_end",
    actor: { type: "system", id: "codex" },
    payload: {
      outcome: "unknown",
      summary: "Imported from Codex JSONL",
      source: "codex_jsonl",
    },
    visibility: "review",
    schema_version: 1,
  });

  return toSessionFromEvents(events, {
    session_id: sessionId,
    goal: toShortString(metaPayload.user_goal) ?? toShortString(metaPayload.goal),
    user_prompt: toShortString(metaPayload.user_prompt, 4000),
    started_at: startTs,
    ended_at: endTs,
  });
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
        try {
          return toSessionFromEvents(parseJsonl(rawText));
        } catch {
          return toCanonicalFromCodexJsonl(rawText);
        }
      }
    }
    try {
      return toSessionFromEvents(parseJsonl(rawText));
    } catch {
      return toCanonicalFromCodexJsonl(rawText);
    }
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
