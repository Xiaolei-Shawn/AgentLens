import type {
  EvidenceGraphEdge,
  EvidenceGraphEdgeRelation,
  EvidenceGraphNode,
  EvidenceGraphNodeType,
  EvidenceGraphResponse,
} from "./evidenceGraph";

export interface PresentedGraphNode {
  node: EvidenceGraphNode;
  primary_label: string;
  secondary_label?: string;
  preview?: string;
  raw_detail?: string;
  why_it_matters: string;
  importance_score: number;
  connected_node_ids: string[];
}

export interface PresentedGraphEdge {
  edge: EvidenceGraphEdge;
  primary_label: string;
  secondary_label: string;
  preview?: string;
  importance_score: number;
}

export interface KeyChain {
  id: string;
  label: string;
  node_ids: string[];
  edge_ids: string[];
  importance_score: number;
}

export interface PresentedEvidenceGraph {
  nodes: PresentedGraphNode[];
  edges: PresentedGraphEdge[];
  key_chains: KeyChain[];
  hidden_node_ids: Set<string>;
}

const HIGH_VALUE_NODE_TYPES: EvidenceGraphNodeType[] = ["prompt", "endpoint", "file", "background_worker"];
const HIGH_VALUE_EDGE_TYPES: EvidenceGraphEdgeRelation[] = ["sends", "reads", "writes", "injects", "spawns"];

function shortText(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 3))}...`;
}

function countNewlines(value: string): number {
  return (value.match(/\n/g) ?? []).length;
}

function looksPatchLike(value: string): boolean {
  return (
    value.includes("*** Begin Patch") ||
    value.includes("*** Add File:") ||
    value.includes("*** Update File:") ||
    value.includes("*** Delete File:") ||
    value.includes("diff --git") ||
    value.includes("@@") ||
    value.includes("+++ ") ||
    value.includes("--- ")
  );
}

function looksCodeLike(value: string): boolean {
  return (
    countNewlines(value) >= 4 &&
    /[{}();:=]/.test(value) &&
    /(function|const|import|export|class|display:|grid-template-columns|padding:)/.test(value)
  );
}

function extractFileName(value: string): string | undefined {
  const patchMatch = value.match(/\*\*\* (?:Add|Update|Delete) File:\s+([^\n]+)/);
  if (patchMatch?.[1]) return patchMatch[1].split("/").pop();
  const pathMatch = value.match(/\/[\w./-]+\.(?:ts|tsx|js|jsx|css|json|md|txt|py|rb|go|rs|java|kt|swift)/);
  if (pathMatch?.[0]) return pathMatch[0].split("/").pop();
  return undefined;
}

function hostFromEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname || value;
  } catch {
    return shortText(value, 48);
  }
}

function pathFromEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.pathname && url.pathname !== "/" ? `${url.pathname}${url.search}` : undefined;
  } catch {
    return undefined;
  }
}

function formatNodeType(type: EvidenceGraphNodeType): string {
  switch (type) {
    case "background_worker":
      return "Background worker";
    case "memory_store":
      return "Memory store";
    default:
      return type.replace(/_/g, " ");
  }
}

function relationLabel(type: EvidenceGraphEdgeRelation): string {
  switch (type) {
    case "sends":
      return "Data sent";
    case "reads":
      return "Reads from";
    case "writes":
      return "Writes to";
    case "injects":
      return "Injects into";
    case "spawns":
      return "Spawns";
    case "produces":
      return "Produces";
    case "syncs":
      return "Syncs with";
    case "transforms":
      return "Transforms";
    default:
      return type;
  }
}

function summarizeNode(node: EvidenceGraphNode): Omit<PresentedGraphNode, "importance_score" | "connected_node_ids"> {
  const raw = [node.label, node.description].filter(Boolean).join("\n\n").trim();
  if (node.type === "file") {
    const fileName = extractFileName(raw) ?? node.label.split("/").pop() ?? node.label;
    return {
      node,
      primary_label: fileName,
      secondary_label: node.label.includes("/") ? shortText(node.label, 56) : "File touched in the session",
      preview: looksPatchLike(raw) ? "Patch or file diff content available." : undefined,
      raw_detail: raw || undefined,
      why_it_matters: "Files show what the agent read or changed.",
    };
  }
  if (node.type === "endpoint") {
    return {
      node,
      primary_label: hostFromEndpoint(node.label),
      secondary_label: pathFromEndpoint(node.label) ?? "Outbound destination",
      preview: node.description ? shortText(node.description, 120) : undefined,
      raw_detail: raw || undefined,
      why_it_matters: "Endpoints show where session data may have left the machine.",
    };
  }
  if (node.type === "prompt") {
    return {
      node,
      primary_label: shortText(node.label, 72),
      secondary_label: "Prompt or instruction context",
      preview: node.description ? shortText(node.description, 120) : undefined,
      raw_detail: raw || undefined,
      why_it_matters: "Prompts explain what kicked off downstream actions.",
    };
  }
  if (node.type === "memory_store") {
    return {
      node,
      primary_label: shortText(node.label, 56),
      secondary_label: `${node.event_ids.length} evidence event${node.event_ids.length === 1 ? "" : "s"}`,
      preview: node.description ? shortText(node.description, 110) : undefined,
      raw_detail: raw || undefined,
      why_it_matters: "Memory stores indicate persistence or recall outside the immediate prompt.",
    };
  }
  if (node.type === "background_worker") {
    return {
      node,
      primary_label: shortText(node.label, 56),
      secondary_label: `${node.event_ids.length} related activity${node.event_ids.length === 1 ? "" : "ies"}`,
      preview: node.description ? shortText(node.description, 110) : undefined,
      raw_detail: raw || undefined,
      why_it_matters: "Background workers can act outside the user's visible flow.",
    };
  }

  if (looksPatchLike(raw)) {
    const fileName = extractFileName(raw);
    return {
      node,
      primary_label: fileName ? `Patch update: ${fileName}` : "Patch-like output",
      secondary_label: "Generated output",
      preview: "Large patch or code excerpt hidden by default.",
      raw_detail: raw,
      why_it_matters: "Outputs show the final artifact produced from the current chain.",
    };
  }

  if (looksCodeLike(raw)) {
    return {
      node,
      primary_label: shortText(node.label, 56),
      secondary_label: "Code-like output excerpt",
      preview: "Large code excerpt hidden by default.",
      raw_detail: raw,
      why_it_matters: "Outputs show the final artifact produced from the current chain.",
    };
  }

  return {
    node,
    primary_label: shortText(node.label, 72),
    secondary_label: formatNodeType(node.type),
    preview: node.description ? shortText(node.description, 120) : undefined,
    raw_detail: raw || undefined,
    why_it_matters: "This node is part of a session evidence chain.",
  };
}

function scoreNode(node: EvidenceGraphNode, degree: number): number {
  const typeWeight = HIGH_VALUE_NODE_TYPES.includes(node.type) ? 4 : 2;
  return typeWeight + Math.min(4, degree) + Math.min(3, node.event_ids.length);
}

function summarizeEdge(
  edge: EvidenceGraphEdge,
  nodeMap: Map<string, PresentedGraphNode>,
  degreeMap: Map<string, number>,
): PresentedGraphEdge {
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  const importance_score =
    (HIGH_VALUE_EDGE_TYPES.includes(edge.type) ? 4 : 2) +
    Math.min(3, edge.event_ids.length) +
    Math.min(2, degreeMap.get(edge.from) ?? 0) +
    Math.min(2, degreeMap.get(edge.to) ?? 0);
  return {
    edge,
    primary_label: relationLabel(edge.type),
    secondary_label: `${from?.primary_label ?? edge.from} → ${to?.primary_label ?? edge.to}`,
    preview: edge.label ? shortText(edge.label, 120) : undefined,
    importance_score,
  };
}

function buildDegreeMap(response: EvidenceGraphResponse): Map<string, number> {
  const degreeMap = new Map<string, number>();
  for (const node of response.nodes) degreeMap.set(node.id, 0);
  for (const edge of response.edges) {
    degreeMap.set(edge.from, (degreeMap.get(edge.from) ?? 0) + 1);
    degreeMap.set(edge.to, (degreeMap.get(edge.to) ?? 0) + 1);
  }
  return degreeMap;
}

function buildAdjacency(edges: EvidenceGraphEdge[]): Map<string, EvidenceGraphEdge[]> {
  const adjacency = new Map<string, EvidenceGraphEdge[]>();
  for (const edge of edges) {
    const fromEdges = adjacency.get(edge.from) ?? [];
    fromEdges.push(edge);
    adjacency.set(edge.from, fromEdges);
  }
  return adjacency;
}

function deriveKeyChains(
  nodes: PresentedGraphNode[],
  edges: EvidenceGraphEdge[],
  degreeMap: Map<string, number>,
): KeyChain[] {
  const nodeMap = new Map(nodes.map((node) => [node.node.id, node]));
  const adjacency = buildAdjacency(edges);
  const seeds = nodes
    .filter((node) => node.node.type === "prompt" || node.node.type === "background_worker")
    .sort((a, b) => b.importance_score - a.importance_score)
    .slice(0, 4);
  const chains: KeyChain[] = [];
  const seen = new Set<string>();

  for (const seed of seeds) {
    const firstEdges = adjacency.get(seed.node.id) ?? [];
    for (const firstEdge of firstEdges) {
      const secondEdges = adjacency.get(firstEdge.to) ?? [];
      const candidates = secondEdges.length > 0 ? secondEdges : [undefined];
      for (const secondEdge of candidates) {
        const nodeIds = [seed.node.id, firstEdge.to];
        const edgeIds = [firstEdge.id];
        if (secondEdge) {
          nodeIds.push(secondEdge.to);
          edgeIds.push(secondEdge.id);
        }
        const key = `${nodeIds.join(">")}::${edgeIds.join(">")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const labels = nodeIds.map((id) => nodeMap.get(id)?.primary_label ?? id);
        const importance_score =
          nodeIds.reduce((sum, id) => sum + (nodeMap.get(id)?.importance_score ?? 0), 0) +
          edgeIds.reduce((sum, id) => sum + (edges.find((edge) => edge.id === id)?.event_ids.length ?? 0), 0) +
          nodeIds.reduce((sum, id) => sum + Math.min(2, degreeMap.get(id) ?? 0), 0);
        chains.push({
          id: `chain_${chains.length + 1}`,
          label: labels.join(" -> "),
          node_ids: nodeIds,
          edge_ids: edgeIds,
          importance_score,
        });
      }
    }
  }

  return chains.sort((a, b) => b.importance_score - a.importance_score).slice(0, 5);
}

export function presentEvidenceGraph(response: EvidenceGraphResponse): PresentedEvidenceGraph {
  const degreeMap = buildDegreeMap(response);
  const connectedNodeIds = new Map<string, Set<string>>();
  for (const edge of response.edges) {
    const from = connectedNodeIds.get(edge.from) ?? new Set<string>();
    from.add(edge.to);
    connectedNodeIds.set(edge.from, from);
    const to = connectedNodeIds.get(edge.to) ?? new Set<string>();
    to.add(edge.from);
    connectedNodeIds.set(edge.to, to);
  }

  const nodes = response.nodes
    .map((node) => {
      const summary = summarizeNode(node);
      return {
        ...summary,
        importance_score: scoreNode(node, degreeMap.get(node.id) ?? 0),
        connected_node_ids: [...(connectedNodeIds.get(node.id) ?? new Set<string>())],
      };
    })
    .sort((a, b) => b.importance_score - a.importance_score);

  const nodeMap = new Map(nodes.map((node) => [node.node.id, node]));
  const edges = response.edges
    .map((edge) => summarizeEdge(edge, nodeMap, degreeMap))
    .sort((a, b) => b.importance_score - a.importance_score);

  const key_chains = deriveKeyChains(nodes, response.edges, degreeMap);
  const hidden_node_ids = new Set<string>();
  if (nodes.length > 8) {
    for (const node of nodes.slice(0)) {
      const degree = degreeMap.get(node.node.id) ?? 0;
      const lowValue = degree <= 1 && node.importance_score <= 5 && node.node.type === "output";
      if (lowValue) hidden_node_ids.add(node.node.id);
    }
  }

  return { nodes, edges, key_chains, hidden_node_ids };
}
