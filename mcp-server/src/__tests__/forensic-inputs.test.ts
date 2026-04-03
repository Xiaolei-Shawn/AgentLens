import assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { attachForensicAttachmentsFromBody, getForensicSessionSummary, getForensicSignalsForSession } from "../forensic-inputs.js";
import { getTrustAnalysisForSessionKey } from "../dashboard.js";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../../fixtures/trust");

function writeSessionFixture(dir: string, sessionFileName: string, fixtureName: string): string {
  const source = readFileSync(join(fixturesDir, fixtureName), "utf-8");
  const target = join(dir, sessionFileName);
  writeFileSync(target, source, "utf-8");
  return target;
}

describe("forensic inputs", () => {
  it("normalizes config, env, and proxy forensic attachments into source-attributed signals", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "agentlens-forensic-"));
    const originalSessionsDir = process.env.AL_SESSIONS_DIR;
    process.env.AL_SESSIONS_DIR = sessionsDir;

    try {
      writeSessionFixture(sessionsDir, "forensic_session.jsonl", "low-risk.jsonl");

      const summary = await attachForensicAttachmentsFromBody("trust_low_001", {
        attachments: [
          {
            kind: "config_snapshot",
            source_label: "config.json",
            data: {
              policy: { managed: true, remote_policy_enabled: true },
              telemetry: { enabled: false },
              network: { enabled: true, endpoints: ["https://api.example.com"] },
              memory: { remote_sync: true },
              capabilities: { remote_skill_enabled: true },
              runtime: { background_worker_enabled: true, silent_background: true, reads_session_history: true },
            },
          },
          {
            kind: "env_snapshot",
            source_label: "env.json",
            data: {
              env: {
                TELEMETRY_DISABLED: "1",
                HTTPS_PROXY: "https://proxy.example.com",
                OPENAI_API_KEY: "sk-test",
                AL_WATCHER_ENABLED: "true",
              },
            },
          },
          {
            kind: "proxy_trace",
            source_label: "proxy.json",
            data: {
              log: {
                entries: [
                  {
                    startedDateTime: "2026-04-03T12:00:00.000Z",
                    request: {
                      url: "https://api.openai.com/v1/responses",
                      method: "POST",
                      postData: {
                        text: JSON.stringify({
                          prompt: "hello",
                          messages: [{ role: "user", content: "build a trust report" }],
                        }),
                      },
                    },
                    response: { status: 200, bodySize: 128 },
                  },
                ],
              },
            },
          },
        ],
      });

      assert.equal(summary.session_id, "trust_low_001");
      assert.equal(summary.attachment_count, 3);
      assert.ok(summary.signal_count >= 5);
      assert.ok(summary.attachments.some((item: { signal_kinds: string[] }) => item.signal_kinds.includes("capability_snapshot")));
      assert.ok(summary.attachments.some((item: { signal_kinds: string[] }) => item.signal_kinds.includes("network_egress")));

      const forensicSignals = getForensicSignalsForSession("trust_low_001");
      assert.ok(forensicSignals.length >= 5);
      assert.ok(forensicSignals.every((signal: { source?: string; provenance: { attachment_id?: string } }) => signal.source === "forensic"));
      assert.ok(forensicSignals.every((signal: { provenance: { attachment_id?: string } }) => Boolean(signal.provenance.attachment_id)));

      const forensicSession = getForensicSessionSummary("trust_low_001");
      assert.equal(forensicSession.attachment_count, 3);
      assert.ok(forensicSession.attachments.some((item: { source_label?: string }) => item.source_label === "proxy.json"));
    } finally {
      process.env.AL_SESSIONS_DIR = originalSessionsDir;
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });

  it("merges forensic signals into trust analysis with source attribution", async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "agentlens-trust-forensic-"));
    const originalSessionsDir = process.env.AL_SESSIONS_DIR;
    process.env.AL_SESSIONS_DIR = sessionsDir;

    try {
      writeSessionFixture(sessionsDir, "trust_low_001.jsonl", "low-risk.jsonl");
      await attachForensicAttachmentsFromBody("trust_low_001", {
        attachments: [
          {
            kind: "config_snapshot",
            source_label: "config.json",
            data: {
              policy: { managed: true },
              telemetry: { enabled: false },
              network: { enabled: true, endpoints: ["https://policy.example.com"] },
            },
          },
          {
            kind: "proxy_trace",
            source_label: "proxy.json",
            data: {
              requests: [
                {
                  url: "https://api.anthropic.com/v1/messages",
                  method: "POST",
                  body: { prompt: "inspect this session", diff: "..." },
                  response: { status: 200, bodySize: 256 },
                },
              ],
            },
          },
        ],
      });

      const trust = getTrustAnalysisForSessionKey("trust_low_001");
      assert.ok(trust.control_surface.some((finding: { evidence_sources?: string[] }) => finding.evidence_sources?.includes("forensic")));
      assert.ok(trust.outbound_matrix.some((row: { evidence_sources?: string[] }) => row.evidence_sources?.includes("forensic")));
      assert.ok(
        (Object.values(trust.evidence_index) as string[][]).some((labels: string[]) =>
          labels.some((label: string) => label.startsWith("source:forensic"))
        )
      );
    } finally {
      process.env.AL_SESSIONS_DIR = originalSessionsDir;
      rmSync(sessionsDir, { recursive: true, force: true });
    }
  });
});
