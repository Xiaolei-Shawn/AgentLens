import type { Session } from "../types/session";
import { EvidenceSourcePill } from "./EvidenceSourcePill";
import {
  getEventIndexById,
  type TrustFinding,
  type TrustTransparencyDiff,
} from "../lib/trustReview";

interface TransparencyDiffPanelProps {
  session: Session;
  diffs?: TrustTransparencyDiff[];
  findings?: TrustFinding[];
  onSeek?: (index: number) => void;
}

function formatKind(kind: string): string {
  return kind.replace(/[_-]+/g, " ");
}

function DiffEvidenceChips({
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
        const index = getEventIndexById(session.events, eventId);
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

export function TransparencyDiffPanel({
  session,
  diffs,
  findings,
  onSeek,
}: TransparencyDiffPanelProps) {
  const list = diffs ?? [];
  const hasStructuredDiffs = list.length > 0;
  const hasFindings = (findings?.length ?? 0) > 0;

  return (
    <section className="trust-review__panel trust-review__panel--diff">
      <header className="trust-review__panel-head">
        <div>
          <p className="trust-review__eyebrow">Transparency diff</p>
          <h3>Prompt, tool, and system changes</h3>
        </div>
        <span className="trust-review__state-pill trust-review__state-pill--neutral">
          {hasStructuredDiffs ? `${list.length} change${list.length === 1 ? "" : "s"}` : "Pending"}
        </span>
      </header>

      <p className="trust-review__panel-note trust-review__panel-note--wide">
        When the backend provides structured before/after data, this view shows exactly what changed.
      </p>

      {!hasStructuredDiffs ? (
        <p className="trust-review__empty-inline">
          No structured transparency diff data was returned for this session yet.
        </p>
      ) : (
        <div className="trust-review__diff-list">
          {list.map((diff) => (
            <article className="trust-review__diff-card" key={diff.id}>
              <div className="trust-review__diff-head">
                <div>
                  <p className="trust-review__graph-type">{formatKind(diff.kind)}</p>
                  <h4>{diff.title}</h4>
                </div>
                <span className="trust-review__graph-count">{diff.event_ids.length}</span>
              </div>

              <EvidenceSourcePill
                source={diff.evidence_sources?.[0]}
                sources={diff.evidence_sources}
              />

              <div className="trust-review__diff-grid">
                <div className="trust-review__diff-column">
                  <span className="trust-review__diff-column-label">Before</span>
                  <p className="trust-review__diff-text">
                    {diff.before?.trim() || "No before-state text was returned."}
                  </p>
                </div>
                <div className="trust-review__diff-column">
                  <span className="trust-review__diff-column-label">After</span>
                  <p className="trust-review__diff-text">
                    {diff.after?.trim() || "No after-state text was returned."}
                  </p>
                </div>
              </div>

              {diff.note ? <p className="trust-review__graph-desc">{diff.note}</p> : null}
              <DiffEvidenceChips session={session} eventIds={diff.event_ids} onSeek={onSeek} />
            </article>
          ))}
        </div>
      )}

      {hasFindings ? (
        <div className="trust-review__diff-fallback">
          <h4>Related transparency findings</h4>
          <div className="trust-review__finding-list">
            {findings!.map((finding) => (
              <article className="trust-review__finding trust-review__finding--compact" key={finding.id}>
                <div className="trust-review__finding-head">
                  <div>
                    <h4>{finding.title}</h4>
                    <p>{finding.summary}</p>
                    <EvidenceSourcePill
                      source={finding.evidence_sources?.[0]}
                      sources={finding.evidence_sources}
                    />
                  </div>
                </div>
                <DiffEvidenceChips session={session} eventIds={finding.event_ids} onSeek={onSeek} />
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
