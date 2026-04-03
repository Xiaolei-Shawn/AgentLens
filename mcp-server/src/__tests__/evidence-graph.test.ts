import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { CanonicalEvent } from "../event-envelope.js";
import type { EvidenceEdge, EvidenceGraphResult, EvidenceNode } from "../evidence-graph.js";
import { analyzeEvidenceGraph } from "../evidence-graph-analysis.js";
import { getEvidenceGraphForSessionKey } from "../dashboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../fixtures/trust");

function readFixture(name: string): CanonicalEvent[] {
  const raw = readFileSync(join(fixturesDir, name), "utf-8").trim();
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CanonicalEvent);
}

function writeFixtureToSessionsDir(dir: string, sessionFileName: string, fixtureName: string): string {
  const source = readFileSync(join(fixturesDir, fixtureName), "utf-8");
  const target = join(dir, sessionFileName);
  writeFileSync(target, source, "utf-8");
  return target;
}

function nodeTypes(graph: EvidenceGraphResult): Set<string> {
  return new Set(graph.nodes.map((node: EvidenceNode) => node.type));
}

function edgeTypes(graph: EvidenceGraphResult): Set<string> {
  return new Set(graph.edges.map((edge: EvidenceEdge) => edge.type));
}

describe("evidence graph", () => {
  it("derives prompt, file, and output nodes from low-risk sessions", () => {
    const graph = analyzeEvidenceGraph(readFixture("low-risk.jsonl"));

    assert.equal(graph.session_id, "trust_low_001");
    assert.equal(graph.summary.prompt_count, 2);
    assert.equal(graph.summary.file_count, 1);
    assert.equal(graph.summary.output_count >= 2, true);
    assert.ok(nodeTypes(graph).has("prompt"));
    assert.ok(nodeTypes(graph).has("file"));
    assert.ok(nodeTypes(graph).has("output"));
    assert.ok(edgeTypes(graph).has("transforms"));
    assert.ok(edgeTypes(graph).has("writes"));
    assert.ok(edgeTypes(graph).has("produces"));
    assert.ok(graph.evidence_index["trust_low_001_f1"]?.some((label: string) => label.startsWith("node:file")));
  });

  it("captures telemetry, control, and transparency graph signals", () => {
    const telemetry = analyzeEvidenceGraph(readFixture("telemetry.jsonl"));
    const control = analyzeEvidenceGraph(readFixture("control-surface.jsonl"));
    const transparency = analyzeEvidenceGraph(readFixture("transparency.jsonl"));

    assert.equal(telemetry.summary.endpoint_count, 1);
    assert.ok(nodeTypes(telemetry).has("endpoint"));
    assert.ok(edgeTypes(telemetry).has("sends"));

    assert.equal(control.summary.background_worker_count, 1);
    assert.equal(control.summary.memory_store_count, 1);
    assert.ok(nodeTypes(control).has("background_worker"));
    assert.ok(nodeTypes(control).has("memory_store"));
    assert.ok(edgeTypes(control).has("spawns"));
    assert.ok(edgeTypes(control).has("syncs"));

    assert.ok(transparency.summary.prompt_count >= 3);
    assert.ok(nodeTypes(transparency).has("endpoint"));
    assert.ok(nodeTypes(transparency).has("memory_store"));
    assert.ok(edgeTypes(transparency).has("transforms"));
    assert.ok(edgeTypes(transparency).has("injects"));
    assert.ok(edgeTypes(transparency).has("sends"));
  });

  it("loads evidence graphs through the dashboard helper used by /api/sessions/:key/evidence-graph", () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "agentlens-evidence-"));
    const originalSessionsDir = process.env.AL_SESSIONS_DIR;
    process.env.AL_SESSIONS_DIR = sessionsDir;

    try {
      writeFixtureToSessionsDir(sessionsDir, "trust_tel_001.jsonl", "telemetry.jsonl");
      const graph = getEvidenceGraphForSessionKey("trust_tel_001");
      assert.equal(graph.session_id, "trust_tel_001");
      assert.equal(graph.summary.endpoint_count, 1);
      assert.ok(graph.nodes.some((node: EvidenceNode) => node.type === "endpoint"));
      assert.ok(graph.edges.some((edge: EvidenceEdge) => edge.type === "sends"));
      assert.ok(graph.evidence_index["trust_tel_001_n1"]?.some((label: string) => label.startsWith("node:endpoint")));
      assert.throws(() => getEvidenceGraphForSessionKey("missing_session"), /Session not found/);
    } finally {
      process.env.AL_SESSIONS_DIR = originalSessionsDir;
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
