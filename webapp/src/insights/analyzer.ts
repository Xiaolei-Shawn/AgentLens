import type { CanonicalEvent } from "@xiaolei-shawn/schema/event-envelope";
import type {
  ImpactArtifact,
  NormalizedAssumption,
  NormalizedDecision,
  RevisionArtifact,
  ReviewerVerificationSummary,
  RiskArtifact,
  ReviewHotspot,
  SessionNormalized,
  SessionOutcome,
  VerificationArtifact,
} from "../lib/auditPipeline";
import { generateSuggestions, type Suggestion } from "./actionRecommendationEngine";

// Private analyzer boundary.
// Replace these implementations with proprietary heuristics / binary adapters.

export function deriveAssumptions(events: CanonicalEvent[]): NormalizedAssumption[] {
  return events
    .filter((e) => e.kind === "assumption")
    .map((e) => ({
      event_id: e.id,
      intent_id: e.scope?.intent_id,
      statement: typeof e.payload.statement === "string" ? e.payload.statement : "Assumption",
      validated:
        e.payload.validated === true || e.payload.validated === false || e.payload.validated === "unknown"
          ? e.payload.validated
          : "unknown",
      risk:
        e.payload.risk === "low" || e.payload.risk === "medium" || e.payload.risk === "high"
          ? e.payload.risk
          : undefined,
      ts: e.ts,
    }));
}

export function deriveRisks(
  _outcome: SessionOutcome,
  _impacts: ImpactArtifact[],
  _assumptions: NormalizedAssumption[],
  _decisions: NormalizedDecision[],
  _revisions: RevisionArtifact[],
  _verifications: VerificationArtifact[]
): RiskArtifact[] {
  return [];
}

export function deriveHotspots(
  _events: CanonicalEvent[],
  _decisions: NormalizedDecision[],
  _assumptions: NormalizedAssumption[]
): ReviewHotspot[] {
  return [];
}

export function deriveConfidence(
  normalized: SessionNormalized,
  reviewer: ReviewerVerificationSummary
): number {
  let score = reviewer.coverage === "full" ? 0.8 : reviewer.coverage === "partial" ? 0.6 : 0.4;
  if (normalized.verifications.some((v) => v.result === "fail")) score -= 0.1;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export function deriveRecommendedActions(normalized: SessionNormalized): Suggestion[] {
  const riskInputs = normalized.risks.map((r) => ({ id: r.id, level: r.level, reasons: r.reasons }));
  const hotspotInputs = normalized.hotspots.map((h) => ({
    id: h.id,
    file: h.file,
    score: h.score,
    reasons: ["hotspot"],
  }));
  const assumptionInputs = normalized.assumptions.map((a) => ({
    id: a.event_id,
    statement: a.statement,
    validated: a.validated,
    risk: a.risk,
  }));
  return generateSuggestions({
    risks: riskInputs,
    hotspots: hotspotInputs,
    assumptions: assumptionInputs,
  });
}
