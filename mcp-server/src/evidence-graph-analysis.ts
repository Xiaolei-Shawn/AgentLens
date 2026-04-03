import type { CanonicalEvent } from "./event-envelope.js";
import type {
  EvidenceEdge,
  EvidenceEdgeType,
  EvidenceGraphResult,
  EvidenceGraphSummary,
  EvidenceNode,
  EvidenceNodeType,
} from "../../schema/dist/evidence-graph.js";

type EvidenceIndex = Map<string, Set<string>>;

interface WorkingNode extends EvidenceNode {}

interface WorkingEdge extends EvidenceEdge {}

interface PromptState {
  sessionPromptNodeId: string;
  currentPromptNodeId: string;
  promptByIntent: Map<string, string>;
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function payload(event: CanonicalEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>;
}

function intentIdFor(event: CanonicalEvent): string | undefined {
  const p = payload(event);
  return toString(event.scope?.intent_id) ?? toString(p.intent_id);
}

function addEvidence(index: EvidenceIndex, eventId: string, label: string): void {
  const current = index.get(eventId);
  if (!current) {
    index.set(eventId, new Set([label]));
    return;
  }
  current.add(label);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeMetadata(existing?: Record<string, unknown>, incoming?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!existing && !incoming) return undefined;
  return { ...(existing ?? {}), ...(incoming ?? {}) };
}

function mergeNode(existing: WorkingNode, incoming: EvidenceNode): WorkingNode {
  return {
    ...existing,
    label: existing.label || incoming.label,
    event_ids: dedupe([...existing.event_ids, ...incoming.event_ids]),
    intent_id: existing.intent_id ?? incoming.intent_id,
    metadata: mergeMetadata(existing.metadata, incoming.metadata),
  };
}

function mergeEdge(existing: WorkingEdge, incoming: EvidenceEdge): WorkingEdge {
  return {
    ...existing,
    label: existing.label || incoming.label,
    event_ids: dedupe([...existing.event_ids, ...incoming.event_ids]),
    metadata: mergeMetadata(existing.metadata, incoming.metadata),
  };
}

function upsertNode(nodes: Map<string, WorkingNode>, index: EvidenceIndex, node: EvidenceNode): void {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, {
      ...node,
      event_ids: dedupe(node.event_ids),
    });
  } else {
    nodes.set(node.id, mergeNode(existing, node));
  }
  for (const eventId of node.event_ids) {
    addEvidence(index, eventId, `node:${node.type}:${node.id}`);
  }
}

function upsertEdge(edges: Map<string, WorkingEdge>, index: EvidenceIndex, edge: EvidenceEdge): void {
  const existing = edges.get(edge.id);
  if (!existing) {
    edges.set(edge.id, {
      ...edge,
      event_ids: dedupe(edge.event_ids),
    });
  } else {
    edges.set(edge.id, mergeEdge(existing, edge));
  }
  for (const eventId of edge.event_ids) {
    addEvidence(index, eventId, `edge:${edge.type}:${edge.id}`);
  }
}

function makePromptNodeId(sessionId: string, suffix: string): string {
  return `prompt:${sessionId}:${suffix}`;
}

function makeEntityNodeId(type: EvidenceNodeType, value: string, extra?: string): string {
  return extra ? `${type}:${value}:${extra}` : `${type}:${value}`;
}

function getSourcePromptNodeId(state: PromptState): string {
  return state.currentPromptNodeId || state.sessionPromptNodeId;
}

function inferFileAction(event: CanonicalEvent): EvidenceEdgeType {
  const p = payload(event);
  const action = toString(p.action)?.toLowerCase() ?? "";
  if (["read", "open", "view", "inspect", "grep", "ls", "stat"].some((item) => action.includes(item))) {
    return "reads";
  }
  if (["sync"].some((item) => action.includes(item))) {
    return "syncs";
  }
  return "writes";
}

function inferMemoryAction(event: CanonicalEvent): EvidenceEdgeType {
  const p = payload(event);
  const op = toString(p.op)?.toLowerCase() ?? "";
  if (op === "read") return "reads";
  if (op === "write") return "writes";
  if (op === "inject") return "injects";
  return "syncs";
}

function inferWorkerAction(event: CanonicalEvent): EvidenceEdgeType {
  const p = payload(event);
  const action = toString(p.action)?.toLowerCase() ?? "";
  if (action === "read") return "reads";
  if (action === "write") return "writes";
  return "spawns";
}

function looksLikeFilePath(value: string): boolean {
  return /[\\/]/.test(value) || /\.[a-z0-9]+$/i.test(value);
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^skill:\/\//i.test(value) || value.includes("://");
}

function normalizeEntityLabel(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function createPromptNode(
  event: CanonicalEvent,
  nodeId: string,
  label: string,
  intentId: string | undefined,
  metadata?: Record<string, unknown>,
): EvidenceNode {
  return {
    id: nodeId,
    type: "prompt",
    label,
    intent_id: intentId,
    event_ids: [event.id],
    metadata,
  };
}

function createEntityNode(
  type: EvidenceNodeType,
  id: string,
  label: string,
  event: CanonicalEvent,
  metadata?: Record<string, unknown>,
): EvidenceNode {
  return {
    id,
    type,
    label,
    event_ids: [event.id],
    metadata,
  };
}

function createEdge(
  from: string,
  to: string,
  type: EvidenceEdgeType,
  event: CanonicalEvent,
  label?: string,
  metadata?: Record<string, unknown>,
): EvidenceEdge {
  return {
    id: `${from}:${type}:${to}`,
    from,
    to,
    type,
    label,
    event_ids: [event.id],
    metadata,
  };
}

function ensureSessionPromptNode(
  event: CanonicalEvent,
  nodes: Map<string, WorkingNode>,
  edges: Map<string, WorkingEdge>,
  index: EvidenceIndex,
  state: PromptState,
): string {
  if (state.sessionPromptNodeId) return state.sessionPromptNodeId;

  const p = payload(event);
  const label = toString(p.user_prompt) ?? toString(p.goal) ?? "Session prompt";
  const nodeId = makePromptNodeId(event.session_id, "session");
  upsertNode(
    nodes,
    index,
    createPromptNode(event, nodeId, normalizeEntityLabel(label), undefined, {
      goal: toString(p.goal),
      user_prompt: toString(p.user_prompt),
    }),
  );
  state.sessionPromptNodeId = nodeId;
  state.currentPromptNodeId = nodeId;
  return nodeId;
}

function resolvePromptNodeId(
  event: CanonicalEvent,
  nodes: Map<string, WorkingNode>,
  edges: Map<string, WorkingEdge>,
  index: EvidenceIndex,
  state: PromptState,
): string {
  const intentId = intentIdFor(event);
  if (intentId && state.promptByIntent.has(intentId)) {
    return state.promptByIntent.get(intentId) ?? ensureSessionPromptNode(event, nodes, edges, index, state);
  }
  if (state.currentPromptNodeId) return state.currentPromptNodeId;
  return ensureSessionPromptNode(event, nodes, edges, index, state);
}

function recordPromptTransition(
  event: CanonicalEvent,
  nodes: Map<string, WorkingNode>,
  edges: Map<string, WorkingEdge>,
  index: EvidenceIndex,
  state: PromptState,
  nextNode: EvidenceNode,
  edgeLabel: string,
): void {
  const from = getSourcePromptNodeId(state);
  upsertNode(nodes, index, nextNode);
  upsertEdge(edges, index, createEdge(from, nextNode.id, "transforms", event, edgeLabel, payload(event)));
  state.currentPromptNodeId = nextNode.id;
  const intentId = intentIdFor(event);
  if (intentId) state.promptByIntent.set(intentId, nextNode.id);
}

function classifyToolCallTarget(event: CanonicalEvent): {
  type: EvidenceNodeType;
  id: string;
  label: string;
  edgeType: EvidenceEdgeType;
  metadata?: Record<string, unknown>;
} | null {
  const p = payload(event);
  const details = p.details && typeof p.details === "object" ? (p.details as Record<string, unknown>) : {};
  const category = toString(p.category)?.toLowerCase() ?? "";
  const action = toString(p.action)?.toLowerCase() ?? "";
  const target =
    toString(p.target) ??
    toString(details.target) ??
    toString(details.url) ??
    toString(details.path) ??
    toString(details.endpoint) ??
    toString(details.worker_type) ??
    "";

  if (target && (looksLikeFilePath(target) || category === "file" || action.includes("file"))) {
    return {
      type: "file",
      id: makeEntityNodeId("file", target),
      label: normalizeEntityLabel(target),
      edgeType: inferFileAction(event),
      metadata: { action, category, target },
    };
  }

  if (target && (looksLikeUrl(target) || category === "search" || action.includes("search") || action.includes("fetch"))) {
    return {
      type: "endpoint",
      id: makeEntityNodeId("endpoint", target),
      label: normalizeEntityLabel(target),
      edgeType: "sends",
      metadata: { action, category, target },
    };
  }

  if (action.includes("delegate") || action.includes("spawn") || action.includes("run") || action.includes("execute") || category === "execution") {
    const worker = target || action || "worker";
    return {
      type: "background_worker",
      id: makeEntityNodeId("background_worker", worker),
      label: normalizeEntityLabel(worker),
      edgeType: "spawns",
      metadata: { action, category, target },
    };
  }

  if (action.includes("memory") || category === "memory" || target.includes("memory")) {
    const store = target || toString(details.store) || "memory";
    return {
      type: "memory_store",
      id: makeEntityNodeId("memory_store", store),
      label: normalizeEntityLabel(store),
      edgeType: "syncs",
      metadata: { action, category, target },
    };
  }

  if (action.includes("test") || action.includes("build") || action.includes("report") || action.includes("pr") || action.includes("migration")) {
    const output = target || action || "tool_output";
    return {
      type: "output",
      id: makeEntityNodeId("output", output, event.id),
      label: normalizeEntityLabel(output),
      edgeType: "produces",
      metadata: { action, category, target },
    };
  }

  return null;
}

function getOutputNodeForEvent(event: CanonicalEvent): {
  node: EvidenceNode;
  edgeType: EvidenceEdgeType;
  label: string;
} | null {
  const p = payload(event);
  if (event.kind === "artifact_created") {
    const artifactType = toString(p.artifact_type) ?? "artifact";
    const title = toString(p.title) ?? artifactType;
    return {
      node: createEntityNode(
        "output",
        makeEntityNodeId("output", artifactType, event.id),
        normalizeEntityLabel(title),
        event,
        { artifact_type: artifactType, title, path: toString(p.path), url: toString(p.url) },
      ),
      edgeType: "produces",
      label: artifactType,
    };
  }

  if (event.kind === "verification") {
    const type = toString(p.type) ?? "verification";
    const result = toString(p.result) ?? "unknown";
    return {
      node: createEntityNode(
        "output",
        makeEntityNodeId("output", `${type}:${result}`, event.id),
        `${type}: ${result}`,
        event,
        { type, result, details: toString(p.details) },
      ),
      edgeType: "produces",
      label: type,
    };
  }

  if (event.kind === "verification_run") {
    const runType = toString(p.run_type) ?? "verification";
    const status = toString(p.status) ?? "unknown";
    return {
      node: createEntityNode(
        "output",
        makeEntityNodeId("output", `${runType}:${status}`, event.id),
        `${runType}: ${status}`,
        event,
        { run_type: runType, status, command: toString(p.command), scope: toString(p.scope) },
      ),
      edgeType: "produces",
      label: runType,
    };
  }

  if (event.kind === "diff_summary") {
    const file = toString(p.file) ?? "diff";
    return {
      node: createEntityNode(
        "output",
        makeEntityNodeId("output", `diff:${file}`, event.id),
        file,
        event,
        {
          file,
          lines_added: p.lines_added,
          lines_removed: p.lines_removed,
          public_api_changed: p.public_api_changed,
          dependency_changed: p.dependency_changed,
          schema_changed: p.schema_changed,
        },
      ),
      edgeType: "produces",
      label: file,
    };
  }

  if (event.kind === "session_end") {
    const outcome = toString(p.outcome) ?? "unknown";
    return {
      node: createEntityNode(
        "output",
        makeEntityNodeId("output", `session_end:${outcome}`, event.id),
        `session end: ${outcome}`,
        event,
        { outcome, summary: toString(p.summary) },
      ),
      edgeType: "produces",
      label: "session end",
    };
  }

  return null;
}

function finalizeEvidenceIndex(index: EvidenceIndex): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [eventId, labels] of index.entries()) {
    out[eventId] = [...labels].sort();
  }
  return out;
}

function summarizeGraph(
  nodes: EvidenceNode[],
  edges: EvidenceEdge[],
  sourceEventCount: number,
): EvidenceGraphSummary {
  const countByType = (type: EvidenceNodeType) => nodes.filter((node) => node.type === type).length;
  const confidence =
    nodes.length === 0
      ? "low"
      : edges.length >= 4 && countByType("output") > 0
        ? "high"
        : edges.length >= 2
          ? "medium"
          : "low";

  return {
    node_count: nodes.length,
    edge_count: edges.length,
    prompt_count: countByType("prompt"),
    file_count: countByType("file"),
    endpoint_count: countByType("endpoint"),
    memory_store_count: countByType("memory_store"),
    background_worker_count: countByType("background_worker"),
    output_count: countByType("output"),
    source_event_count: sourceEventCount,
    confidence,
  };
}

export function analyzeEvidenceGraph(eventsRaw: CanonicalEvent[]): EvidenceGraphResult {
  const events = [...eventsRaw].sort((a, b) => (a.seq === b.seq ? a.ts.localeCompare(b.ts) : a.seq - b.seq));
  const nodes = new Map<string, WorkingNode>();
  const edges = new Map<string, WorkingEdge>();
  const evidenceIndex: EvidenceIndex = new Map();
  const state: PromptState = {
    sessionPromptNodeId: "",
    currentPromptNodeId: "",
    promptByIntent: new Map<string, string>(),
  };

  for (const event of events) {
    const intentId = intentIdFor(event);

    if (event.kind === "session_start") {
      const p = payload(event);
      const nodeId = makePromptNodeId(event.session_id, "session");
      upsertNode(
        nodes,
        evidenceIndex,
        createPromptNode(
          event,
          nodeId,
          normalizeEntityLabel(toString(p.user_prompt) ?? toString(p.goal) ?? "Session prompt"),
          undefined,
          { goal: toString(p.goal), user_prompt: toString(p.user_prompt) },
        ),
      );
      state.sessionPromptNodeId = nodeId;
      state.currentPromptNodeId = nodeId;
      continue;
    }

    if (event.kind === "intent") {
      const p = payload(event);
      const nodeId = makePromptNodeId(event.session_id, `intent:${intentId ?? event.id}`);
      const label = normalizeEntityLabel(toString(p.title) ?? intentId ?? "Intent");
      const promptNode = createPromptNode(event, nodeId, label, intentId, {
        intent_title: toString(p.title),
        intent_id: intentId,
      });
      upsertNode(nodes, evidenceIndex, promptNode);
      const from = getSourcePromptNodeId(state);
      upsertEdge(edges, evidenceIndex, createEdge(from, nodeId, "transforms", event, "intent", { intent_id: intentId }));
      state.currentPromptNodeId = nodeId;
      if (intentId) {
        state.promptByIntent.set(intentId, nodeId);
      }
      continue;
    }

    if (event.kind === "prompt_transform") {
      const p = payload(event);
      const transformType = toString(p.transform_type) ?? "prompt_transform";
      const nodeId = makePromptNodeId(event.session_id, `transform:${event.id}`);
      const label = normalizeEntityLabel(transformType.replace(/_/g, " "));
      recordPromptTransition(
        event,
        nodes,
        edges,
        evidenceIndex,
        state,
        createPromptNode(event, nodeId, label, intentId, {
          transform_type: transformType,
          opaque: toBoolean(p.opaque),
          source: toString(p.source),
          before_hash: toString(p.before_hash),
          after_hash: toString(p.after_hash),
        }),
        transformType,
      );
      continue;
    }

    const toolDerived = event.kind === "tool_call" ? classifyToolCallTarget(event) : null;
    if (toolDerived) {
      const sourcePromptId = resolvePromptNodeId(event, nodes, edges, evidenceIndex, state);
      upsertNode(nodes, evidenceIndex, createEntityNode(toolDerived.type, toolDerived.id, toolDerived.label, event, toolDerived.metadata));
      upsertEdge(
        edges,
        evidenceIndex,
        createEdge(sourcePromptId, toolDerived.id, toolDerived.edgeType, event, toolDerived.label, toolDerived.metadata),
      );
      continue;
    }

    if (event.kind === "file_op") {
      const p = payload(event);
      const file = toString(p.target) ?? toString(event.scope?.file) ?? "unknown file";
      const nodeId = makeEntityNodeId("file", file);
      const sourcePromptId = resolvePromptNodeId(event, nodes, edges, evidenceIndex, state);
      upsertNode(
        nodes,
        evidenceIndex,
        createEntityNode("file", nodeId, normalizeEntityLabel(file), event, {
          action: toString(p.action),
          category: toString(p.category),
          file,
        }),
      );
      upsertEdge(edges, evidenceIndex, createEdge(sourcePromptId, nodeId, inferFileAction(event), event, toString(p.action), { file }));
      continue;
    }

    if (event.kind === "network_egress") {
      const p = payload(event);
      const endpoint = toString(p.endpoint) ?? toString(p.url) ?? toString(p.target) ?? "unknown endpoint";
      const nodeId = makeEntityNodeId("endpoint", endpoint);
      const sourcePromptId = resolvePromptNodeId(event, nodes, edges, evidenceIndex, state);
      upsertNode(
        nodes,
        evidenceIndex,
        createEntityNode("endpoint", nodeId, normalizeEntityLabel(endpoint), event, {
          endpoint,
          endpoint_type: toString(p.endpoint_type),
          method: toString(p.method),
          transport: toString(p.transport),
          content_visibility: toString(p.content_visibility),
          user_visible: toBoolean(p.user_visible),
          blocked: toBoolean(p.blocked),
          bytes_out: p.bytes_out,
          bytes_in: p.bytes_in,
        }),
      );
      upsertEdge(
        edges,
        evidenceIndex,
        createEdge(sourcePromptId, nodeId, "sends", event, toString(p.endpoint_type) ?? endpoint, {
          endpoint,
          endpoint_type: toString(p.endpoint_type),
        }),
      );
      continue;
    }

    if (event.kind === "memory_op") {
      const p = payload(event);
      const store = toString(p.store) ?? "memory";
      const path = toString(p.path) ?? store;
      const nodeId = makeEntityNodeId("memory_store", `${store}:${path}`);
      const sourcePromptId = resolvePromptNodeId(event, nodes, edges, evidenceIndex, state);
      upsertNode(
        nodes,
        evidenceIndex,
        createEntityNode("memory_store", nodeId, normalizeEntityLabel(path), event, {
          store,
          path,
          op: toString(p.op),
          data_classes: p.data_classes,
          remote_sync: toBoolean(p.remote_sync),
        }),
      );
      upsertEdge(
        edges,
        evidenceIndex,
        createEdge(sourcePromptId, nodeId, inferMemoryAction(event), event, toString(p.op), {
          store,
          path,
          op: toString(p.op),
        }),
      );
      continue;
    }

    if (event.kind === "background_activity") {
      const p = payload(event);
      const worker = toString(p.worker_type) ?? "worker";
      const nodeId = makeEntityNodeId("background_worker", worker);
      const sourcePromptId = resolvePromptNodeId(event, nodes, edges, evidenceIndex, state);
      upsertNode(
        nodes,
        evidenceIndex,
        createEntityNode("background_worker", nodeId, normalizeEntityLabel(worker), event, {
          worker_type: worker,
          action: toString(p.action),
          visibility: toString(p.visibility),
          reads_session_history: toBoolean(p.reads_session_history),
        }),
      );
      upsertEdge(
        edges,
        evidenceIndex,
        createEdge(sourcePromptId, nodeId, inferWorkerAction(event), event, toString(p.action), {
          worker_type: worker,
          action: toString(p.action),
        }),
      );
      continue;
    }

    if (event.kind === "remote_code_load") {
      const p = payload(event);
      const source = toString(p.source) ?? "remote_code_loader";
      const uri = toString(p.uri) ?? source;
      const nodeId = makeEntityNodeId("endpoint", uri);
      const sourcePromptId = resolvePromptNodeId(event, nodes, edges, evidenceIndex, state);
      upsertNode(
        nodes,
        evidenceIndex,
        createEntityNode("endpoint", nodeId, normalizeEntityLabel(uri), event, {
          source,
          uri,
          bytes: p.bytes,
        }),
      );
      upsertEdge(edges, evidenceIndex, createEdge(sourcePromptId, nodeId, "sends", event, source, { source, uri }));
      continue;
    }

    const output = getOutputNodeForEvent(event);
    if (output) {
      const sourcePromptId = resolvePromptNodeId(event, nodes, edges, evidenceIndex, state);
      upsertNode(nodes, evidenceIndex, output.node);
      upsertEdge(edges, evidenceIndex, createEdge(sourcePromptId, output.node.id, output.edgeType, event, output.label, payload(event)));
    }
  }

  const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edgeList = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    session_id: events[0]?.session_id ?? "unknown",
    nodes: nodeList,
    edges: edgeList,
    summary: summarizeGraph(nodeList, edgeList, events.length),
    evidence_index: finalizeEvidenceIndex(evidenceIndex),
  };
}
