import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { CanonicalEvent } from "../event-envelope.js";
import type { TrustAnalysisResult } from "../trust-review.js";
import { analyzeTrust } from "../trust-analysis.js";
import { getTrustAnalysisForSessionKey } from "../dashboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../fixtures/trust");

function readFixture(name: string): CanonicalEvent[] {
  const raw = readFileSync(join(fixturesDir, name), "utf-8").trim();
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CanonicalEvent);
}

function kinds(events: CanonicalEvent[]): Set<string> {
  return new Set(events.map((event) => event.kind));
}

function writeFixtureToSessionsDir(dir: string, sessionFileName: string, fixtureName: string): string {
  const source = readFileSync(join(fixturesDir, fixtureName), "utf-8");
  const target = join(dir, sessionFileName);
  writeFileSync(target, source, "utf-8");
  return target;
}

describe("trust review contracts", () => {
  it("accepts a representative low-risk trust summary shape", () => {
    const sample = {
      session_id: "trust_low_001",
      summary: {
        verdict: "low",
        score: 10,
        reasons: ["Only local file edits and passing verification were observed."],
      },
      outbound_matrix: [],
      control_surface: [],
      transparency_findings: [],
      safety_modes: [],
      evidence_index: {
        "trust_low_001_f1": ["src/utils/math.ts"],
      },
    } satisfies TrustAnalysisResult;

    assert.equal(sample.summary.verdict, "low");
    assert.equal(sample.outbound_matrix.length, 0);
  });

  it("contains representative trust fixtures for the four Milestone 1 scenarios", () => {
    const lowRisk = readFixture("low-risk.jsonl");
    const telemetry = readFixture("telemetry.jsonl");
    const controlSurface = readFixture("control-surface.jsonl");
    const transparency = readFixture("transparency.jsonl");

    assert.ok(kinds(lowRisk).has("capability_snapshot"));
    assert.ok(kinds(telemetry).has("network_egress"));
    assert.ok(kinds(controlSurface).has("policy_change"));
    assert.ok(kinds(controlSurface).has("background_activity"));
    assert.ok(kinds(controlSurface).has("memory_op"));
    assert.ok(kinds(transparency).has("prompt_transform"));
    assert.ok(kinds(transparency).has("remote_code_load"));

    for (const fixture of [lowRisk, telemetry, controlSurface, transparency]) {
      assert.equal(fixture[0]?.kind, "session_start");
      assert.equal(fixture[fixture.length - 1]?.kind, "session_end");
      assert.ok(fixture.every((event) => event.schema_version === 1));
    }
  });

  it("derives deterministic trust analysis for low-risk sessions", () => {
    const lowRisk = readFixture("low-risk.jsonl");
    const analysis = analyzeTrust(lowRisk);

    assert.equal(analysis.summary.verdict, "low");
    assert.equal(analysis.outbound_matrix.length, 0);
    assert.equal(analysis.control_surface.length, 0);
    assert.equal(analysis.transparency_findings.length, 0);
    assert.ok(analysis.summary.reasons.some((reason: string) => reason.includes("No trust-specific signals")));
  });

  it("derives outbound, control, and transparency signals from representative fixtures", () => {
    const telemetry = analyzeTrust(readFixture("telemetry.jsonl"));
    const controlSurface = analyzeTrust(readFixture("control-surface.jsonl"));
    const transparency = analyzeTrust(readFixture("transparency.jsonl"));

    assert.equal(telemetry.outbound_matrix.length, 1);
    assert.equal(telemetry.outbound_matrix[0]?.endpoint_type, "telemetry");
    assert.ok(telemetry.summary.score > 0);

    assert.ok(controlSurface.control_surface.length >= 2);
    assert.equal(controlSurface.summary.verdict, "high");
    assert.ok(controlSurface.control_surface.some((finding: { title: string }) => finding.title.includes("Policy change")));
    assert.ok(
      controlSurface.control_surface.some((finding: { title: string }) => finding.title.includes("Silent background activity"))
    );

    assert.ok(transparency.transparency_findings.length >= 2);
    assert.equal(transparency.summary.verdict, "high");
    assert.ok(
      transparency.transparency_findings.some((finding: { title: string }) => finding.title.includes("Prompt transform"))
    );
    assert.ok(
      transparency.transparency_findings.some((finding: { title: string }) => finding.title.includes("Memory was injected"))
    );
  });

  it("loads trust analysis through the dashboard helper used by /api/sessions/:key/trust", () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "agentlens-trust-"));
    const originalSessionsDir = process.env.AL_SESSIONS_DIR;
    process.env.AL_SESSIONS_DIR = sessionsDir;

    try {
      writeFixtureToSessionsDir(sessionsDir, "trust_tel_001.jsonl", "telemetry.jsonl");
      const trust = getTrustAnalysisForSessionKey("trust_tel_001");
      assert.equal(trust.session_id, "trust_tel_001");
      assert.equal(trust.outbound_matrix.length, 1);
      assert.equal(trust.outbound_matrix[0]?.endpoint_type, "telemetry");
      assert.ok(trust.evidence_index["trust_tel_001_n1"]?.some((label: string) => label.startsWith("outbound")));
      assert.throws(() => getTrustAnalysisForSessionKey("missing_session"), /Session not found/);
    } finally {
      process.env.AL_SESSIONS_DIR = originalSessionsDir;
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
