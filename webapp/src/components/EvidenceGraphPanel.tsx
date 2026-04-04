import { useEffect, useMemo, useState } from "react";
import type { Session } from "../types/session";
import { EvidenceSourcePill } from "./EvidenceSourcePill";
import {
  EvidenceGraphApiError,
  fetchEvidenceGraph,
  findEventIndexById,
  type EvidenceGraphResponse,
  type EvidenceGraphState,
} from "../lib/evidenceGraph";
import {
  presentEvidenceGraph,
  type KeyChain,
  type PresentedGraphEdge,
  type PresentedGraphNode,
} from "../lib/evidenceGraphPresentation";

interface EvidenceGraphPanelProps {
  session: Session;
  onSeek?: (index: number) => void;
  refreshKey?: number;
}

function StatePill({ state }: { state: Exclude<EvidenceGraphState, "loading"> }) {
  const label =
    state === "ready" ? "Live graph" : state === "degraded" ? "Degraded" : state === "empty" ? "Empty" : "Error";
  const tone = state === "ready" ? "live" : state === "error" ? "danger" : "neutral";
  return <span className={`trust-review__state-pill trust-review__state-pill--${tone}`}>{label}</span>;
}

function GraphLoading() {
  return (
    <div className="trust-review__graph-loading" aria-busy="true" aria-live="polite">
      <div className="trust-review__skeleton trust-review__skeleton--graph-header" />
      <div className="trust-review__skeleton-grid trust-review__skeleton-grid--graph">
        <div className="trust-review__skeleton trust-review__skeleton--graph-card" />
        <div className="trust-review__skeleton trust-review__skeleton--graph-card" />
      </div>
      <div className="trust-review__skeleton trust-review__skeleton--graph-panel" />
    </div>
  );
}

function GraphEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="trust-review__graph-empty">
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

function EventChips({
  session,
  eventIds,
  onSeek,
}: {
  session: Session;
  eventIds: string[];
  onSeek?: (index: number) => void;
}) {
  const uniqueIds = [...new Set(eventIds)];
  if (uniqueIds.length === 0) return <span className="trust-review__muted">No evidence links</span>;

  return (
    <div className="trust-review__chips">
      {uniqueIds.map((eventId) => {
        const index = findEventIndexById(session.events, eventId);
        return (
          <button
            key={eventId}
            type="button"
            className="trust-review__chip"
            onClick={() => {
              if (index != null) onSeek?.(index);
            }}
            disabled={index == null}
            title={index != null ? `Jump to event #${index + 1}` : "Event not found"}
          >
            {index != null ? `#${index + 1}` : eventId}
          </button>
        );
      })}
    </div>
  );
}

function GraphNodeCard({
  node,
  selected,
  connected,
  dimmed,
  onSelect,
}: {
  node: PresentedGraphNode;
  selected: boolean;
  connected: boolean;
  dimmed: boolean;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`trust-review__graph-card ${selected ? "is-selected" : ""} ${connected ? "is-connected" : ""} ${dimmed ? "is-dimmed" : ""}`}
      onClick={() => onSelect(node.node.id)}
    >
      <div className="trust-review__graph-card-head">
        <div>
          <p className="trust-review__graph-type">{node.node.type}</p>
          <h4>{node.primary_label}</h4>
          <EvidenceSourcePill source={node.node.source} sources={node.node.sources} />
        </div>
        <span className="trust-review__graph-count">{node.node.event_ids.length}</span>
      </div>
      {node.secondary_label ? <p className="trust-review__graph-meta">{node.secondary_label}</p> : null}
      <p className="trust-review__graph-desc">{node.preview ?? node.why_it_matters}</p>
    </button>
  );
}

function GraphEdgeRow({
  edge,
  selected,
  connected,
  dimmed,
  onSelect,
}: {
  edge: PresentedGraphEdge;
  selected: boolean;
  connected: boolean;
  dimmed: boolean;
  onSelect: (edgeId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`trust-review__graph-edge ${selected ? "is-selected" : ""} ${connected ? "is-connected" : ""} ${dimmed ? "is-dimmed" : ""}`}
      onClick={() => onSelect(edge.edge.id)}
    >
      <div className="trust-review__graph-edge-top">
        <strong>{edge.primary_label}</strong>
        <span>{edge.edge.event_ids.length} event(s)</span>
      </div>
      <div className="trust-review__graph-edge-flow">
        <span>{edge.secondary_label}</span>
      </div>
      {edge.preview ? <p className="trust-review__graph-desc">{edge.preview}</p> : null}
      <EvidenceSourcePill source={edge.edge.source} sources={edge.edge.sources} />
    </button>
  );
}

function KeyChainList({
  chains,
  selectedChainId,
  onSelect,
}: {
  chains: KeyChain[];
  selectedChainId: string | null;
  onSelect: (chainId: string | null) => void;
}) {
  if (chains.length === 0) return null;
  return (
    <section className="trust-review__graph-focus">
      <div className="trust-review__graph-column-head">
        <h4>Key chains</h4>
        <button type="button" className="trust-review__inline-button" onClick={() => onSelect(null)}>
          Clear focus
        </button>
      </div>
      <div className="trust-review__graph-focus-list">
        {chains.map((chain) => (
          <button
            key={chain.id}
            type="button"
            className={`trust-review__graph-focus-card ${selectedChainId === chain.id ? "is-selected" : ""}`}
            onClick={() => onSelect(chain.id)}
          >
            <strong>{chain.label}</strong>
            <span>{chain.node_ids.length} nodes · {chain.edge_ids.length} edges</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RawExcerpt({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <details className="trust-review__disclosure">
      <summary>View excerpt</summary>
      <div className="trust-review__disclosure-body">
        <pre className="trust-review__code-block">{value}</pre>
      </div>
    </details>
  );
}

export function EvidenceGraphPanel({ session, onSeek, refreshKey }: EvidenceGraphPanelProps) {
  const [phase, setPhase] = useState<EvidenceGraphState>("loading");
  const [response, setResponse] = useState<EvidenceGraphResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("Evidence graph could not be loaded.");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [showAllNodes, setShowAllNodes] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEvidenceGraph() {
      setPhase("loading");
      setResponse(null);
      setErrorMessage("Evidence graph could not be loaded.");

      try {
        const next = await fetchEvidenceGraph(session.id, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResponse(next);

        const nodeCount = next.nodes.length;
        const edgeCount = next.edges.length;
        if (next.degraded?.insufficient_signals) {
          setPhase("degraded");
          return;
        }
        setPhase(nodeCount > 0 || edgeCount > 0 ? "ready" : "empty");
      } catch (error) {
        if (controller.signal.aborted) return;

        setResponse(null);
        if (error instanceof DOMException && error.name === "AbortError") return;

        if (error instanceof EvidenceGraphApiError && error.status === 404) {
          setPhase("empty");
          setErrorMessage("The backend has not exposed an evidence graph for this session yet.");
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Evidence graph could not be loaded.");
        setPhase("error");
      }
    }

    void loadEvidenceGraph();
    return () => controller.abort();
  }, [session.id, refreshKey]);

  const presented = useMemo(() => (response ? presentEvidenceGraph(response) : null), [response]);
  const presentedNodeMap = useMemo(
    () => new Map((presented?.nodes ?? []).map((node) => [node.node.id, node])),
    [presented],
  );
  const presentedEdgeMap = useMemo(
    () => new Map((presented?.edges ?? []).map((edge) => [edge.edge.id, edge])),
    [presented],
  );

  useEffect(() => {
    if (!response || !presented) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedChainId(null);
      return;
    }
    setSelectedNodeId((current) => current ?? presented.nodes[0]?.node.id ?? null);
    setSelectedEdgeId((current) => current ?? presented.edges[0]?.edge.id ?? null);
  }, [presented, response]);

  const selectedNode = selectedNodeId ? presentedNodeMap.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? presentedEdgeMap.get(selectedEdgeId) ?? null : null;
  const selectedChain = presented?.key_chains.find((chain) => chain.id === selectedChainId) ?? null;

  const connectedNodeIds = useMemo(() => {
    if (!response) return new Set<string>();
    if (selectedChain) return new Set(selectedChain.node_ids);
    if (!selectedNodeId) return new Set<string>();
    const connected = new Set<string>([selectedNodeId]);
    for (const edge of response.edges) {
      if (edge.from === selectedNodeId) connected.add(edge.to);
      if (edge.to === selectedNodeId) connected.add(edge.from);
    }
    return connected;
  }, [response, selectedChain, selectedNodeId]);

  const connectedEdgeIds = useMemo(() => {
    if (!response) return new Set<string>();
    if (selectedChain) return new Set(selectedChain.edge_ids);
    const ids = new Set<string>();
    if (selectedNodeId) {
      for (const edge of response.edges) {
        if (edge.from === selectedNodeId || edge.to === selectedNodeId) ids.add(edge.id);
      }
    }
    if (selectedEdgeId) ids.add(selectedEdgeId);
    return ids;
  }, [response, selectedChain, selectedEdgeId, selectedNodeId]);

  const visibleNodeIds = useMemo(() => {
    if (!presented) return new Set<string>();
    if (selectedChain) return new Set(selectedChain.node_ids);
    if (showAllNodes) return new Set(presented.nodes.map((node) => node.node.id));
    const ids = new Set<string>();
    for (const node of presented.nodes) {
      if (!presented.hidden_node_ids.has(node.node.id)) ids.add(node.node.id);
    }
    return ids;
  }, [presented, selectedChain, showAllNodes]);

  const visibleNodes = useMemo(
    () => (presented?.nodes ?? []).filter((node) => visibleNodeIds.has(node.node.id)),
    [presented, visibleNodeIds],
  );
  const visibleEdges = useMemo(
    () =>
      (presented?.edges ?? []).filter(
        (edge) => visibleNodeIds.has(edge.edge.from) && visibleNodeIds.has(edge.edge.to),
      ),
    [presented, visibleNodeIds],
  );

  if (phase === "loading") {
    return (
      <section className="trust-review__panel trust-review__panel--graph">
        <header className="trust-review__panel-head">
          <div>
            <p className="trust-review__eyebrow">Session Evidence Graph</p>
            <h3>How files, prompts, endpoints, and outputs connect</h3>
          </div>
          <span className="trust-review__state-pill trust-review__state-pill--neutral">Loading</span>
        </header>
        <GraphLoading />
      </section>
    );
  }

  if (phase === "error") {
    return (
      <section className="trust-review__panel trust-review__panel--graph">
        <header className="trust-review__panel-head">
          <div>
            <p className="trust-review__eyebrow">Session Evidence Graph</p>
            <h3>How files, prompts, endpoints, and outputs connect</h3>
          </div>
          <StatePill state="error" />
        </header>
        <GraphEmpty title="Evidence graph unavailable" body={errorMessage} />
      </section>
    );
  }

  if (phase === "empty" && !response) {
    return (
      <section className="trust-review__panel trust-review__panel--graph">
        <header className="trust-review__panel-head">
          <div>
            <p className="trust-review__eyebrow">Session Evidence Graph</p>
            <h3>How files, prompts, endpoints, and outputs connect</h3>
          </div>
          <StatePill state="empty" />
        </header>
        <GraphEmpty title="Evidence graph not available yet" body={errorMessage} />
      </section>
    );
  }

  if (!response || !presented) {
    return (
      <section className="trust-review__panel trust-review__panel--graph">
        <header className="trust-review__panel-head">
          <div>
            <p className="trust-review__eyebrow">Session Evidence Graph</p>
            <h3>How files, prompts, endpoints, and outputs connect</h3>
          </div>
          <StatePill state="error" />
        </header>
        <GraphEmpty title="Evidence graph unavailable" body={errorMessage} />
      </section>
    );
  }

  const title =
    phase === "degraded"
      ? "Limited evidence coverage"
      : phase === "empty"
        ? "No graph returned"
        : "Live evidence graph";
  const body =
    phase === "degraded"
      ? response.degraded?.reasons.join(" ") ?? "The backend returned a degraded graph for this session."
      : phase === "empty"
        ? "The backend returned a valid response but no graph nodes or edges were available."
        : "Start with the top chains below, then drill into nodes and edges only where needed.";

  return (
    <section className="trust-review__panel trust-review__panel--graph">
      <header className="trust-review__panel-head">
        <div>
          <p className="trust-review__eyebrow">Session Evidence Graph</p>
          <h3>How files, prompts, endpoints, and outputs connect</h3>
        </div>
        <StatePill state={phase === "degraded" ? "degraded" : phase === "empty" ? "empty" : "ready"} />
      </header>

      <div className="trust-review__graph-summary">
        <span className="trust-review__graph-pill">{response.summary.node_count} nodes</span>
        <span className="trust-review__graph-pill">{response.summary.edge_count} edges</span>
        <span className="trust-review__graph-pill">{response.summary.prompt_count} prompts</span>
        <span className="trust-review__graph-pill">{response.summary.endpoint_count} endpoints</span>
        <span className="trust-review__graph-pill">confidence {response.summary.confidence}</span>
      </div>

      <div className={`trust-review__state-banner trust-review__state-banner--${phase === "degraded" ? "degraded" : "ready"}`}>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>

      {response.nodes.length === 0 && response.edges.length === 0 ? (
        <GraphEmpty
          title="No evidence graph nodes were returned"
          body="This session does not yet expose enough structure for a relationship view."
        />
      ) : (
        <>
          <KeyChainList chains={presented.key_chains} selectedChainId={selectedChainId} onSelect={setSelectedChainId} />

          {presented.hidden_node_ids.size > 0 ? (
            <div className="trust-review__graph-controls">
              <button type="button" className="trust-review__inline-button" onClick={() => setShowAllNodes((value) => !value)}>
                {showAllNodes ? "Hide low-value nodes" : `Show all nodes (${presented.hidden_node_ids.size} hidden)`}
              </button>
            </div>
          ) : null}

          <div className="trust-review__graph-grid">
            <div className="trust-review__graph-column">
              <div className="trust-review__graph-column-head">
                <h4>Nodes</h4>
                <span>{visibleNodes.length}</span>
              </div>
              <div className="trust-review__graph-list">
                {visibleNodes.map((node) => (
                  <GraphNodeCard
                    key={node.node.id}
                    node={node}
                    selected={node.node.id === selectedNodeId}
                    connected={connectedNodeIds.has(node.node.id)}
                    dimmed={connectedNodeIds.size > 0 && !connectedNodeIds.has(node.node.id)}
                    onSelect={(nodeId) => {
                      setSelectedChainId(null);
                      setSelectedNodeId(nodeId);
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="trust-review__graph-column">
              <div className="trust-review__graph-column-head">
                <h4>Edges</h4>
                <span>{visibleEdges.length}</span>
              </div>
              <div className="trust-review__graph-list">
                {visibleEdges.map((edge) => (
                  <GraphEdgeRow
                    key={edge.edge.id}
                    edge={edge}
                    selected={edge.edge.id === selectedEdgeId}
                    connected={connectedEdgeIds.has(edge.edge.id)}
                    dimmed={connectedEdgeIds.size > 0 && !connectedEdgeIds.has(edge.edge.id)}
                    onSelect={(edgeId) => {
                      setSelectedChainId(null);
                      setSelectedEdgeId(edgeId);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="trust-review__graph-detail-grid">
            <article className="trust-review__graph-detail">
              <header className="trust-review__graph-detail-head">
                <div>
                  <p className="trust-review__eyebrow">Selected node</p>
                  <h4>{selectedNode?.primary_label ?? "None selected"}</h4>
                </div>
                {selectedNode ? <span className="trust-review__graph-type">{selectedNode.node.type}</span> : null}
              </header>
              {selectedNode ? (
                <>
                  <p className="trust-review__graph-desc">{selectedNode.why_it_matters}</p>
                  {selectedNode.secondary_label ? <p className="trust-review__graph-meta">{selectedNode.secondary_label}</p> : null}
                  {selectedNode.preview ? <p className="trust-review__graph-desc">{selectedNode.preview}</p> : null}
                  <EvidenceSourcePill source={selectedNode.node.source} sources={selectedNode.node.sources} />
                  <EventChips session={session} eventIds={selectedNode.node.event_ids} onSeek={onSeek} />
                  <RawExcerpt value={selectedNode.raw_detail} />
                </>
              ) : (
                <GraphEmpty title="No node selected" body="Select a node to inspect its supporting events." />
              )}
            </article>

            <article className="trust-review__graph-detail">
              <header className="trust-review__graph-detail-head">
                <div>
                  <p className="trust-review__eyebrow">Selected edge</p>
                  <h4>{selectedEdge?.secondary_label ?? "None selected"}</h4>
                </div>
                {selectedEdge ? <span className="trust-review__graph-type">{selectedEdge.edge.type}</span> : null}
              </header>
              {selectedEdge ? (
                <>
                  <p className="trust-review__graph-desc">{selectedEdge.primary_label}</p>
                  {selectedEdge.preview ? <p className="trust-review__graph-desc">{selectedEdge.preview}</p> : null}
                  <EvidenceSourcePill source={selectedEdge.edge.source} sources={selectedEdge.edge.sources} />
                  <EventChips session={session} eventIds={selectedEdge.edge.event_ids} onSeek={onSeek} />
                </>
              ) : (
                <GraphEmpty title="No edge selected" body="Select an edge to inspect the relationship evidence." />
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}
