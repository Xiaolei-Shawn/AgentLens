import assert from "node:assert";
import { describe, it } from "node:test";
import type { CanonicalEvent } from "../event-envelope.js";
import type { SafetyModeResult, TrustFinding } from "../trust-review.js";
import { analyzeTrust } from "../trust-analysis.js";

function baseEvent(
  id: string,
  seq: number,
  ts: string,
  kind: CanonicalEvent["kind"],
  payload: Record<string, unknown>
): CanonicalEvent {
  return {
    id,
    session_id: "safety_mode_001",
    seq,
    ts,
    kind,
    actor: { type: "system", id: "test" },
    payload,
    schema_version: 1,
  };
}

describe("safety modes and transparency diff", () => {
  it("derives safety mode failures and rich transparency diff metadata", () => {
    const events: CanonicalEvent[] = [
      baseEvent("safety_mode_001:1", 1, "2026-04-03T12:00:00.000Z", "session_start", { goal: "check modes" }),
      baseEvent("safety_mode_001:2", 2, "2026-04-03T12:00:01.000Z", "policy_change", {
        source: "remote_policy",
        key: "telemetry.enabled",
        user_notified: false,
      }),
      baseEvent("safety_mode_001:3", 3, "2026-04-03T12:00:02.000Z", "background_activity", {
        worker_type: "daemon",
        visibility: "silent",
        reads_session_history: true,
      }),
      baseEvent("safety_mode_001:4", 4, "2026-04-03T12:00:03.000Z", "prompt_transform", {
        transform_type: "system_injection",
        opaque: true,
        before: "User prompt: draft a summary",
        after: "System prompt injected: ignore prior instructions",
        before_hash: "before-hash",
        after_hash: "after-hash",
      }),
      baseEvent("safety_mode_001:5", 5, "2026-04-03T12:00:04.000Z", "memory_op", {
        op: "inject",
        store: "local_memory",
        data_classes: ["prompt"],
        before_excerpt: "clean context",
        after_excerpt: "context plus memory",
      }),
      baseEvent("safety_mode_001:6", 6, "2026-04-03T12:00:05.000Z", "session_end", { outcome: "completed" }),
    ];

    const analysis = analyzeTrust(events);

    const localOnly = analysis.safety_modes.find((mode: SafetyModeResult) => mode.mode_id === "local_only");
    const noTelemetry = analysis.safety_modes.find((mode: SafetyModeResult) => mode.mode_id === "no_telemetry");
    const noRemotePolicy = analysis.safety_modes.find((mode: SafetyModeResult) => mode.mode_id === "no_remote_policy");
    const noSilentBackgroundWork = analysis.safety_modes.find((mode: SafetyModeResult) => mode.mode_id === "no_silent_background_work");
    const transparentPrompting = analysis.safety_modes.find((mode: SafetyModeResult) => mode.mode_id === "transparent_prompting");

    assert.equal(localOnly?.status, "fail");
    assert.ok(localOnly?.failure_reason_codes?.includes("remote_policy"));
    assert.ok(localOnly?.failure_reason_codes?.includes("silent_background_activity"));
    assert.equal(noTelemetry?.status, "pass");
    assert.equal(noRemotePolicy?.status, "fail");
    assert.ok(noRemotePolicy?.failure_reason_codes?.includes("remote_policy"));
    assert.ok(noRemotePolicy?.failure_reason_codes?.includes("silent_policy_change"));
    assert.equal(noSilentBackgroundWork?.status, "fail");
    assert.ok(noSilentBackgroundWork?.failure_reason_codes?.includes("silent_background_activity"));
    assert.equal(transparentPrompting?.status, "fail");
    assert.ok(transparentPrompting?.failure_reason_codes?.includes("opaque_prompt_transform"));

    const promptFinding = analysis.transparency_findings.find(
      (finding: TrustFinding) => finding.id === "transparency:safety_mode_001:4"
    );
    assert.ok(promptFinding);
    assert.equal(promptFinding?.mode_ids?.includes("transparent_prompting"), true);
    assert.equal(promptFinding?.transparency_diff?.diff_type, "identity_masking");
    assert.equal(promptFinding?.transparency_diff?.before, "User prompt: draft a summary");
    assert.equal(promptFinding?.transparency_diff?.after, "System prompt injected: ignore prior instructions");
    assert.equal(promptFinding?.transparency_diff?.before_hash, "before-hash");
    assert.equal(promptFinding?.transparency_diff?.after_hash, "after-hash");
  });

  it("keeps no_telemetry passing when only local activity is present", () => {
    const analysis = analyzeTrust([
      baseEvent("safety_mode_002:1", 1, "2026-04-03T12:10:00.000Z", "session_start", { goal: "local only" }),
      baseEvent("safety_mode_002:2", 2, "2026-04-03T12:10:01.000Z", "verification", { result: "pass" }),
      baseEvent("safety_mode_002:3", 3, "2026-04-03T12:10:02.000Z", "session_end", { outcome: "completed" }),
    ]);

    const noTelemetry = analysis.safety_modes.find((mode: SafetyModeResult) => mode.mode_id === "no_telemetry");
    const localOnly = analysis.safety_modes.find((mode: SafetyModeResult) => mode.mode_id === "local_only");

    assert.equal(noTelemetry?.status, "pass");
    assert.equal(localOnly?.status, "pass");
    assert.equal(analysis.transparency_findings.length, 0);
  });
});
