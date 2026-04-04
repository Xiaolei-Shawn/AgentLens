import type { AdaptedEvent, AdaptedSession, RawAdapter } from "./types.js";

interface ClaudeJsonlLine {
  timestamp?: string | number;
  type?: string;
  source?: string;
  payload?: Record<string, unknown>;
}

type ClaudeNormalizedKind =
  | "session_meta"
  | "user_message"
  | "assistant_message"
  | "reasoning_like"
  | "tool_call"
  | "tool_result"
  | "token_usage";

interface ClaudeNormalizedRecord {
  kind: ClaudeNormalizedKind;
  ts: string;
  text?: string;
  title?: string;
  action?: string;
  target?: string;
  usage?: Record<string, unknown>;
  callId?: string;
  rawSource: string;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function short(value: unknown, max = 800): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function sanitizeText(value: unknown, max = 3000): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function toIso(ts: unknown, fallback: string): string {
  if (ts == null) return fallback;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  if (typeof ts !== "string" || ts.trim() === "") return fallback;
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function getRecordTimestamp(record: ClaudeJsonlLine): unknown {
  if (record.timestamp !== undefined && record.timestamp !== null) return record.timestamp;
  const payload = toObject(record.payload);
  return payload.timestamp ?? payload.created_at;
}

function parseLines(content: string): ClaudeJsonlLine[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL line ${index + 1}`);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid record at line ${index + 1}`);
      }
      return parsed as ClaudeJsonlLine;
    });
}

function extractText(payload: Record<string, unknown>): string | undefined {
  const direct =
    sanitizeText(payload.text) ??
    sanitizeText(payload.message) ??
    sanitizeText(payload.output) ??
    sanitizeText(payload.summary);
  if (direct) return direct;

  const content = Array.isArray(payload.content) ? payload.content : [];
  const texts = content
    .map((entry) => {
      const record = toObject(entry);
      return sanitizeText(record.text);
    })
    .filter((item): item is string => Boolean(item));
  if (texts.length === 0) return undefined;
  return texts.join("\n");
}

function normalizeTokenUsage(value: unknown): Record<string, unknown> | undefined {
  const usage = toObject(value);
  if (Object.keys(usage).length === 0) return undefined;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const total = usage.total_tokens;
  if (
    typeof input !== "number" &&
    typeof output !== "number" &&
    typeof total !== "number"
  ) {
    return undefined;
  }
  return {
    input_tokens: typeof input === "number" ? input : undefined,
    output_tokens: typeof output === "number" ? output : undefined,
    total_tokens: typeof total === "number" ? total : undefined,
    prompt_tokens: typeof input === "number" ? input : undefined,
    completion_tokens: typeof output === "number" ? output : undefined,
  };
}

function looksLikeCodexJsonl(sample: string): boolean {
  return sample.includes("\"type\":\"session_meta\"") || sample.includes("\"type\": \"session_meta\"");
}

function looksLikeCursorTaggedTranscript(sample: string): boolean {
  return /<user_query>[\s\S]*?<\/user_query>/i.test(sample) || /<think>[\s\S]*?<\/think>/i.test(sample);
}

function looksLikeClaudeTranscript(sample: string): boolean {
  if (sample.trim().startsWith("{")) return false;
  return (
    /\bClaude Code\b/i.test(sample) &&
    (/^\s*(User|Human)\s*:/im.test(sample) || /^\s*(Assistant|Claude)\s*:/im.test(sample))
  );
}

function lineHasClaudeSignals(record: ClaudeJsonlLine): boolean {
  const payload = toObject(record.payload);
  const type = short(record.type)?.toLowerCase() ?? "";
  const source = short(record.source)?.toLowerCase() ?? "";
  const payloadSource = short(payload.source)?.toLowerCase() ?? "";
  const provider = short(payload.provider)?.toLowerCase() ?? "";
  const model = short(payload.model)?.toLowerCase() ?? "";
  return (
    type.startsWith("claude_") ||
    source.includes("claude") ||
    source.includes("anthropic") ||
    payloadSource.includes("claude") ||
    payloadSource.includes("anthropic") ||
    provider.includes("anthropic") ||
    model.includes("claude")
  );
}

function hasClaudeJsonlSignals(sample: string): boolean {
  if (looksLikeCodexJsonl(sample) || looksLikeCursorTaggedTranscript(sample) || looksLikeClaudeTranscript(sample)) {
    return false;
  }

  let parsed = 0;
  let hits = 0;
  for (const line of sample.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 12)) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return false;
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) return false;
    parsed += 1;
    if (lineHasClaudeSignals(record as ClaudeJsonlLine)) {
      hits += 1;
    }
  }
  return parsed >= 2 && hits >= 2;
}

function inferSessionId(records: ClaudeJsonlLine[]): string | undefined {
  for (const record of records) {
    const payload = toObject(record.payload);
    const explicit =
      short(payload.session_id) ??
      short(payload.id) ??
      short((record as Record<string, unknown>).session_id) ??
      short((record as Record<string, unknown>).id);
    if (explicit) {
      return explicit.startsWith("claude_") ? explicit : `claude_${explicit}`;
    }
  }
  return undefined;
}

function findSessionMeta(records: ClaudeJsonlLine[]): ClaudeJsonlLine | undefined {
  return records.find((record) => {
    const type = short(record.type)?.toLowerCase() ?? "";
    return type === "claude_session_meta" || type === "claude_session";
  });
}

function inferStartTs(meta: ClaudeJsonlLine | undefined, records: ClaudeJsonlLine[], fallback: string): string {
  if (meta) return toIso(getRecordTimestamp(meta), fallback);
  const first = records[0];
  return toIso(getRecordTimestamp(first), fallback);
}

function normalizeRole(record: ClaudeJsonlLine): string | undefined {
  const payload = toObject(record.payload);
  return short(payload.role)?.toLowerCase() ?? short((record as Record<string, unknown>).role)?.toLowerCase();
}

function normalizeEventType(record: ClaudeJsonlLine): ClaudeNormalizedKind | undefined {
  const payload = toObject(record.payload);
  const type = short(record.type)?.toLowerCase() ?? "";
  const payloadType = short(payload.type)?.toLowerCase() ?? "";
  const role = normalizeRole(record);

  if (type === "claude_session_meta" || type === "claude_session") return "session_meta";
  if (type === "claude_tool_use" || payloadType === "claude_tool_use" || type === "tool_use") return "tool_call";
  if (type === "claude_tool_result" || payloadType === "claude_tool_result" || type === "tool_result") return "tool_result";
  if (type === "claude_reasoning" || type === "claude_thinking" || payloadType === "claude_reasoning") return "reasoning_like";
  if (type === "claude_token_usage" || payloadType === "claude_token_usage") return "token_usage";
  if (type === "claude_message" || payloadType === "claude_message" || type === "message") {
    if (role === "user") return "user_message";
    if (role === "assistant") return "assistant_message";
  }
  return undefined;
}

function normalizeClaudeRecord(record: ClaudeJsonlLine, fallbackTs: string): ClaudeNormalizedRecord | undefined {
  const payload = toObject(record.payload);
  const kind = normalizeEventType(record);
  if (!kind) return undefined;
  const ts = toIso(getRecordTimestamp(record), fallbackTs);
  return {
    kind,
    ts,
    text: extractText(payload),
    title: short(payload.title),
    action: short(payload.name) ?? short(payload.action),
    target: short(payload.input, 1600) ?? short(payload.arguments, 1600) ?? short(payload.call_id),
    usage: normalizeTokenUsage(payload.usage ?? payload.token_usage),
    callId: short(payload.call_id),
    rawSource: short(record.type) ?? "claude_code_jsonl",
  };
}

function inferGoal(meta: ClaudeJsonlLine | undefined, firstUserPrompt: string | undefined): string {
  const payload = meta ? toObject(meta.payload) : {};
  return (
    short(payload.goal) ??
    short(payload.user_goal) ??
    firstUserPrompt?.split("\n")[0]?.slice(0, 200) ??
    "Imported Claude Code structured session"
  );
}

function mapStructuredRecord(record: ClaudeNormalizedRecord, intentId: string | undefined): AdaptedEvent[] {
  if (record.kind === "assistant_message" && record.text) {
    return [
      {
        kind: "artifact_created",
        ts: record.ts,
        actor: { type: "agent", id: "claude-code" },
        scope: intentId ? { intent_id: intentId, module: "assistant_output" } : { module: "assistant_output" },
        payload: {
          artifact_type: "assistant_message",
          text: record.text,
          source: "claude_code_jsonl",
        },
        derived: true,
        confidence: 0.85,
        visibility: "review",
      },
    ];
  }

  if (record.kind === "reasoning_like" && record.text) {
    return [
      {
        kind: "artifact_created",
        ts: record.ts,
        actor: { type: "agent", id: "claude-code" },
        scope: intentId ? { intent_id: intentId, module: "reasoning" } : { module: "reasoning" },
        payload: {
          artifact_type: "reasoning",
          text: record.text,
          source: "claude_code_jsonl",
        },
        derived: true,
        confidence: 0.8,
        visibility: "debug",
      },
    ];
  }

  if (record.kind === "tool_call") {
    return [
      {
        kind: "tool_call",
        ts: record.ts,
        actor: { type: "agent", id: "claude-code" },
        scope: intentId ? { intent_id: intentId } : undefined,
        payload: {
          category: "tool",
          action: record.action ?? "tool_call",
          target: record.target,
          details: {
            source: "claude_code_jsonl",
            record_type: record.rawSource,
            call_id: record.callId,
          },
        },
        derived: true,
        confidence: 0.84,
        visibility: "raw",
      },
    ];
  }

  if (record.kind === "tool_result") {
    return [
      {
        kind: "tool_call",
        ts: record.ts,
        actor: { type: "tool", id: "claude-tool" },
        scope: intentId ? { intent_id: intentId } : undefined,
        payload: {
          category: "execution",
          action: record.action ?? "tool_result",
          target: record.callId ?? record.target,
          details: {
            source: "claude_code_jsonl",
            output: record.text,
            record_type: record.rawSource,
          },
        },
        derived: true,
        confidence: 0.82,
        visibility: "raw",
      },
    ];
  }

  if (record.kind === "token_usage" && record.usage) {
    return [
      {
        kind: "token_usage_checkpoint",
        ts: record.ts,
        actor: { type: "system", id: "claude-code" },
        scope: intentId ? { intent_id: intentId, module: "llm" } : { module: "llm" },
        payload: {
          usage: record.usage,
          source: "claude_code_jsonl",
          raw_type: record.rawSource,
        },
        derived: true,
        confidence: 0.76,
        visibility: "raw",
      },
    ];
  }

  return [];
}

export const claudeCodeJsonlAdapter: RawAdapter = {
  name: "claude_code_jsonl",
  canAdapt(content: string): boolean {
    return hasClaudeJsonlSignals(content.slice(0, 6000));
  },
  adapt(content: string): AdaptedSession {
    const records = parseLines(content);
    if (!records.some(lineHasClaudeSignals)) {
      throw new Error("No Claude Code structured JSONL records detected.");
    }

    const now = new Date().toISOString();
    const meta = findSessionMeta(records);
    const sessionId = inferSessionId(records) ?? `claude_${Date.now()}`;
    const startTs = inferStartTs(meta, records, now);
    const events: AdaptedEvent[] = [];
    let intentCounter = 0;
    let activeIntentId: string | undefined;
    let firstUserPrompt: string | undefined;

    events.push({
      kind: "session_start",
      ts: startTs,
      actor: { type: "system", id: "claude-code" },
      payload: {
        goal: inferGoal(meta, undefined),
        user_prompt: short(toObject(meta?.payload).user_prompt, 3000),
        source: "claude_code_jsonl",
      },
      visibility: "review",
      derived: true,
      confidence: 0.94,
    });

    for (const record of records) {
      const normalized = normalizeClaudeRecord(record, now);
      if (!normalized) continue;
      if (normalized.kind === "session_meta") continue;

      if (normalized.kind === "user_message" && normalized.text) {
        intentCounter += 1;
        activeIntentId = `intent_${sessionId}_${intentCounter}`;
        firstUserPrompt ??= normalized.text;
        events.push({
          kind: "intent",
          ts: normalized.ts,
          actor: { type: "user", id: "claude-user" },
          scope: { intent_id: activeIntentId },
          payload: {
            intent_id: activeIntentId,
            title: normalized.text.split("\n")[0]?.slice(0, 120) || normalized.title || "User message",
            description: normalized.text,
            source: "claude_code_jsonl",
          },
          visibility: "review",
          derived: true,
          confidence: 0.86,
        });
        continue;
      }

      events.push(...mapStructuredRecord(normalized, activeIntentId));
    }

    const lastTs = records.length > 0 ? toIso(getRecordTimestamp(records[records.length - 1]), now) : now;
    events.push({
      kind: "session_end",
      ts: lastTs,
      actor: { type: "system", id: "claude-code" },
      payload: {
        outcome: "unknown",
        summary: "Imported from Claude Code structured JSONL",
        source: "claude_code_jsonl",
      },
      visibility: "review",
      derived: true,
      confidence: 0.9,
    });

    return {
      source: "claude_code_jsonl",
      session_id: sessionId,
      goal: inferGoal(meta, firstUserPrompt),
      user_prompt: firstUserPrompt ?? short(toObject(meta?.payload).user_prompt, 3000),
      started_at: startTs,
      ended_at: lastTs,
      events,
    };
  },
};
