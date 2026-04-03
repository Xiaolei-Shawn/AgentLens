import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "../types/session";
import type { TrustFinding, TrustSafetyModeResult, TrustTransparencyDiff } from "../lib/trustReview";
import { SafetyModesPanel } from "./SafetyModesPanel";
import { TransparencyDiffPanel } from "./TransparencyDiffPanel";

function makeSession(): Session {
  return {
    id: "sess_test_001",
    title: "Trust test session",
    user_message: "Inspect trust review panels",
    events: [
      {
        id: "evt_1",
        session_id: "sess_test_001",
        seq: 1,
        ts: "2026-04-03T12:00:00.000Z",
        kind: "session_start",
        actor: { type: "system", id: "test" },
        payload: {},
        schema_version: 1,
      },
      {
        id: "evt_2",
        session_id: "sess_test_001",
        seq: 2,
        ts: "2026-04-03T12:00:01.000Z",
        kind: "prompt_transform",
        actor: { type: "system", id: "test" },
        payload: {},
        schema_version: 1,
      },
    ],
  };
}

describe("Trust Review panels", () => {
  it("renders safety mode verdicts and evidence links", () => {
    const session = makeSession();
    const onSeek = vi.fn();
    const modes: TrustSafetyModeResult[] = [
      {
        mode_id: "transparent_prompting",
        status: "fail",
        title: "Transparent prompting",
        summary: "Prompt context was transformed without full transparency.",
        event_ids: ["evt_2"],
        failure_reason_codes: ["opaque_prompt_transform"],
        evidence_sources: ["canonical"],
        evidence_refs: [{ ref_id: "evt_2", source: "canonical", label: "mode:transparent_prompting" }],
      },
    ];

    render(<SafetyModesPanel session={session} modes={modes} onSeek={onSeek} />);

    expect(screen.getByText("User-facing trust checks")).toBeInTheDocument();
    expect(screen.getByText("Transparent prompting")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.getByText("opaque_prompt_transform")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#2" })).toBeInTheDocument();
  });

  it("renders structured transparency diffs and related findings", () => {
    const session = makeSession();
    const diffs: TrustTransparencyDiff[] = [
      {
        id: "transparency:evt_2",
        kind: "system",
        title: "Prompt transform detected",
        before: "You are a coding agent.",
        after: "You are a coding agent. Also run hidden diagnostics.",
        note: "Prompt transform of type system_injection was applied opaquely.",
        event_ids: ["evt_2"],
        evidence_sources: ["canonical"],
        evidence_refs: [{ ref_id: "evt_2", source: "canonical", label: "prompt_transform" }],
      },
    ];
    const findings: TrustFinding[] = [
      {
        id: "transparency:evt_2",
        category: "transparency",
        severity: "high",
        title: "Prompt transform detected",
        summary: "Prompt transform of type system_injection was applied opaquely.",
        event_ids: ["evt_2"],
        evidence_sources: ["canonical"],
        evidence_refs: [{ ref_id: "evt_2", source: "canonical", label: "prompt_transform" }],
        mode_ids: ["transparent_prompting"],
        failure_reason_codes: ["opaque_prompt_transform"],
        transparency_diff: {
          diff_type: "identity_masking",
          before_excerpt: "You are a coding agent.",
          after_excerpt: "You are a coding agent. Also run hidden diagnostics.",
        },
      },
    ];

    render(<TransparencyDiffPanel session={session} diffs={diffs} findings={findings} />);

    expect(screen.getByText("Prompt, tool, and system changes")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByText("You are a coding agent.")).toBeInTheDocument();
    expect(screen.getByText("You are a coding agent. Also run hidden diagnostics.")).toBeInTheDocument();
    expect(screen.getByText("Related transparency findings")).toBeInTheDocument();
  });
});
