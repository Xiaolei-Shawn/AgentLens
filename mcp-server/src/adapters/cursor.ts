import type { AdaptedEvent, AdaptedSession, RawAdapter } from "./types.js";

type BlockType = "user_query" | "think" | "tool_call" | "tool_result" | "token_usage";

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

function parseTaggedBlocks(content: string, tag: "user_query" | "think"): Block[] {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const blocks: Block[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const text = short(match[1] ?? "");
    if (!text) continue;
    blocks.push({
      type: tag,
      index: match.index,
      text,
      ts: findIsoTimestamp(text),
    });
  }
  return blocks;
}

function parseToolBlocks(content: string): Block[] {
  const lines = content.split("\n");
  const blocks: Block[] = [];
  let offset = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const callMatch = line.match(/^\s*Tool call\s*:?\s*(.*)$/i);
    const resultMatch = line.match(/^\s*Tool result\s*:?\s*(.*)$/i);
    if (!callMatch && !resultMatch) {
      offset += line.length + 1;
      i += 1;
      continue;
    }

    const type: BlockType = callMatch ? "tool_call" : "tool_result";
    const start = offset;
    const body: string[] = [];
    if (callMatch && callMatch[1]) body.push(callMatch[1]);
    if (resultMatch && resultMatch[1]) body.push(resultMatch[1]);

    i += 1;
    offset += line.length + 1;
    while (i < lines.length) {
      const next = lines[i];
      if (/^\s*Tool (call|result)\s*:?\s*/i.test(next) || /^\s*<(user_query|think)>/i.test(next)) {
        break;
      }
      body.push(next);
      offset += next.length + 1;
      i += 1;
    }

    const text = short(body.join("\n"));
    if (!text) continue;
    blocks.push({
      type,
      index: start,
      text,
      ts: findIsoTimestamp(text),
    });
  }
  return blocks;
}

function parseTokenUsageBlocks(content: string): Block[] {
  const regex =
    /(?:^|\n)[^\n]*(input_tokens|output_tokens|total_tokens|prompt_tokens|completion_tokens)\s*[:=]\s*\d+[^\n]*/gi;
  const blocks: Block[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const full = short(match[0] ?? "", 1000);
    if (!full) continue;
    blocks.push({
      type: "token_usage",
      index: match.index,
      text: full,
      ts: findIsoTimestamp(full),
    });
  }
  return blocks;
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

export const cursorRawAdapter: RawAdapter = {
  name: "cursor_raw",
  canAdapt(content: string): boolean {
    const sample = content.slice(0, 5000);
    return (
      /<user_query>[\s\S]*?<\/user_query>/i.test(sample) ||
      /<think>[\s\S]*?<\/think>/i.test(sample) ||
      /^\s*Tool call\s*:?/im.test(sample) ||
      /^\s*Tool result\s*:?/im.test(sample)
    );
  },
  adapt(content: string): AdaptedSession {
    const now = new Date();
    const sessionId = `cursor_${Date.now()}`;
    const blocks = [
      ...parseTaggedBlocks(content, "user_query"),
      ...parseTaggedBlocks(content, "think"),
      ...parseToolBlocks(content),
      ...parseTokenUsageBlocks(content),
    ].sort((a, b) => a.index - b.index);

    const baseMs = now.getTime() - Math.max(1, blocks.length) * 1800;
    const events: AdaptedEvent[] = [];
    let intentCounter = 0;
    let activeIntentId: string | undefined;
    let firstUserPrompt: string | undefined;

    const startTs = blocks[0]?.ts ? toIso(blocks[0].ts, now.toISOString()) : synthTs(baseMs, 0);
    events.push({
      kind: "session_start",
      ts: startTs,
      actor: { type: "system", id: "cursor" },
      payload: {
        goal: "Imported Cursor raw log",
        source: "cursor_raw",
      },
      derived: true,
      confidence: 0.9,
      visibility: "review",
    });

    blocks.forEach((block, index) => {
      const ts = toIso(block.ts, synthTs(baseMs, index + 1));
      if (block.type === "user_query") {
        intentCounter += 1;
        activeIntentId = `intent_${sessionId}_${intentCounter}`;
        if (!firstUserPrompt) firstUserPrompt = block.text;
        events.push({
          kind: "intent",
          ts,
          actor: { type: "user", id: "cursor-user" },
          scope: { intent_id: activeIntentId },
          payload: {
            intent_id: activeIntentId,
            title: block.text.split("\n")[0]?.slice(0, 120) ?? "User query",
            description: block.text,
            source: "cursor_raw",
          },
          derived: true,
          confidence: 0.92,
          visibility: "review",
        });
        return;
      }

      if (block.type === "think") {
        events.push({
          kind: "artifact_created",
          ts,
          actor: { type: "agent", id: "cursor-agent" },
          scope: activeIntentId
            ? { intent_id: activeIntentId, module: "reasoning" }
            : { module: "reasoning" },
          payload: {
            artifact_type: "reasoning",
            text: block.text,
            source: "cursor_raw",
          },
          derived: true,
          confidence: 0.82,
          visibility: "debug",
        });
        return;
      }

      if (block.type === "tool_call") {
        const line = block.text.split("\n")[0] ?? block.text;
        const action = line.split(/\s+/).slice(0, 6).join(" ");
        events.push({
          kind: "tool_call",
          ts,
          actor: { type: "agent", id: "cursor-agent" },
          scope: activeIntentId ? { intent_id: activeIntentId } : undefined,
          payload: {
            category: "tool",
            action,
            details: {
              source: "cursor_raw",
              raw: block.text,
            },
          },
          derived: true,
          confidence: 0.86,
          visibility: "raw",
        });
        return;
      }

      if (block.type === "tool_result") {
        events.push({
          kind: "tool_call",
          ts,
          actor: { type: "tool", id: "cursor-tool" },
          scope: activeIntentId ? { intent_id: activeIntentId } : undefined,
          payload: {
            category: "execution",
            action: "tool_result",
            details: {
              source: "cursor_raw",
              output: short(block.text, 3500),
            },
          },
          derived: true,
          confidence: 0.84,
          visibility: "raw",
        });
        return;
      }

      if (block.type === "token_usage") {
        events.push({
          kind: "token_usage_checkpoint",
          ts,
          actor: { type: "system", id: "cursor" },
          scope: activeIntentId ? { intent_id: activeIntentId, module: "llm" } : { module: "llm" },
          payload: {
            usage: parseNumericTokenUsage(block.text),
            raw: block.text,
            source: "cursor_raw",
          },
          derived: true,
          confidence: 0.72,
          visibility: "raw",
        });
      }
    });

    const endTs = blocks.length > 0 ? toIso(blocks[blocks.length - 1].ts, synthTs(baseMs, blocks.length + 2)) : now.toISOString();
    events.push({
      kind: "session_end",
      ts: endTs,
      actor: { type: "system", id: "cursor" },
      payload: {
        outcome: "unknown",
        summary: "Imported from raw Cursor log",
        source: "cursor_raw",
      },
      derived: true,
      confidence: 0.88,
      visibility: "review",
    });

    return {
      source: "cursor_raw",
      session_id: sessionId,
      goal: firstUserPrompt ? firstUserPrompt.split("\n")[0]?.slice(0, 200) : "Imported Cursor session",
      user_prompt: firstUserPrompt,
      started_at: startTs,
      ended_at: endTs,
      events,
    };
  },
};
