import type { AdaptedEvent, AdaptedSession, RawAdapter } from "./types.js";

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIso(ts: unknown, fallback: string): string {
  if (typeof ts !== "string" || ts.trim() === "") return fallback;
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function short(value: unknown, max = 800): string | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function parseLines(content: string): CodexLine[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, i) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new Error(`Invalid JSONL line ${i + 1}`);
      }
      if (!parsed || typeof parsed !== "object") throw new Error(`Invalid record at line ${i + 1}`);
      return parsed as CodexLine;
    });
}

function mapResponseItem(record: CodexLine, intentId: string, now: string): AdaptedEvent[] {
  const payload = toObject(record.payload);
  const itemType = short(payload.type) ?? "unknown";
  const ts = toIso(record.timestamp, now);

  if (itemType === "function_call" || itemType === "custom_tool_call" || itemType === "web_search_call") {
    const action = short(payload.name) ?? short(toObject(payload.action).type) ?? itemType;
    return [
      {
        kind: "tool_call",
        ts,
        actor: { type: "agent", id: "codex" },
        scope: { intent_id: intentId },
        payload: {
          category: itemType === "web_search_call" ? "search" : "tool",
          action,
          target: short(payload.arguments, 1600) ?? short(payload.input, 1600),
          details: {
            call_id: short(payload.call_id),
            status: short(payload.status),
            source: "codex_response_item",
          },
        },
        derived: true,
        confidence: 0.85,
        visibility: "raw",
      },
    ];
  }

  if (itemType === "function_call_output" || itemType === "custom_tool_call_output") {
    return [
      {
        kind: "tool_call",
        ts,
        actor: { type: "tool", id: "codex-tool" },
        scope: { intent_id: intentId },
        payload: {
          category: "execution",
          action: itemType,
          target: short(payload.call_id),
          details: {
            output: short(payload.output, 3500),
            source: "codex_response_item",
          },
        },
        derived: true,
        confidence: 0.8,
        visibility: "raw",
      },
    ];
  }

  return [];
}

export const codexJsonlAdapter: RawAdapter = {
  name: "codex_jsonl",
  canAdapt(content: string): boolean {
    const sample = content.slice(0, 3000);
    return sample.includes("\"type\":\"session_meta\"") || sample.includes("\"type\": \"session_meta\"");
  },
  adapt(content: string): AdaptedSession {
    const records = parseLines(content);
    const now = new Date().toISOString();
    const sessionMeta = records.find((r) => r.type === "session_meta");
    if (!sessionMeta) {
      throw new Error("No session_meta found in Codex JSONL.");
    }
    const meta = toObject(sessionMeta.payload);
    const sessionId = short(meta.id) ?? `codex_${Date.now()}`;
    const start = toIso(meta.timestamp, toIso(sessionMeta.timestamp, now));
    const intentId = `intent_${sessionId}_main`;
    const events: AdaptedEvent[] = [];

    events.push({
      kind: "session_start",
      ts: start,
      actor: { type: "system", id: "codex" },
      payload: {
        goal: short(meta.user_goal) ?? short(meta.goal) ?? "Imported Codex session",
        user_prompt: short(meta.user_prompt, 3000),
        source: "codex_jsonl",
      },
      visibility: "review",
      derived: true,
      confidence: 0.95,
    });

    for (const record of records) {
      if (record.type === "event_msg") {
        const p = toObject(record.payload);
        if (p.type === "user_message") {
          const message = short(p.message, 3000);
          if (message) {
            events.push({
              kind: "intent",
              ts: toIso(record.timestamp, now),
              actor: { type: "user", id: "codex-user" },
              scope: { intent_id: intentId },
              payload: {
                intent_id: intentId,
                title: message.split("\n")[0]?.slice(0, 120) || "User message",
                description: message,
                source: "codex_event_msg",
              },
              visibility: "review",
              derived: true,
              confidence: 0.85,
            });
          }
        } else if (p.type === "token_count") {
          events.push({
            kind: "token_usage_checkpoint",
            ts: toIso(record.timestamp, now),
            actor: { type: "system", id: "codex" },
            scope: { intent_id: intentId, module: "llm" },
            payload: {
              source: "codex_event_msg",
              usage: p.info,
            },
            visibility: "raw",
            derived: true,
            confidence: 0.75,
          });
        }
      } else if (record.type === "response_item") {
        events.push(...mapResponseItem(record, intentId, now));
      }
    }

    const endTs = toIso(records[records.length - 1]?.timestamp, now);
    events.push({
      kind: "session_end",
      ts: endTs,
      actor: { type: "system", id: "codex" },
      payload: {
        outcome: "unknown",
        summary: "Imported from raw Codex JSONL",
        source: "codex_jsonl",
      },
      visibility: "review",
      derived: true,
      confidence: 0.9,
    });

    return {
      source: "codex_jsonl",
      session_id: sessionId,
      goal: short(meta.user_goal) ?? short(meta.goal),
      user_prompt: short(meta.user_prompt, 3000),
      started_at: start,
      ended_at: endTs,
      events,
    };
  },
};
