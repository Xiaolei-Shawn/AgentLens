import { useEffect, useMemo, useState } from "react";
import type { Session } from "../types/session";
import { EvidenceSourcePill } from "./EvidenceSourcePill";
import {
  EvidenceGraphApiError,
  fetchEvidenceGraph,
  findEventIndexById,
  type EvidenceGraphEdge,
  type EvidenceGraphNode,
  type EvidenceGraphResponse,
  type EvidenceGraphState,
} from "../lib/evidenceGraph";

interface EvidenceGraphPanelProps {
  session: Session;
  onSeek?: (index: number) => void;
  refreshKey?: number;
}

function StatePill({ state }: { state: Exclude<EvidenceGraphState, "loading"> }) {
  const label =
    state === "ready" ? "Live graph" : state === "degraded" ? "Degraded" : state === "empty" ? "Empty" : "Error";
  const tone =
    state === "ready" ? "live" : state === "error" ? "danger" : "neutral";
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
  if (uniqueIds.length === 0) {
    return <span className="trust-review__muted">No evidence links</span>;
  }

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
  onSelect,
}: {
  node: EvidenceGraphNode;
  selected: boolean;
  connected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`trust-review__graph-card ${selected ? "is-selected" : ""} ${connected ? "is-connected" : ""}`}
      onClick={() => onSelect(node.id)}
    >
      <div className="trust-review__graph-card-head">
        <div>
          <p className="trust-review__graph-type">{node.type}</p>
          <h4>{node.label}</h4>
          <EvidenceSourcePill source={node.source} sources={node.sources} />
        </div>
        <span className="trust-review__graph-count">{node.event_ids.length}</span>
      </div>
      <p className="trust-review__graph-desc">
        {node.description ?? "Session evidence node derived from backend graph analysis."}
      </p>
    </button>
  );
}

function GraphEdgeRow({
  edge,
  selected,
  connected,
  onSelect,
}: {
  edge: EvidenceGraphEdge;
  selected: boolean;
  connected: boolean;
  onSelect: (edgeId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`trust-review__graph-edge ${selected ? "is-selected" : ""} ${connected ? "is-connected" : ""}`}
      onClick={() => onSelect(edge.id)}
    >
      <div className="trust-review__graph-edge-top">
        <strong>{edge.type}</strong>
        <span>{edge.event_ids.length} event(s)</span>
      </div>
      <div className="trust-review__graph-edge-flow">
        <span>{edge.from}</span>
        <span aria-hidden>→</span>
        <span>{edge.to}</span>
      </div>
      <EvidenceSourcePill source={edge.source} sources={edge.sources} />
      {edge.label ? <p className="trust-review__graph-desc">{edge.label}</p> : null}
    </button>
  );
}

export function EvidenceGraphPanel({ session, onSeek, refreshKey }: EvidenceGraphPanelProps) {
  const [phase, setPhase] = useState<EvidenceGraphState>("loading");
  const [response, setResponse] = useState<EvidenceGraphResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("Evidence graph could not be loaded.");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!response) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      return;
    }
    setSelectedNodeId((current) => current ?? response.nodes[0]?.id ?? null);
    setSelectedEdgeId((current) => current ?? response.edges[0]?.id ?? null);
  }, [response]);

  const selectedNode = useMemo(
    () => response?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [response, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => response?.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [response, selectedEdgeId],
  );

  const connectedNodeIds = useMemo(() => {
    if (!response || !selectedNode) return new Set<string>();
    const connected = new Set<string>();
    connected.add(selectedNode.id);
    for (const edge of response.edges) {
      if (edge.from === selectedNode.id) connected.add(edge.to);
      if (edge.to === selectedNode.id) connected.add(edge.from);
    }
    return connected;
  }, [response, selectedNode]);

  const connectedEdgeIds = useMemo(() => {
    if (!response) return new Set<string>();
    const ids = new Set<string>();
    if (selectedNode) {
      for (const edge of response.edges) {
        if (edge.from === selectedNode.id || edge.to === selectedNode.id) ids.add(edge.id);
      }
    }
    if (selectedEdge) {
      ids.add(selectedEdge.id);
      ids.add(selectedEdge.from);
      ids.add(selectedEdge.to);
    }
    return ids;
  }, [response, selectedEdge, selectedNode]);

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

  if (!response) {
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
        : "Use the relationship panel to inspect nodes, edges, and the supporting event sequence.";

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
          <div className="trust-review__graph-grid">
            <div className="trust-review__graph-column">
              <div className="trust-review__graph-column-head">
                <h4>Nodes</h4>
                <span>{response.nodes.length}</span>
              </div>
              <div className="trust-review__graph-list">
                {response.nodes.map((node) => (
                  <GraphNodeCard
                    key={node.id}
                    node={node}
                    selected={node.id === selectedNodeId}
                    connected={connectedNodeIds.has(node.id)}
                    onSelect={setSelectedNodeId}
                  />
                ))}
              </div>
            </div>

            <div className="trust-review__graph-column">
              <div className="trust-review__graph-column-head">
                <h4>Edges</h4>
                <span>{response.edges.length}</span>
              </div>
              <div className="trust-review__graph-list">
                {response.edges.map((edge) => (
                  <GraphEdgeRow
                    key={edge.id}
                    edge={edge}
                    selected={edge.id === selectedEdgeId}
                    connected={connectedEdgeIds.has(edge.id)}
                    onSelect={setSelectedEdgeId}
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
                  <h4>{selectedNode?.label ?? "None selected"}</h4>
                </div>
                {selectedNode ? <span className="trust-review__graph-type">{selectedNode.type}</span> : null}
              </header>
              {selectedNode ? (
                <>
                  <p className="trust-review__graph-desc">
                    {selectedNode.description ?? "Node derived from the backend evidence graph."}
                  </p>
                  <EvidenceSourcePill source={selectedNode.source} sources={selectedNode.sources} />
                  <EventChips session={session} eventIds={selectedNode.event_ids} onSeek={onSeek} />
                </>
              ) : (
                <GraphEmpty title="No node selected" body="Select a node to inspect its supporting events." />
              )}
            </article>

            <article className="trust-review__graph-detail">
              <header className="trust-review__graph-detail-head">
                <div>
                  <p className="trust-review__eyebrow">Selected edge</p>
                  <h4>{selectedEdge ? `${selectedEdge.from} → ${selectedEdge.to}` : "None selected"}</h4>
                </div>
                {selectedEdge ? <span className="trust-review__graph-type">{selectedEdge.type}</span> : null}
              </header>
              {selectedEdge ? (
                <>
                  <p className="trust-review__graph-desc">
                    {selectedEdge.label ?? "Edge derived from backend evidence graph."}
                  </p>
                  <EvidenceSourcePill source={selectedEdge.source} sources={selectedEdge.sources} />
                  <EventChips session={session} eventIds={selectedEdge.event_ids} onSeek={onSeek} />
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
