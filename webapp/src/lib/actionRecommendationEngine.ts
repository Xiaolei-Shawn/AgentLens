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

export function generateSuggestions(_input: RecommendationInput): Suggestion[] {
  return [];
}
