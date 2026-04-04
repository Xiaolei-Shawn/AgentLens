import type { AdaptedEvent, AdaptedSession, RawAdapter } from "./types.js";

type BlockType =
  | "user_message"
  | "assistant_message"
  | "reasoning_like"
  | "tool_call"
  | "tool_result"
  | "token_usage";

interface Block {
  type: BlockType;
  index: number;
  text: string;
  ts?: string;
}

function short(value: string, max = 3000): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function toIso(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function findIsoTimestamp(text: string): string | undefined {
  const match = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/);
  return match?.[0];
}

function looksLikeCodexJsonl(sample: string): boolean {
  return sample.includes("\"type\":\"session_meta\"") || sample.includes("\"type\": \"session_meta\"");
}

function looksLikeCursorTaggedTranscript(sample: string): boolean {
  return (
    /<user_query>[\s\S]*?<\/user_query>/i.test(sample) ||
    /<think>[\s\S]*?<\/think>/i.test(sample)
  );
}

function hasClaudeTranscriptSignals(sample: string): boolean {
  if (looksLikeCodexJsonl(sample) || looksLikeCursorTaggedTranscript(sample)) return false;
  if (sample.trim().startsWith("{")) return false;

  const score =
    (/\bClaude Code\b/i.test(sample) ? 2 : 0) +
    (/^\s*(User|Human)\s*:/im.test(sample) ? 1 : 0) +
    (/^\s*(Assistant|Claude)\s*:/im.test(sample) ? 1 : 0) +
    (/^\s*(Tool Call|Command)\s*:/im.test(sample) ? 1 : 0) +
    (/^\s*(Tool Result|Command Output|Result)\s*:/im.test(sample) ? 1 : 0) +
    (/^\s*(Thinking|Reasoning|Plan)\s*:/im.test(sample) ? 1 : 0) +
    (/^\s*(Token Usage|Tokens)\s*:/im.test(sample) ? 1 : 0);

  return score >= 4;
}

function parseNumericTokenUsage(text: string): Record<string, number> | undefined {
  const pull = (name: string): number | undefined => {
    const match = text.match(new RegExp(`${name}\\s*[:=]\\s*(\\d+)`, "i"));
    if (!match) return undefined;
    const num = Number(match[1]);
    return Number.isFinite(num) ? num : undefined;
  };
  const prompt = pull("prompt_tokens") ?? pull("input_tokens");
  const completion = pull("completion_tokens") ?? pull("output_tokens");
  const total = pull("total_tokens");
  if (prompt === undefined && completion === undefined && total === undefined) return undefined;
  return {
    prompt_tokens: prompt ?? 0,
    completion_tokens: completion ?? 0,
    total_tokens: total ?? (prompt ?? 0) + (completion ?? 0),
  };
}

function synthTs(baseMs: number, index: number): string {
  return new Date(baseMs + index * 1800).toISOString();
}

function parseTranscriptBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let offset = 0;
  let i = 0;

  const headerMatchers: Array<{ type: BlockType; regex: RegExp }> = [
    { type: "user_message", regex: /^\s*(?:User|Human)\s*:\s*(.*)$/i },
    { type: "assistant_message", regex: /^\s*(?:Assistant|Claude)\s*:\s*(.*)$/i },
    { type: "reasoning_like", regex: /^\s*(?:Thinking|Reasoning|Plan)\s*:\s*(.*)$/i },
    { type: "tool_call", regex: /^\s*(?:Tool Call|Command)\s*:\s*(.*)$/i },
    { type: "tool_result", regex: /^\s*(?:Tool Result|Command Output|Result)\s*:\s*(.*)$/i },
    { type: "token_usage", regex: /^\s*(?:Token Usage|Tokens)\s*:\s*(.*)$/i },
  ];

  while (i < lines.length) {
    const line = lines[i];
    const header = headerMatchers
      .map((item) => ({ ...item, match: line.match(item.regex) }))
      .find((item) => item.match);

    if (!header) {
      offset += line.length + 1;
      i += 1;
      continue;
    }

    const start = offset;
    const body: string[] = [];
    const first = short(header.match?.[1] ?? "", 6000);
    if (first) body.push(first);

    i += 1;
    offset += line.length + 1;
    while (i < lines.length) {
      const next = lines[i];
      if (headerMatchers.some((item) => item.regex.test(next))) {
        break;
      }
      body.push(next);
      offset += next.length + 1;
      i += 1;
    }

    const text = short(body.join("\n"), header.type === "tool_result" ? 3500 : 3000);
    if (!text) continue;
    blocks.push({
      type: header.type,
      index: start,
      text,
      ts: findIsoTimestamp(text) ?? findIsoTimestamp(line),
    });
  }

  return blocks.sort((a, b) => a.index - b.index);
}

function inferGoal(firstUserPrompt: string | undefined): string {
  return firstUserPrompt?.split("\n")[0]?.slice(0, 200) || "Imported Claude Code session";
}

function inferSessionId(content: string): string | undefined {
  const explicit =
    content.match(/^\s*Session\s*:\s*([A-Za-z0-9._-]+)/im)?.[1] ??
    content.match(/^\s*Session ID\s*:\s*([A-Za-z0-9._-]+)/im)?.[1];
  if (!explicit) return undefined;
  return `claude_${explicit}`;
}

export const claudeCodeTranscriptAdapter: RawAdapter = {
  name: "claude_code_transcript",
  canAdapt(content: string): boolean {
    return hasClaudeTranscriptSignals(content.slice(0, 6000));
  },
  adapt(content: string): AdaptedSession {
    const now = new Date();
    const blocks = parseTranscriptBlocks(content);
    if (blocks.length === 0) {
      throw new Error("No Claude Code transcript blocks detected.");
    }

    const sessionId = inferSessionId(content) ?? `claude_${Date.now()}`;
    const baseMs = now.getTime() - Math.max(1, blocks.length) * 1800;
    const events: AdaptedEvent[] = [];
    let intentCounter = 0;
    let activeIntentId: string | undefined;
    let firstUserPrompt: string | undefined;

    const startTs = blocks[0]?.ts ? toIso(blocks[0].ts, now.toISOString()) : synthTs(baseMs, 0);
    events.push({
      kind: "session_start",
      ts: startTs,
      actor: { type: "system", id: "claude-code" },
      payload: {
        goal: "Imported Claude Code session",
        source: "claude_code_transcript",
      },
      derived: true,
      confidence: 0.88,
      visibility: "review",
    });

    blocks.forEach((block, index) => {
      const ts = toIso(block.ts, synthTs(baseMs, index + 1));

      if (block.type === "user_message") {
        intentCounter += 1;
        activeIntentId = `intent_${sessionId}_${intentCounter}`;
        firstUserPrompt ??= block.text;
        events.push({
          kind: "intent",
          ts,
          actor: { type: "user", id: "claude-user" },
          scope: { intent_id: activeIntentId },
          payload: {
            intent_id: activeIntentId,
            title: block.text.split("\n")[0]?.slice(0, 120) ?? "User message",
            description: block.text,
            source: "claude_code_transcript",
          },
          derived: true,
          confidence: 0.9,
          visibility: "review",
        });
        return;
      }

      if (block.type === "assistant_message") {
        events.push({
          kind: "artifact_created",
          ts,
          actor: { type: "agent", id: "claude-code" },
          scope: activeIntentId ? { intent_id: activeIntentId, module: "assistant_output" } : { module: "assistant_output" },
          payload: {
            artifact_type: "assistant_message",
            text: block.text,
            source: "claude_code_transcript",
          },
          derived: true,
          confidence: 0.84,
          visibility: "review",
        });
        return;
      }

      if (block.type === "reasoning_like") {
        events.push({
          kind: "artifact_created",
          ts,
          actor: { type: "agent", id: "claude-code" },
          scope: activeIntentId ? { intent_id: activeIntentId, module: "reasoning" } : { module: "reasoning" },
          payload: {
            artifact_type: "reasoning",
            text: block.text,
            source: "claude_code_transcript",
          },
          derived: true,
          confidence: 0.72,
          visibility: "debug",
        });
        return;
      }

      if (block.type === "tool_call") {
        const action = block.text.split("\n")[0]?.split(/\s+/).slice(0, 8).join(" ") || "tool_call";
        events.push({
          kind: "tool_call",
          ts,
          actor: { type: "agent", id: "claude-code" },
          scope: activeIntentId ? { intent_id: activeIntentId } : undefined,
          payload: {
            category: "tool",
            action,
            details: {
              source: "claude_code_transcript",
              raw: block.text,
            },
          },
          derived: true,
          confidence: 0.83,
          visibility: "raw",
        });
        return;
      }

      if (block.type === "tool_result") {
        events.push({
          kind: "tool_call",
          ts,
          actor: { type: "tool", id: "claude-tool" },
          scope: activeIntentId ? { intent_id: activeIntentId } : undefined,
          payload: {
            category: "execution",
            action: "tool_result",
            details: {
              source: "claude_code_transcript",
              output: short(block.text, 3500),
            },
          },
          derived: true,
          confidence: 0.81,
          visibility: "raw",
        });
        return;
      }

      if (block.type === "token_usage") {
        const usage = parseNumericTokenUsage(block.text);
        if (!usage) return;
        events.push({
          kind: "token_usage_checkpoint",
          ts,
          actor: { type: "system", id: "claude-code" },
          scope: activeIntentId ? { intent_id: activeIntentId, module: "llm" } : { module: "llm" },
          payload: {
            usage,
            raw: block.text,
            source: "claude_code_transcript",
          },
          derived: true,
          confidence: 0.74,
          visibility: "raw",
        });
      }
    });

    const endTs = blocks[blocks.length - 1]?.ts
      ? toIso(blocks[blocks.length - 1].ts, synthTs(baseMs, blocks.length + 2))
      : synthTs(baseMs, blocks.length + 2);
    events.push({
      kind: "session_end",
      ts: endTs,
      actor: { type: "system", id: "claude-code" },
      payload: {
        outcome: "unknown",
        summary: "Imported from raw Claude Code transcript",
        source: "claude_code_transcript",
      },
      derived: true,
      confidence: 0.86,
      visibility: "review",
    });

    return {
      source: "claude_code_transcript",
      session_id: sessionId,
      goal: inferGoal(firstUserPrompt),
      user_prompt: firstUserPrompt,
      started_at: startTs,
      ended_at: endTs,
      events,
    };
  },
};
