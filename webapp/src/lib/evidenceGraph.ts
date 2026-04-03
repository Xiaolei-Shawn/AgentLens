export type EvidenceGraphState = "loading" | "ready" | "empty" | "degraded" | "error";

export type EvidenceGraphNodeType =
  | "prompt"
  | "file"
  | "endpoint"
  | "memory_store"
  | "background_worker"
  | "output";

export type EvidenceGraphEdgeRelation =
  | "transforms"
  | "reads"
  | "writes"
  | "sends"
  | "spawns"
  | "syncs"
  | "injects"
  | "produces";

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

export interface EvidenceGraphNode {
  id: string;
  type: EvidenceGraphNodeType;
  label: string;
  description?: string;
  event_ids: string[];
  source?: string;
  sources?: string[];
}

export interface EvidenceGraphEdge {
  id: string;
  from: string;
  to: string;
  type: EvidenceGraphEdgeRelation;
  label?: string;
  event_ids: string[];
  metadata?: Record<string, unknown>;
  source?: string;
  sources?: string[];
}

export interface EvidenceGraphDegradedState {
  insufficient_signals: boolean;
  reasons: string[];
}

export interface EvidenceGraphResponse {
  session_id: string;
  summary: EvidenceGraphSummary;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  degraded?: EvidenceGraphDegradedState;
  evidence_index?: Record<string, string[]>;
}

export class EvidenceGraphApiError extends Error {
  status: number;
  payload: Record<string, unknown> | null;

  constructor(message: string, status: number, payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = "EvidenceGraphApiError";
    this.status = status;
    this.payload = payload;
  }
}

const API_BASE =
  (import.meta.env.VITE_AUDIT_API_BASE as string | undefined)?.trim() ?? "";

async function readJsonLike(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return { error: `Non-JSON response (${response.status}).` };
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Evidence graph response missing required field: ${field}`);
  }
  return value;
}

function assertArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Evidence graph response missing required array: ${field}`);
  }
  return value;
}

function normalizeNode(value: unknown, path: string): EvidenceGraphNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Evidence graph response contains an invalid node at ${path}`);
  }
  const item = value as Record<string, unknown>;
  const source = typeof item.source === "string" ? item.source.trim() : "";
  const evidenceSource = typeof item.evidence_source === "string" ? item.evidence_source.trim() : "";
  const sourceList = Array.isArray(item.sources)
    ? item.sources
    : Array.isArray(item.evidence_sources)
      ? item.evidence_sources
      : null;
  return {
    id: assertString(item.id, `${path}.id`),
    type: assertString(item.type, `${path}.type`) as EvidenceGraphNodeType,
    label: assertString(item.label, `${path}.label`),
    description: typeof item.description === "string" ? item.description : undefined,
    event_ids: assertArray(item.event_ids, `${path}.event_ids`).map((eventId, index) => {
      if (typeof eventId !== "string") {
        throw new Error(`Evidence graph response contains a non-string event id at ${path}.event_ids[${index}]`);
      }
      return eventId;
    }),
    source: source || evidenceSource || undefined,
    sources:
      sourceList == null
        ? undefined
        : sourceList
            .map((entry, sourceIndex) => {
              if (typeof entry !== "string") {
                throw new Error(`Evidence graph response contains a non-string source at ${path}.sources[${sourceIndex}]`);
              }
              return entry.trim();
            })
            .filter((entry) => entry.length > 0),
  };
}

function normalizeEdge(value: unknown, path: string): EvidenceGraphEdge {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Evidence graph response contains an invalid edge at ${path}`);
  }
  const item = value as Record<string, unknown>;
  const source = typeof item.source === "string" ? item.source.trim() : "";
  const evidenceSource = typeof item.evidence_source === "string" ? item.evidence_source.trim() : "";
  const sourceList = Array.isArray(item.sources)
    ? item.sources
    : Array.isArray(item.evidence_sources)
      ? item.evidence_sources
      : null;
  return {
    id: assertString(item.id, `${path}.id`),
    from: assertString(item.from, `${path}.from`),
    to: assertString(item.to, `${path}.to`),
    type: assertString(item.type, `${path}.type`) as EvidenceGraphEdgeRelation,
    label: typeof item.label === "string" ? item.label : undefined,
    event_ids: assertArray(item.event_ids, `${path}.event_ids`).map((eventId, index) => {
      if (typeof eventId !== "string") {
        throw new Error(`Evidence graph response contains a non-string event id at ${path}.event_ids[${index}]`);
      }
      return eventId;
    }),
    metadata:
      item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? (item.metadata as Record<string, unknown>)
        : undefined,
    source: source || evidenceSource || undefined,
    sources:
      sourceList == null
        ? undefined
        : sourceList
            .map((entry, sourceIndex) => {
              if (typeof entry !== "string") {
                throw new Error(`Evidence graph response contains a non-string source at ${path}.sources[${sourceIndex}]`);
              }
              return entry.trim();
            })
            .filter((entry) => entry.length > 0),
  };
}

function normalizeDegraded(value: unknown): EvidenceGraphDegradedState | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Evidence graph response contains an invalid degraded block");
  }
  const item = value as Record<string, unknown>;
  const reasons = assertArray(item.reasons, "degraded.reasons").map((reason, index) => {
    if (typeof reason !== "string") {
      throw new Error(`Evidence graph response contains a non-string degraded reason at degraded.reasons[${index}]`);
    }
    return reason;
  });
  return {
    insufficient_signals: Boolean(item.insufficient_signals),
    reasons,
  };
}

function normalizeEvidenceIndex(value: unknown): Record<string, string[]> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Evidence graph response contains an invalid evidence_index block");
  }
  const normalized: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(ids)) {
      throw new Error(`Evidence graph response contains a non-array evidence index entry for ${key}`);
    }
    normalized[key] = ids.map((id, index) => {
      if (typeof id !== "string") {
        throw new Error(`Evidence graph response contains a non-string event id at evidence_index.${key}[${index}]`);
      }
      return id;
    });
  }
  return normalized;
}

function assertEvidenceGraphResponse(payload: Record<string, unknown>): EvidenceGraphResponse {
  return {
    session_id: assertString(payload.session_id, "session_id"),
    summary: (() => {
      const summary = payload.summary;
      if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        throw new Error("Evidence graph response missing required field: summary");
      }
      const item = summary as Record<string, unknown>;
      return {
        node_count: Number(item.node_count ?? 0),
        edge_count: Number(item.edge_count ?? 0),
        prompt_count: Number(item.prompt_count ?? 0),
        file_count: Number(item.file_count ?? 0),
        endpoint_count: Number(item.endpoint_count ?? 0),
        memory_store_count: Number(item.memory_store_count ?? 0),
        background_worker_count: Number(item.background_worker_count ?? 0),
        output_count: Number(item.output_count ?? 0),
        source_event_count: Number(item.source_event_count ?? 0),
        confidence: assertString(item.confidence, "summary.confidence") as EvidenceGraphSummary["confidence"],
      };
    })(),
    nodes: assertArray(payload.nodes, "nodes").map((node, index) => normalizeNode(node, `nodes[${index}]`)),
    edges: assertArray(payload.edges, "edges").map((edge, index) => normalizeEdge(edge, `edges[${index}]`)),
    degraded: normalizeDegraded(payload.degraded),
    evidence_index: normalizeEvidenceIndex(payload.evidence_index),
  };
}

export async function fetchEvidenceGraph(
  sessionId: string,
  options?: { signal?: AbortSignal },
): Promise<EvidenceGraphResponse> {
  const response = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/evidence-graph`,
    {
      method: "GET",
      signal: options?.signal,
    },
  );

  const payload = await readJsonLike(response);
  if (!response.ok) {
    throw new EvidenceGraphApiError(
      typeof payload.error === "string"
        ? payload.error
        : `Evidence graph request failed (${response.status}).`,
      response.status,
      payload,
    );
  }

  return assertEvidenceGraphResponse(payload);
}

export function findEventIndexById(events: { id: string }[], eventId: string): number | null {
  const index = events.findIndex((event) => event.id === eventId);
  return index >= 0 ? index : null;
}
