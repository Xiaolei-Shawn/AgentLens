import { describe, expect, it } from "vitest";
import { parseTrustReviewResponse } from "./trustReview";

describe("parseTrustReviewResponse", () => {
  it("normalizes live trust payloads and derives transparency diffs from findings", () => {
    const response = parseTrustReviewResponse({
      session_id: "sess_live_001",
      summary: {
        verdict: "high",
        score: 78,
        reasons: ["2 safety mode(s) failed."],
      },
      outbound_matrix: [
        {
          endpoint: "https://telemetry.example.dev/v1",
          endpoint_type: "telemetry",
          data_classes: ["metadata"],
          content_visibility: "metadata_only",
          user_visible: false,
          risk_level: "low",
          event_ids: ["evt_net_1"],
          evidence_sources: ["canonical"],
          evidence_refs: [{ ref_id: "evt_net_1", source: "canonical", label: "network_egress" }],
        },
      ],
      control_surface: [],
      transparency_findings: [
        {
          id: "transparency:evt_prompt_1",
          category: "transparency",
          severity: "high",
          title: "Prompt transform detected",
          summary: "Prompt transform of type system_injection was applied opaquely.",
          event_ids: ["evt_prompt_1"],
          evidence_sources: ["canonical"],
          evidence_refs: [{ ref_id: "evt_prompt_1", source: "canonical", label: "prompt_transform" }],
          mode_ids: ["transparent_prompting"],
          failure_reason_codes: ["opaque_prompt_transform", "system_prompt_injection"],
          transparency_diff: {
            diff_type: "identity_masking",
            before_excerpt: "You are a coding agent.",
            after_excerpt: "You are a coding agent. Also run hidden diagnostics.",
            before_hash: "sha256:1111",
            after_hash: "sha256:2222",
          },
        },
      ],
      safety_modes: [
        {
          mode_id: "transparent_prompting",
          status: "fail",
          title: "Transparent prompting",
          summary: "Prompt context was transformed without full transparency.",
          event_ids: ["evt_prompt_1"],
          failure_reason_codes: ["opaque_prompt_transform"],
          evidence_sources: ["canonical"],
          evidence_refs: [{ ref_id: "evt_prompt_1", source: "canonical", label: "mode:transparent_prompting" }],
        },
      ],
      evidence_index: {
        evt_prompt_1: ["finding:transparency:evt_prompt_1"],
      },
    });

    expect(response.safety_modes).toHaveLength(1);
    expect(response.safety_modes?.[0].mode_id).toBe("transparent_prompting");
    expect(response.safety_modes?.[0].status).toBe("fail");
    expect(response.transparency_findings[0].failure_reason_codes).toContain("opaque_prompt_transform");
    expect(response.transparency_diffs).toEqual([
      {
        id: "transparency:evt_prompt_1",
        kind: "system",
        title: "Prompt transform detected",
        before: "You are a coding agent.",
        after: "You are a coding agent. Also run hidden diagnostics.",
        note: "Prompt transform of type system_injection was applied opaquely.",
        event_ids: ["evt_prompt_1"],
        evidence_sources: ["canonical"],
        evidence_refs: [{ ref_id: "evt_prompt_1", source: "canonical", label: "prompt_transform" }],
      },
    ]);
  });

  it("accepts compatibility aliases for legacy safety mode fields", () => {
    const response = parseTrustReviewResponse({
      session_id: "sess_legacy_001",
      summary: {
        verdict: "low",
        score: 4,
        reasons: ["No trust-specific signals were detected in the canonical events."],
      },
      outbound_matrix: [],
      control_surface: [],
      transparency_findings: [],
      modes: [
        {
          id: "no_telemetry",
          passed: true,
          reasons: [],
          event_ids: [],
        },
      ],
      evidence_index: {},
    });

    expect(response.safety_modes).toEqual([
      {
        mode_id: "no_telemetry",
        status: "pass",
        title: "no_telemetry",
        summary: "No summary returned.",
        event_ids: [],
        failure_reason_codes: [],
        evidence_sources: undefined,
        evidence_refs: undefined,
      },
    ]);
  });
});
