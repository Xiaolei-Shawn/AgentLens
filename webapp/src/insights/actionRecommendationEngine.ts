export interface RiskArtifactInput {
  id: string;
  level: "low" | "medium" | "high";
  reasons: string[];
  scope?: {
    files?: string[];
    modules?: string[];
  };
}

export interface HotspotArtifactInput {
  id: string;
  file: string;
  score: number;
  reasons: string[];
}

export interface AssumptionArtifactInput {
  id: string;
  statement: string;
  validated: boolean | "unknown";
  risk?: "low" | "medium" | "high";
  related_files?: string[];
}

export interface SuggestionAction {
  type:
    | "open_file"
    | "open_diff"
    | "replay_file"
    | "prompt_agent"
    | "request_analysis"
    | "generate_tests"
    | "run_verification"
    | "jump_to_event";
  label: string;
  payload?: Record<string, unknown>;
}

export interface Suggestion {
  id: string;
  source_id: string;
  source_type: "risk" | "hotspot" | "assumption";
  category: "mitigation" | "investigation" | "verification";
  title: string;
  description?: string;
  actions: SuggestionAction[];
  priority: "low" | "medium" | "high";
  confidence: number;
}

export interface RecommendationInput {
  risks?: RiskArtifactInput[];
  hotspots?: HotspotArtifactInput[];
  assumptions?: AssumptionArtifactInput[];
}

const MAX_PER_ARTIFACT = 3;
const MAX_TOTAL = 5;

function rankPriority(priority: Suggestion["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function compactText(text: string, maxLen = 220): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function firstFile(scope?: { files?: string[] }): string | undefined {
  return scope?.files?.find((f) => typeof f === "string" && f.trim() !== "");
}

function firstTarget(risk: RiskArtifactInput): string | undefined {
  return firstFile(risk.scope) ?? risk.scope?.modules?.[0];
}

function createSuggestion(
  sourceType: Suggestion["source_type"],
  sourceId: string,
  category: Suggestion["category"],
  title: string,
  actions: SuggestionAction[],
  priority: Suggestion["priority"],
  confidence: number,
  description?: string
): Suggestion {
  return {
    id: `${sourceType}_${sourceId}_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`.slice(0, 120),
    source_id: sourceId,
    source_type: sourceType,
    category,
    title,
    description: description ? compactText(description) : undefined,
    actions,
    priority,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
  };
}

function buildRiskSuggestions(risk: RiskArtifactInput): Suggestion[] {
  const out: Suggestion[] = [];
  const reasons = unique(risk.reasons).slice(0, 3);
  const target = firstTarget(risk);

  if (risk.level === "low") {
    const hasImportantSignal = reasons.some((r) =>
      /(no verification|failed|schema|api|security)/i.test(r)
    );
    if (!hasImportantSignal) return out;
    out.push(
      createSuggestion(
        "risk",
        risk.id,
        "verification",
        "Run targeted verification",
        [
          {
            type: "run_verification",
            label: "Run targeted checks",
            payload: { scope: target ?? "changed area" },
          },
        ],
        "medium",
        0.7,
        `Risk is low but contains sensitive signal: ${reasons.join("; ")}.`
      )
    );
    return out;
  }

  if (risk.level === "high") {
    out.push(
      createSuggestion(
        "risk",
        risk.id,
        "verification",
        "Run full verification before merge",
        [
          {
            type: "run_verification",
            label: "Run full test/lint/typecheck suite",
            payload: { scope: "full" },
          },
        ],
        "high",
        0.92,
        `High risk due to: ${reasons.join("; ")}.`
      )
    );
    if (target) {
      out.push(
        createSuggestion(
          "risk",
          risk.id,
          "mitigation",
          "Review critical diff in impacted area",
          [
            { type: "open_diff", label: `Open diff for ${target}`, payload: { path: target } },
            { type: "jump_to_event", label: "Jump to risk event", payload: { id: risk.id } },
          ],
          "high",
          0.88,
          "Critical areas should be reviewed before acceptance."
        )
      );
    }
    out.push(
      createSuggestion(
        "risk",
        risk.id,
        "mitigation",
        "Ask agent to harden implementation",
        [
          {
            type: "prompt_agent",
            label: "Request hardening pass",
            payload: {
              prompt: `Harden the implementation for risk ${risk.id}. Focus on: ${reasons.join(
                "; "
              )}. Add defensive validation and robust error handling.`,
            },
          },
        ],
        "high",
        0.84,
        "Targeted hardening addresses the highest-risk failure modes."
      )
    );
    return out.slice(0, MAX_PER_ARTIFACT);
  }

  // medium
  if (target) {
    out.push(
      createSuggestion(
        "risk",
        risk.id,
        "investigation",
        "Inspect changed area tied to medium risk",
        [{ type: "open_diff", label: `Open diff for ${target}`, payload: { path: target } }],
        "medium",
        0.78,
        `Medium risk signals: ${reasons.join("; ")}.`
      )
    );
  }
  out.push(
    createSuggestion(
      "risk",
      risk.id,
      "verification",
      "Run targeted verification",
      [
        {
          type: "run_verification",
          label: "Run targeted checks",
          payload: { scope: target ?? "changed modules" },
        },
      ],
      "medium",
      0.8
    )
  );
  out.push(
    createSuggestion(
      "risk",
      risk.id,
      "investigation",
      "Request focused risk analysis",
      [
        {
          type: "request_analysis",
          label: "Ask agent for risk-focused review",
          payload: {
            prompt: `Analyze risk ${risk.id} and identify the top failure paths plus the minimum fixes. Context: ${reasons.join(
              "; "
            )}.`,
          },
        },
      ],
      "medium",
      0.74
    )
  );
  return out.slice(0, 2);
}

function buildHotspotSuggestions(hotspot: HotspotArtifactInput): Suggestion[] {
  const out: Suggestion[] = [];
  out.push(
    createSuggestion(
      "hotspot",
      hotspot.id,
      "investigation",
      "Inspect hotspot file",
      [{ type: "open_file", label: `Open ${hotspot.file}`, payload: { path: hotspot.file } }],
      hotspot.score >= 10 ? "high" : "medium",
      0.86,
      `Hotspot score ${hotspot.score}. Reasons: ${unique(hotspot.reasons).slice(0, 2).join("; ")}.`
    )
  );
  out.push(
    createSuggestion(
      "hotspot",
      hotspot.id,
      "investigation",
      "Replay file evolution",
      [{ type: "replay_file", label: `Replay ${hotspot.file}`, payload: { path: hotspot.file } }],
      "medium",
      0.82
    )
  );
  out.push(
    createSuggestion(
      "hotspot",
      hotspot.id,
      "investigation",
      "Ask agent to explain hotspot changes",
      [
        {
          type: "request_analysis",
          label: "Request change explanation",
          payload: {
            prompt: `Explain the highest-risk edits in ${hotspot.file}, why they were needed, and what regression checks are still missing.`,
          },
        },
      ],
      "medium",
      0.74
    )
  );
  return out.slice(0, 2);
}

function buildAssumptionSuggestions(assumption: AssumptionArtifactInput): Suggestion[] {
  const out: Suggestion[] = [];
  const needsValidation = assumption.validated === false || assumption.validated === "unknown";
  if (!needsValidation) return out;

  const priority: Suggestion["priority"] = assumption.risk === "high" ? "high" : "medium";
  out.push(
    createSuggestion(
      "assumption",
      assumption.id,
      "verification",
      "Validate unresolved assumption",
      [
        {
          type: "request_analysis",
          label: "Ask agent to validate assumption",
          payload: {
            prompt: `Validate assumption: "${assumption.statement}". Provide evidence, edge cases, and whether this should be converted into a concrete check.`,
          },
        },
      ],
      priority,
      assumption.risk === "high" ? 0.87 : 0.78
    )
  );

  const target = assumption.related_files?.[0];
  out.push(
    createSuggestion(
      "assumption",
      assumption.id,
      "verification",
      target ? "Generate tests for assumption-affected file" : "Generate tests for assumption path",
      [
        {
          type: "generate_tests",
          label: target ? `Generate tests for ${target}` : "Generate tests for assumption scenario",
          payload: { target: target ?? assumption.statement },
        },
      ],
      priority,
      target ? 0.8 : 0.72
    )
  );

  if (assumption.risk === "high") {
    out.push(
      createSuggestion(
        "assumption",
        assumption.id,
        "mitigation",
        "Add defensive fallback checks",
        [
          {
            type: "prompt_agent",
            label: "Add defensive checks",
            payload: {
              prompt: `Add defensive checks and fallback handling for assumption "${assumption.statement}"${
                target ? ` in ${target}` : ""
              }.`,
            },
          },
        ],
        "high",
        0.76
      )
    );
  }

  return out.slice(0, 2);
}

function dedupeSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of suggestions) {
    const actionKey = s.actions
      .map((a) => `${a.type}:${JSON.stringify(a.payload ?? {})}`)
      .join("|");
    const dedupeKey = `${s.source_type}|${s.source_id}|${s.category}|${actionKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(s);
  }
  return out;
}

function applyDiversityAndGlobalLimit(suggestions: Suggestion[]): Suggestion[] {
  const sorted = [...suggestions].sort((a, b) => {
    const p = rankPriority(b.priority) - rankPriority(a.priority);
    if (p !== 0) return p;
    return b.confidence - a.confidence;
  });
  const selected: Suggestion[] = [];
  const categoryCount = new Map<Suggestion["category"], number>();
  for (const s of sorted) {
    if (selected.length >= MAX_TOTAL) break;
    const count = categoryCount.get(s.category) ?? 0;
    // Avoid a noisy list of one repeated pattern.
    if (count >= 3) continue;
    selected.push(s);
    categoryCount.set(s.category, count + 1);
  }
  return selected;
}

export function generateSuggestions(input: RecommendationInput): Suggestion[] {
  const risks = input.risks ?? [];
  const hotspots = input.hotspots ?? [];
  const assumptions = input.assumptions ?? [];
  if (risks.length === 0 && hotspots.length === 0 && assumptions.length === 0) return [];

  const perArtifactCounter = new Map<string, number>();
  const all: Suggestion[] = [];
  const pushWithCap = (sourceKey: string, next: Suggestion[]) => {
    let count = perArtifactCounter.get(sourceKey) ?? 0;
    for (const s of next) {
      if (count >= MAX_PER_ARTIFACT) break;
      all.push(s);
      count += 1;
    }
    perArtifactCounter.set(sourceKey, count);
  };

  for (const risk of risks) {
    pushWithCap(`risk:${risk.id}`, buildRiskSuggestions(risk));
  }
  for (const hotspot of hotspots) {
    pushWithCap(`hotspot:${hotspot.id}`, buildHotspotSuggestions(hotspot));
  }
  for (const assumption of assumptions) {
    pushWithCap(`assumption:${assumption.id}`, buildAssumptionSuggestions(assumption));
  }

  const deduped = dedupeSuggestions(all);
  return applyDiversityAndGlobalLimit(deduped);
}
