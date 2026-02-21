/**
 * Ingest and merge logic tests.
 * Run from mcp-server: pnpm run build && pnpm test
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
});
