import { useMemo } from "react";
import { deriveContextPath } from "../lib/contextPath";
import type { Session } from "../types/session";

import "./ContextPathView.css";

interface ContextPathViewProps {
  session: Session;
  currentIndex: number;
  onSeek: (index: number) => void;
}

export function ContextPathView({ session, currentIndex, onSeek }: ContextPathViewProps) {
  const model = useMemo(() => deriveContextPath(session.events), [session.events]);
  const nodeById = useMemo(
    () => new Map(model.nodes.map((node) => [node.id, node])),
    [model.nodes]
  );

  return (
    <section className="context-path">
      <header className="context-path__header">
        <h2>Context Forming Path</h2>
        <p>Read-only explanation map of how context gathering flowed into decisions and final file outcomes.</p>
      </header>

      <div className="context-path__summary">
        <span>Sources: {model.byType.source.length}</span>
        <span>Reasoning: {model.byType.reasoning.length}</span>
        <span>Decisions: {model.byType.decision.length}</span>
        <span>Outcomes: {model.byType.outcome.length}</span>
        <span>Links: {model.links.length}</span>
      </div>

      <div className="context-path__grid">
        <article className="context-path__col">
          <h3>Context Sources</h3>
          {model.byType.source.length === 0 ? <p>No source events.</p> : null}
          {model.byType.source.map((node) => (
            <button
              type="button"
              key={node.id}
              className={`context-path__node ${node.eventIndex === currentIndex ? "is-current" : ""}`}
              onClick={() => onSeek(node.eventIndex)}
            >
              <strong>E{node.eventIndex + 1}</strong> {node.label}
              {node.detail ? <div>{node.detail}</div> : null}
            </button>
          ))}
        </article>
        <article className="context-path__col">
          <h3>Interpretation</h3>
          {model.byType.reasoning.length === 0 ? (
            <p>No explicit reasoning artifacts were captured in this session.</p>
          ) : null}
          {model.byType.reasoning.map((node) => (
            <button
              type="button"
              key={node.id}
              className={`context-path__node ${node.eventIndex === currentIndex ? "is-current" : ""}`}
              onClick={() => onSeek(node.eventIndex)}
            >
              <strong>E{node.eventIndex + 1}</strong> {node.label}
              {node.detail ? <div>{node.detail}</div> : null}
            </button>
          ))}
        </article>
        <article className="context-path__col">
          <h3>Decisions</h3>
          {model.byType.decision.length === 0 ? <p>No decision events.</p> : null}
          {model.byType.decision.map((node) => (
            <button
              type="button"
              key={node.id}
              className={`context-path__node ${node.eventIndex === currentIndex ? "is-current" : ""}`}
              onClick={() => onSeek(node.eventIndex)}
            >
              <strong>E{node.eventIndex + 1}</strong> {node.label}
              {node.detail ? <div>{node.detail}</div> : null}
            </button>
          ))}
        </article>
        <article className="context-path__col">
          <h3>Outcomes (File Changes)</h3>
          {model.byType.outcome.length === 0 ? <p>No file outcomes.</p> : null}
          {model.byType.outcome.map((node) => (
            <button
              type="button"
              key={node.id}
              className={`context-path__node ${node.eventIndex === currentIndex ? "is-current" : ""}`}
              onClick={() => onSeek(node.eventIndex)}
            >
              <strong>E{node.eventIndex + 1}</strong> {node.label}
              {node.detail ? <div>{node.detail}</div> : null}
            </button>
          ))}
        </article>
      </div>

      <section className="context-path__links">
        <h3>Explanation Links</h3>
        {model.links.length === 0 ? (
          <p>No explicit source-to-outcome links were inferred for this session.</p>
        ) : (
          <ul>
            {model.links.slice(0, 30).map((link, index) => (
              <li key={`${link.from}-${link.to}-${index}`}>
                <code>{link.reason}</code> ·{" "}
                {nodeById.get(link.from)?.label ?? link.from} → {nodeById.get(link.to)?.label ?? link.to}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
