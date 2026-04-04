import { describe, expect, it } from "vitest";
import { deriveTrustNarrative, groupOutboundRows, presentOutboundRow } from "./trustPresentation";
import type { TrustReviewResponse } from "./trustReview";

describe("trustPresentation", () => {
  it("summarizes outbound rows around destination behavior instead of raw payload blobs", () => {
    const row = presentOutboundRow({
      endpoint: "https://api.anthropic.com/v1/messages",
      endpoint_type: "model_api",
      data_classes: ["prompt", "diff", "metadata"],
      content_visibility: "full",
      user_visible: false,
      risk_level: "high",
      event_ids: ["evt_1", "evt_2"],
      evidence_sources: ["canonical"],
      evidence_refs: [],
    });

    expect(row.destination).toBe("api.anthropic.com");
    expect(row.payload_summary).toBe("prompt and diff content");
    expect(row.payload_detail).toContain("full content");
    expect(row.event_count).toBe(2);
  });

  it("groups outbound rows by endpoint type and sorts high-risk groups first", () => {
    const groups = groupOutboundRows([
      {
        endpoint: "https://telemetry.example.dev/v1",
        endpoint_type: "telemetry",
        data_classes: ["metadata"],
        content_visibility: "metadata_only",
        user_visible: false,
        risk_level: "low",
        event_ids: ["evt_1"],
        evidence_sources: ["canonical"],
        evidence_refs: [],
      },
      {
        endpoint: "https://api.anthropic.com/v1/messages",
        endpoint_type: "model_api",
        data_classes: ["prompt"],
        content_visibility: "full",
        user_visible: false,
        risk_level: "high",
        event_ids: ["evt_2", "evt_3"],
        evidence_sources: ["canonical"],
        evidence_refs: [],
      },
    ]);

    expect(groups[0]?.endpoint_type).toBe("model_api");
    expect(groups[0]?.summary).toContain("high-risk");
    expect(groups[1]?.summary).toContain("metadata-only");
  });

  it("derives key takeaways and next inspection steps from trust review data", () => {
    const response: TrustReviewResponse = {
      session_id: "sess_1",
      summary: { verdict: "high", score: 72, reasons: ["Opaque prompt injection detected."] },
      outbound_matrix: [
        {
          endpoint: "https://api.anthropic.com/v1/messages",
          endpoint_type: "model_api",
          data_classes: ["prompt"],
          content_visibility: "full",
          user_visible: false,
          risk_level: "high",
          event_ids: ["evt_1"],
          evidence_sources: ["canonical"],
          evidence_refs: [],
        },
      ],
      control_surface: [
        {
          id: "finding_control",
          category: "control_surface",
          severity: "medium",
          title: "Background worker scanned history",
          summary: "A background worker scanned session history silently.",
          event_ids: ["evt_2"],
          evidence_sources: ["canonical"],
          evidence_refs: [],
        },
      ],
      transparency_findings: [
        {
          id: "finding_transparency",
          category: "transparency",
          severity: "high",
          title: "Prompt transform detected",
          summary: "Prompt context changed before the model call.",
          event_ids: ["evt_3"],
          evidence_sources: ["canonical"],
          evidence_refs: [],
        },
      ],
      safety_modes: [],
      transparency_diffs: [],
      evidence_index: {},
    };

    const narrative = deriveTrustNarrative(response);

    expect(narrative.takeaways[0]).toContain("api.anthropic.com");
    expect(narrative.takeaways[1]).toContain("background worker");
    expect(narrative.next_steps[0]).toContain("api.anthropic.com");
    expect(narrative.next_steps[1]).toContain("Background worker scanned history");
  });
});
