/**
 * Ingest and merge logic tests.
 * Run from mcp-server: pnpm run build && pnpm test
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { ingestRawContent, ingestRawFile } from "../ingest.js";
import { readSessionEvents } from "../store.js";
import { adaptRawContent } from "../adapters/index.js";

const FIXTURES_DIR = join(process.cwd(), "fixtures");

function fixturePath(name: string): string {
  return join(FIXTURES_DIR, name);
}

describe("adapters", () => {
  it("cursor_raw adapts sample and produces session_start, intent, tool_call, session_end", () => {
    const raw = readFileSync(fixturePath("cursor_sample.txt"), "utf-8");
    const adapted = adaptRawContent(raw, "cursor_raw");
    assert.strictEqual(adapted.source, "cursor_raw");
    assert.ok(adapted.session_id?.startsWith("cursor_"));
    const kinds = adapted.events.map((e) => e.kind);
    assert.ok(kinds.includes("session_start"), "has session_start");
    assert.ok(kinds.includes("intent"), "has intent");
    assert.ok(kinds.includes("session_end"), "has session_end");
    const hasToolOrArtifact =
      kinds.includes("tool_call") || kinds.includes("artifact_created");
    assert.ok(hasToolOrArtifact, "has tool_call or artifact_created");
  });

  it("codex_jsonl adapts sample and produces session_start, intent, session_end", () => {
    const raw = readFileSync(fixturePath("codex_sample.jsonl"), "utf-8");
    const adapted = adaptRawContent(raw, "codex_jsonl");
    assert.strictEqual(adapted.source, "codex_jsonl");
    const kinds = adapted.events.map((e) => e.kind);
    assert.ok(kinds.includes("session_start"), "has session_start");
    assert.ok(kinds.includes("intent"), "has intent");
    assert.ok(kinds.includes("session_end"), "has session_end");
  });

  it("claude_code_transcript adapts sample and produces session_start, intent, tool_call, session_end", () => {
    const raw = readFileSync(fixturePath("claude_sample.txt"), "utf-8");
    const adapted = adaptRawContent(raw, "claude_code_transcript");
    assert.strictEqual(adapted.source, "claude_code_transcript");
    assert.ok(adapted.session_id?.startsWith("claude_"));
    assert.ok(adapted.user_prompt?.startsWith("Review the ingest pipeline"));
    const kinds = adapted.events.map((e) => e.kind);
    assert.ok(kinds.includes("session_start"), "has session_start");
    assert.ok(kinds.includes("intent"), "has intent");
    assert.ok(kinds.includes("session_end"), "has session_end");
    assert.ok(kinds.includes("tool_call") || kinds.includes("artifact_created"), "has tool_call or artifact_created");
    assert.ok(
      adapted.events.some(
        (event) =>
          event.kind === "artifact_created" &&
          event.payload.artifact_type === "assistant_message" &&
          typeof event.payload.text === "string"
      ),
      "preserves assistant output"
    );
  });

  it("claude_code_jsonl adapts sample and produces session_start, intent, tool_call, session_end", () => {
    const raw = readFileSync(fixturePath("claude_structured_sample.jsonl"), "utf-8");
    const adapted = adaptRawContent(raw, "claude_code_jsonl");
    assert.strictEqual(adapted.source, "claude_code_jsonl");
    assert.strictEqual(adapted.session_id, "claude_structured_fixture_1");
    assert.strictEqual(adapted.user_prompt, "Review structured Claude ingest and preserve tool activity");
    const kinds = adapted.events.map((e) => e.kind);
    assert.ok(kinds.includes("session_start"), "has session_start");
    assert.ok(kinds.includes("intent"), "has intent");
    assert.ok(kinds.includes("session_end"), "has session_end");
    assert.ok(kinds.includes("tool_call") || kinds.includes("artifact_created"), "has tool_call or artifact_created");
    assert.ok(
      adapted.events.some(
        (event) =>
          event.kind === "artifact_created" &&
          event.payload.artifact_type === "assistant_message" &&
          typeof event.payload.text === "string"
      ),
      "preserves assistant output"
    );
    assert.ok(
      !adapted.events.some(
        (event) =>
          event.kind === "artifact_created" &&
          event.payload.artifact_type === "reasoning"
      ),
      "does not fabricate reasoning events"
    );
    assert.ok(
      adapted.events.some((event) => event.kind === "token_usage_checkpoint"),
      "emits token usage when numeric usage is present"
    );
  });

  it("auto adapter selects cursor_raw for cursor-style content", () => {
    const raw = readFileSync(fixturePath("cursor_sample.txt"), "utf-8");
    const adapted = adaptRawContent(raw, "auto");
    assert.strictEqual(adapted.source, "cursor_raw");
  });

  it("auto adapter selects codex_jsonl for codex JSONL content", () => {
    const raw = readFileSync(fixturePath("codex_sample.jsonl"), "utf-8");
    const adapted = adaptRawContent(raw, "auto");
    assert.strictEqual(adapted.source, "codex_jsonl");
  });

  it("auto adapter selects claude_code_transcript for Claude transcript content", () => {
    const raw = readFileSync(fixturePath("claude_sample.txt"), "utf-8");
    const adapted = adaptRawContent(raw, "auto");
    assert.strictEqual(adapted.source, "claude_code_transcript");
  });

  it("auto adapter selects claude_code_jsonl for Claude structured content", () => {
    const raw = readFileSync(fixturePath("claude_structured_sample.jsonl"), "utf-8");
    const adapted = adaptRawContent(raw, "auto");
    assert.strictEqual(adapted.source, "claude_code_jsonl");
  });

  it("auto adapter does not claim ambiguous generic JSONL", () => {
    const raw = [
      JSON.stringify({ type: "message", payload: { role: "user", text: "hello" } }),
      JSON.stringify({ type: "message", payload: { role: "assistant", text: "hi" } }),
    ].join("\n");
    assert.throws(() => adaptRawContent(raw, "auto"), /No raw adapter matched input/);
  });

  it("claude_code_jsonl fails cleanly for valid JSONL without Claude signals", () => {
    const raw = [
      JSON.stringify({ type: "message", payload: { role: "user", text: "hello" } }),
      JSON.stringify({ type: "message", payload: { role: "assistant", text: "hi" } }),
    ].join("\n");
    assert.throws(() => adaptRawContent(raw, "claude_code_jsonl"), /No Claude Code structured JSONL records detected/);
  });

  it("claude_code_jsonl fails cleanly for invalid JSONL", () => {
    assert.throws(() => adaptRawContent("not-json", "claude_code_jsonl"), /Invalid JSONL line 1/);
  });
});

describe("ingest", () => {
  let sessionsDir: string;
  const originalSessionsDir = process.env.AL_SESSIONS_DIR;

  before(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), "agentlens-test-"));
    process.env.AL_SESSIONS_DIR = sessionsDir;
  });

  after(() => {
    process.env.AL_SESSIONS_DIR = originalSessionsDir;
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("ingest creates new session and inserts events", () => {
    const raw = readFileSync(fixturePath("cursor_sample.txt"), "utf-8");
    const result = ingestRawContent(raw, { adapter: "cursor_raw" });
    assert.ok(result.session_id);
    assert.strictEqual(result.adapter, "cursor_raw");
    assert.strictEqual(result.merge_strategy, "new_session");
    assert.ok(result.inserted > 0, "inserted > 0");
    const events = readSessionEvents(result.session_id);
    assert.strictEqual(events.length, result.inserted);
  });

  it("ingest with merge_session_id merges into existing session with semantic dedupe", () => {
    const raw = readFileSync(fixturePath("cursor_sample.txt"), "utf-8");
    const first = ingestRawContent(raw, { adapter: "cursor_raw" });
    const countAfterFirst = readSessionEvents(first.session_id).length;

    const second = ingestRawContent(raw, {
      adapter: "cursor_raw",
      merge_session_id: first.session_id,
    });
    assert.strictEqual(second.session_id, first.session_id);
    assert.strictEqual(second.merge_strategy, "explicit_merge");
    assert.ok(second.skipped_duplicates > 0, "semantic dedupe skips most events when same content merged");
    assert.ok(
      second.inserted <= 1,
      "at most one new event (e.g. token_usage with different ts) when same content merged"
    );

    const eventsAfterMerge = readSessionEvents(first.session_id);
    assert.ok(
      eventsAfterMerge.length <= countAfterFirst + 1,
      "event count grows by at most one after merge of same content"
    );
  });

  it("merged session is ordered by ts and seq is contiguous", () => {
    const raw = readFileSync(fixturePath("cursor_sample.txt"), "utf-8");
    const first = ingestRawContent(raw, { adapter: "cursor_raw" });
    const sessionId = first.session_id;
    const events = readSessionEvents(sessionId);

    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1];
      const b = events[i];
      assert.ok(
        a.ts <= b.ts || (a.ts === b.ts && (a.seq ?? 0) <= (b.seq ?? 0)),
        `events ordered: ${a.seq} (${a.ts}) before ${b.seq} (${b.ts})`
      );
      assert.strictEqual(b.seq, (a.seq ?? 0) + 1, "seq contiguous");
    }
  });

  it("ingest from file path works", () => {
    const path = fixturePath("codex_sample.jsonl");
    const result = ingestRawFile(path, { adapter: "codex_jsonl" });
    assert.ok(result.session_id);
    assert.strictEqual(result.adapter, "codex_jsonl");
    assert.ok(result.inserted > 0);
  });

  it("ingest creates new session from Claude transcript", () => {
    const raw = readFileSync(fixturePath("claude_sample.txt"), "utf-8");
    const result = ingestRawContent(raw, { adapter: "claude_code_transcript" });
    assert.ok(result.session_id);
    assert.strictEqual(result.adapter, "claude_code_transcript");
    assert.strictEqual(result.merge_strategy, "new_session");
    assert.ok(result.inserted > 0);
    const events = readSessionEvents(result.session_id);
    assert.strictEqual(events.length, result.inserted);
  });

  it("ingest creates new session from Claude structured JSONL", () => {
    const raw = readFileSync(fixturePath("claude_structured_sample.jsonl"), "utf-8");
    const result = ingestRawContent(raw, { adapter: "claude_code_jsonl" });
    assert.ok(result.session_id);
    assert.strictEqual(result.session_id, "claude_structured_fixture_1");
    assert.strictEqual(result.adapter, "claude_code_jsonl");
    assert.strictEqual(result.merge_strategy, "new_session");
    assert.ok(result.inserted > 0);
    const events = readSessionEvents(result.session_id);
    assert.strictEqual(events.length, result.inserted);
  });

  it("Claude transcript merge preserves semantic dedupe and ordering", () => {
    const raw = readFileSync(fixturePath("claude_sample.txt"), "utf-8");
    const first = ingestRawContent(raw, { adapter: "claude_code_transcript" });
    const sessionId = first.session_id;
    const before = readSessionEvents(sessionId).length;

    const second = ingestRawContent(raw, {
      adapter: "claude_code_transcript",
      merge_session_id: sessionId,
    });
    assert.strictEqual(second.session_id, sessionId);
    assert.strictEqual(second.merge_strategy, "explicit_merge");
    assert.ok(second.skipped_duplicates > 0, "dedupe skips repeated Claude transcript events");

    const afterEvents = readSessionEvents(sessionId);
    assert.ok(afterEvents.length <= before + 1, "merge grows event count by at most one");
    for (let i = 1; i < afterEvents.length; i++) {
      const a = afterEvents[i - 1];
      const b = afterEvents[i];
      assert.ok(
        a.ts <= b.ts || (a.ts === b.ts && (a.seq ?? 0) <= (b.seq ?? 0)),
        `events ordered: ${a.seq} (${a.ts}) before ${b.seq} (${b.ts})`
      );
    }
  });

  it("Claude structured JSONL merge preserves semantic dedupe and ordering", () => {
    const raw = readFileSync(fixturePath("claude_structured_sample.jsonl"), "utf-8");
    const first = ingestRawContent(raw, { adapter: "claude_code_jsonl" });
    const sessionId = first.session_id;
    const before = readSessionEvents(sessionId).length;

    const second = ingestRawContent(raw, {
      adapter: "claude_code_jsonl",
      merge_session_id: sessionId,
    });
    assert.strictEqual(second.session_id, sessionId);
    assert.strictEqual(second.merge_strategy, "explicit_merge");
    assert.ok(second.skipped_duplicates > 0, "dedupe skips repeated Claude structured events");

    const afterEvents = readSessionEvents(sessionId);
    assert.ok(afterEvents.length <= before + 1, "merge grows event count by at most one");
    for (let i = 1; i < afterEvents.length; i++) {
      const a = afterEvents[i - 1];
      const b = afterEvents[i];
      assert.ok(
        a.ts <= b.ts || (a.ts === b.ts && (a.seq ?? 0) <= (b.seq ?? 0)),
        `events ordered: ${a.seq} (${a.ts}) before ${b.seq} (${b.ts})`
      );
    }
  });

  it("merge raw log from different day: time window filters out all raw events", () => {
    const sessionId = "sess_merge_target_time_window";
    const sessionStartTs = "2026-03-02T20:55:12.151Z";
    const sessionEndTs = "2026-03-02T20:57:42.004Z";
    const sessionLines = [
      JSON.stringify({
        id: `${sessionId}:1:aa`,
        session_id: sessionId,
        seq: 1,
        ts: sessionStartTs,
        kind: "session_start",
        actor: { type: "agent" },
        payload: { goal: "Test" },
        schema_version: 1,
      }),
      JSON.stringify({
        id: `${sessionId}:2:bb`,
        session_id: sessionId,
        seq: 2,
        ts: sessionEndTs,
        kind: "session_end",
        actor: { type: "agent" },
        payload: { outcome: "completed" },
        schema_version: 1,
      }),
    ].join("\n") + "\n";
    writeFileSync(join(sessionsDir, `${sessionId}.jsonl`), sessionLines, "utf-8");

    const raw = readFileSync(fixturePath("codex_sample.jsonl"), "utf-8");
    const result = ingestRawContent(raw, {
      adapter: "codex_jsonl",
      merge_session_id: sessionId,
    });

    assert.strictEqual(result.session_id, sessionId);
    assert.strictEqual(result.merge_strategy, "explicit_merge");
    assert.strictEqual(result.inserted, 0, "no raw events fall in Mar 2 window");
    assert.ok(
      result.filtered_out_by_time_window !== undefined && result.filtered_out_by_time_window > 0,
      "raw events (Feb 24) were filtered out by time window"
    );
    const eventsAfter = readSessionEvents(sessionId);
    assert.strictEqual(eventsAfter.length, 2, "session still has only session_start and session_end");
  });
});
