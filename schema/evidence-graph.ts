export type EvidenceNodeType = "prompt" | "file" | "endpoint" | "memory_store" | "background_worker" | "output";
export type EvidenceEdgeType = "transforms" | "reads" | "writes" | "sends" | "spawns" | "syncs" | "injects" | "produces";

export interface EvidenceNode {
  id: string;
  type: EvidenceNodeType;
  label: string;
  event_ids: string[];
  intent_id?: string;
  metadata?: Record<string, unknown>;
}

export interface EvidenceEdge {
  id: string;
  from: string;
  to: string;
  type: EvidenceEdgeType;
  label?: string;
  event_ids: string[];
  metadata?: Record<string, unknown>;
}

export interface EvidenceGraphSummary {
  node_count: number;
  edge_count: number;
  prompt_count: number;
  file_count: number;
  endpoint_count: number;
  memory_store_count: number;
  background_worker_count: number;
  output_count: number;
  source_event_count: number;
  confidence: "low" | "medium" | "high";
}

export interface EvidenceGraphResult {
  session_id: string;
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  summary: EvidenceGraphSummary;
  evidence_index: Record<string, string[]>;
}
