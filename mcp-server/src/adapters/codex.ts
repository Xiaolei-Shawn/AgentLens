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

function sanitizeText(value: unknown, max = 3000): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function normalizeTokenUsage(value: unknown): Record<string, unknown> | undefined {
  const info = toObject(value);
  const total = toObject(info.total_token_usage);
  const last = toObject(info.last_token_usage);
  const primary = Object.keys(last).length > 0 ? last : total;
  if (Object.keys(primary).length === 0) return undefined;
  const prompt = primary.input_tokens;
  const completion = primary.output_tokens;
  const totalTokens = primary.total_tokens;
  return {
    prompt_tokens: typeof prompt === "number" ? prompt : undefined,
    completion_tokens: typeof completion === "number" ? completion : undefined,
    total_tokens: typeof totalTokens === "number" ? totalTokens : undefined,
    input_tokens: typeof primary.input_tokens === "number" ? primary.input_tokens : undefined,
    cached_input_tokens:
      typeof primary.cached_input_tokens === "number" ? primary.cached_input_tokens : undefined,
    output_tokens: typeof primary.output_tokens === "number" ? primary.output_tokens : undefined,
    reasoning_output_tokens:
      typeof primary.reasoning_output_tokens === "number" ? primary.reasoning_output_tokens : undefined,
    source_model_context_window:
      typeof info.model_context_window === "number" ? info.model_context_window : undefined,
  };
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

function mapResponseItem(record: CodexLine, intentId: string | undefined, now: string): AdaptedEvent[] {
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
        scope: intentId ? { intent_id: intentId } : undefined,
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
        scope: intentId ? { intent_id: intentId } : undefined,
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

  if (itemType === "reasoning") {
    const summary = Array.isArray(payload.summary)
      ? payload.summary
          .map((entry) => {
            const record = toObject(entry);
            return sanitizeText(record.text, 500);
          })
          .filter((s): s is string => Boolean(s))
          .join(" ")
      : undefined;
    const encrypted = sanitizeText(payload.encrypted_content, 400);
    if (!summary && !encrypted) return [];
    return [
      {
        kind: "artifact_created",
        ts,
        actor: { type: "agent", id: "codex" },
        scope: intentId ? { intent_id: intentId, module: "reasoning" } : { module: "reasoning" },
        payload: {
          artifact_type: "reasoning",
          summary,
          encrypted_content_preview: encrypted,
          source: "codex_response_item",
        },
        derived: true,
        confidence: 0.9,
        visibility: "debug",
      },
    ];
  }

  if (itemType === "message") {
    const content = Array.isArray(payload.content) ? payload.content : [];
    const texts = content
      .map((entry) => sanitizeText(toObject(entry).text))
      .filter((s): s is string => Boolean(s));
    const merged = texts.join("\n").trim();
    if (!merged) return [];
    return [
      {
        kind: "artifact_created",
        ts,
        actor: { type: "agent", id: "codex" },
        scope: intentId ? { intent_id: intentId, module: "assistant_output" } : { module: "assistant_output" },
        payload: {
          artifact_type: "assistant_message",
          role: short(payload.role),
          phase: short(payload.phase),
          text: sanitizeText(merged, 3200),
          source: "codex_response_item",
        },
        derived: true,
        confidence: 0.85,
        visibility: "review",
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
    let intentCounter = 0;
    let activeIntentId: string | undefined;
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
            intentCounter += 1;
            activeIntentId = `intent_${sessionId}_${intentCounter}`;
            events.push({
              kind: "intent",
              ts: toIso(record.timestamp, now),
              actor: { type: "user", id: "codex-user" },
              scope: { intent_id: activeIntentId },
              payload: {
                intent_id: activeIntentId,
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
          const usage = normalizeTokenUsage(p.info);
          events.push({
            kind: "token_usage_checkpoint",
            ts: toIso(record.timestamp, now),
            actor: { type: "system", id: "codex" },
            scope: activeIntentId ? { intent_id: activeIntentId, module: "llm" } : { module: "llm" },
            payload: {
              source: "codex_event_msg",
              usage,
              raw: p.info,
            },
            visibility: "raw",
            derived: true,
            confidence: 0.75,
          });
        } else if (p.type === "agent_reasoning") {
          const reasoning = sanitizeText(p.text, 3500);
          if (reasoning) {
            events.push({
              kind: "artifact_created",
              ts: toIso(record.timestamp, now),
              actor: { type: "agent", id: "codex" },
              scope: activeIntentId
                ? { intent_id: activeIntentId, module: "reasoning" }
                : { module: "reasoning" },
              payload: {
                artifact_type: "reasoning",
                text: reasoning,
                source: "codex_event_msg",
              },
              visibility: "debug",
              derived: true,
              confidence: 0.9,
            });
          }
        } else if (p.type === "agent_message") {
          const assistantMessage = sanitizeText(p.message, 3500);
          if (assistantMessage) {
            events.push({
              kind: "artifact_created",
              ts: toIso(record.timestamp, now),
              actor: { type: "agent", id: "codex" },
              scope: activeIntentId
                ? { intent_id: activeIntentId, module: "assistant_output" }
                : { module: "assistant_output" },
              payload: {
                artifact_type: "assistant_message",
                text: assistantMessage,
                source: "codex_event_msg",
              },
              visibility: "review",
              derived: true,
              confidence: 0.85,
            });
          }
        }
      } else if (record.type === "response_item") {
        events.push(...mapResponseItem(record, activeIntentId, now));
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
