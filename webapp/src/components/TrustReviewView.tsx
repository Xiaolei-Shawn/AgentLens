import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Session } from "../types/session";
import { ForensicInputPanel } from "./ForensicInputPanel";
import { EvidenceSourcePill } from "./EvidenceSourcePill";
import { SafetyModesPanel } from "./SafetyModesPanel";
import { TransparencyDiffPanel } from "./TransparencyDiffPanel";
import {
  fetchTrustReview,
  TrustApiError,
  getEventIndexById,
  type TrustFinding,
  type TrustOutboundRow,
  type TrustReviewResponse,
  type TrustSeverity,
  type TrustState,
} from "../lib/trustReview";
import { EvidenceGraphPanel } from "./EvidenceGraphPanel";
import { deriveTrustNarrative, groupOutboundRows } from "../lib/trustPresentation";

import "./TrustReviewView.css";

interface TrustReviewViewProps {
  session: Session;
  onSeek?: (index: number) => void;
}

function SeverityBadge({ severity }: { severity: TrustSeverity }) {
  return <span className={`trust-review__badge trust-review__badge--${severity}`}>{severity}</span>;
}

function LoadingState() {
  return (
    <section className="trust-review trust-review--loading" aria-busy="true" aria-live="polite">
      <div className="trust-review__skeleton trust-review__skeleton--hero" />
      <div className="trust-review__skeleton-grid">
        <div className="trust-review__skeleton trust-review__skeleton--card" />
        <div className="trust-review__skeleton trust-review__skeleton--card" />
        <div className="trust-review__skeleton trust-review__skeleton--card" />
      </div>
      <div className="trust-review__skeleton trust-review__skeleton--panel" />
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="trust-review trust-review--empty">
      <header className="trust-review__hero">
        <div>
          <p className="trust-review__eyebrow">Trust Review</p>
          <h2>{title}</h2>
        </div>
        <span className="trust-review__state-pill trust-review__state-pill--neutral">Empty</span>
      </header>
      <div className="trust-review__empty-panel">
        <h3>No findings yet</h3>
        <p>{body}</p>
      </div>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="trust-review trust-review--error" role="alert">
      <header className="trust-review__hero">
        <div>
          <p className="trust-review__eyebrow">Trust Review</p>
          <h2>Trust analysis unavailable</h2>
        </div>
        <span className="trust-review__state-pill trust-review__state-pill--danger">Error</span>
      </header>
      <div className="trust-review__empty-panel">
        <h3>Trust analysis failed</h3>
        <p>{message}</p>
      </div>
    </section>
  );
}

function StateBanner({ title, body, tone }: { title: string; body: string; tone: "ready" | "degraded"; }) {
  return (
    <section className={`trust-review__state-banner trust-review__state-banner--${tone}`}>
      <h3>{title}</h3>
      <p>{body}</p>
    </section>
  );
}

function SummaryCard({ response }: { response: TrustReviewResponse }) {
  return (
    <article className="trust-review__summary-card">
      <div className="trust-review__summary-head">
        <div>
          <p className="trust-review__eyebrow">Trust Summary</p>
          <h3>{response.summary.verdict.toUpperCase()}</h3>
        </div>
        <div className={`trust-review__score trust-review__score--${response.summary.verdict}`}>
          {response.summary.score}
        </div>
      </div>
      <p className="trust-review__summary-lead">
        Live backend trust analysis for this session.
      </p>
      <ul className="trust-review__summary-list">
        {response.summary.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </article>
  );
}

function CountCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const style: CSSProperties & { ["--count-accent"]?: string } = {
    "--count-accent": accent,
  };
  return (
    <article className="trust-review__count-card" style={style}>
      <span className="trust-review__count-label">{label}</span>
      <strong className="trust-review__count-value">{value}</strong>
    </article>
  );
}

function EvidenceChips({
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

function NarrativePanel({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="trust-review__narrative-card">
      <header className="trust-review__panel-head">
        <div>
          <p className="trust-review__eyebrow">{title}</p>
          <h3>{title}</h3>
        </div>
      </header>
      <ul className="trust-review__summary-list trust-review__summary-list--compact">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function OutboundMatrix({
  session,
  rows,
  onSeek,
}: {
  session: Session;
  rows: TrustOutboundRow[];
  onSeek?: (index: number) => void;
}) {
  const [showRawEvidence, setShowRawEvidence] = useState(false);
  const groups = useMemo(() => groupOutboundRows(rows), [rows]);

  return (
    <section className="trust-review__panel trust-review__panel--matrix">
      <header className="trust-review__panel-head">
        <div>
          <p className="trust-review__eyebrow">Outbound Matrix</p>
          <h3>Where session data appears to travel</h3>
        </div>
        <div className="trust-review__panel-actions">
          <p className="trust-review__panel-note">Grouped by destination behavior, not raw event blobs.</p>
          <label className="trust-review__toggle">
            <input
              type="checkbox"
              checked={showRawEvidence}
              onChange={(event) => setShowRawEvidence(event.target.checked)}
            />
            <span>Show raw evidence</span>
          </label>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="trust-review__empty-inline">No outbound surfaces were returned for this session.</p>
      ) : (
        <div className="trust-review__outbound-groups">
          {groups.map((group) => (
            <article key={group.endpoint_type} className="trust-review__outbound-group">
              <header className="trust-review__outbound-group-head">
                <div>
                  <h4>{group.title}</h4>
                  <p>{group.summary}</p>
                </div>
                <span className="trust-review__graph-pill">{group.rows.length} destinations</span>
              </header>

              <div className="trust-review__outbound-list">
                {group.rows.map((presented) => (
                  <article
                    key={`${presented.row.endpoint}-${presented.row.endpoint_type}`}
                    className={`trust-review__outbound-row ${presented.is_low_signal ? "is-compressed" : ""}`}
                  >
                    <div className="trust-review__outbound-row-head">
                      <div>
                        <div className="trust-review__outbound-title-row">
                          <strong>{presented.destination}</strong>
                          <SeverityBadge severity={presented.row.risk_level} />
                        </div>
                        <p className="trust-review__outbound-meta">
                          {presented.category_label}
                          {presented.destination_detail ? ` · ${presented.destination_detail}` : ""}
                        </p>
                      </div>
                      <span className="trust-review__graph-count">{presented.event_count}</span>
                    </div>

                    <div className="trust-review__outbound-summary">
                      <p>{presented.payload_summary}</p>
                      <span>{presented.payload_detail}</span>
                    </div>

                    <div className="trust-review__outbound-foot">
                      <EvidenceSourcePill
                        source={presented.row.evidence_sources?.[0]}
                        sources={presented.row.evidence_sources}
                      />
                      <span className="trust-review__muted">
                        {presented.event_count} evidence event{presented.event_count === 1 ? "" : "s"}
                      </span>
                    </div>

                    <details className="trust-review__disclosure">
                      <summary>{showRawEvidence ? "Hide evidence" : "Inspect evidence"}</summary>
                      <div className="trust-review__disclosure-body">
                        <p className="trust-review__outbound-raw">
                          Raw classes: {presented.row.data_classes.length > 0 ? presented.row.data_classes.join(", ") : "none"}
                        </p>
                        <p className="trust-review__outbound-raw">Raw endpoint: {presented.row.endpoint}</p>
                        <EvidenceChips session={session} eventIds={presented.row.event_ids} onSeek={onSeek} />
                      </div>
                    </details>
                  </article>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function FindingsSection({
  session,
  title,
  eyebrow,
  findings,
  note,
  onSeek,
}: {
  session: Session;
  title: string;
  eyebrow: string;
  findings: TrustFinding[];
  note: string;
  onSeek?: (index: number) => void;
}) {
  return (
    <section className="trust-review__panel">
      <header className="trust-review__panel-head">
        <div>
          <p className="trust-review__eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
        </div>
        <p className="trust-review__panel-note">{note}</p>
      </header>

      {findings.length === 0 ? (
        <p className="trust-review__empty-inline">No findings in this category yet.</p>
      ) : (
        <div className="trust-review__finding-list">
          {findings.map((finding) => (
            <article className="trust-review__finding" key={finding.id}>
              <div className="trust-review__finding-head">
                <div>
                  <h4>{finding.title}</h4>
                  <p>{finding.summary}</p>
                  <EvidenceSourcePill
                    source={finding.evidence_sources?.[0]}
                    sources={finding.evidence_sources}
                  />
                </div>
                <SeverityBadge severity={finding.severity} />
              </div>
              <EvidenceChips session={session} eventIds={finding.event_ids} onSeek={onSeek} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function TrustReviewView({ session, onSeek }: TrustReviewViewProps) {
  const [phase, setPhase] = useState<TrustState>("loading");
  const [response, setResponse] = useState<TrustReviewResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("Trust analysis could not be loaded.");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadTrustReview() {
      setPhase("loading");
      setResponse(null);
      setErrorMessage("Trust analysis could not be loaded.");

      try {
        const next = await fetchTrustReview(session.id, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResponse(next);

        if (next.degraded?.insufficient_signals) {
          setPhase("degraded");
          return;
        }

        const hasFindings =
          next.outbound_matrix.length > 0 ||
          next.control_surface.length > 0 ||
          next.transparency_findings.length > 0 ||
          (next.safety_modes?.length ?? 0) > 0 ||
          (next.transparency_diffs?.length ?? 0) > 0;
        setPhase(hasFindings ? "ready" : "empty");
      } catch (error) {
        if (controller.signal.aborted) return;

        setResponse(null);
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (error instanceof Error) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Trust analysis could not be loaded.");
        }

        if (error instanceof TrustApiError && error.status >= 500) {
          setPhase("error");
          return;
        }

        setPhase("error");
      }
    }

    void loadTrustReview();

    return () => controller.abort();
  }, [session.id, refreshToken]);

  const metrics = useMemo(() => {
    const total = session.events.length;
    return {
      total,
      outbound: response?.outbound_matrix.length ?? 0,
      control: response?.control_surface.length ?? 0,
      transparency: response?.transparency_findings.length ?? 0,
    };
  }, [response, session.events]);
  const narrative = useMemo(() => (response ? deriveTrustNarrative(response) : null), [response]);

  function handleForensicAttached() {
    setRefreshToken((value) => value + 1);
  }

  if (phase === "loading") {
    return <LoadingState />;
  }

  if (phase === "error") {
    return <ErrorState message={errorMessage} />;
  }

  if (!response) {
    return <ErrorState message="Trust analysis could not be loaded." />;
  }

  if (phase === "empty") {
    return (
      <EmptyState
        title="No trust findings returned"
        body="The backend trust endpoint returned a valid session, but no outbound, control, or transparency signals were available yet."
      />
    );
  }

  const bannerTitle =
    phase === "degraded"
      ? "Limited trust signal coverage"
      : response.summary.verdict === "high"
        ? "Elevated trust risk"
        : response.summary.verdict === "medium"
          ? "Mixed trust posture"
          : "Low trust risk";
  const bannerBody =
    phase === "degraded"
      ? response.degraded?.reasons.join(" ") ??
        "The backend trust analysis returned a degraded result for this session."
      : "Live backend trust analysis is available for this session.";

  return (
    <section className="trust-review">
      <header className="trust-review__hero">
        <div>
          <p className="trust-review__eyebrow">Trust Review</p>
          <h2>{session.title}</h2>
          <p className="trust-review__hero-copy">
            Session-level trust audit powered by the backend trust contract.
          </p>
        </div>
        <div className="trust-review__hero-meta">
          <span className="trust-review__state-pill trust-review__state-pill--live">Live trust review</span>
          <span className="trust-review__session-id">{response.session_id}</span>
        </div>
      </header>

      <div className="trust-review__summary-row">
        <SummaryCard response={response} />
        <CountCard label="Outbound surfaces" value={metrics.outbound.toString()} accent="rgba(56, 189, 248, 0.85)" />
        <CountCard label="Control findings" value={metrics.control.toString()} accent="rgba(34, 197, 94, 0.85)" />
        <CountCard label="Transparency findings" value={metrics.transparency.toString()} accent="rgba(245, 158, 11, 0.85)" />
      </div>

      {narrative ? (
        <div className="trust-review__narrative-row">
          <NarrativePanel title="Key takeaways" items={narrative.takeaways} />
          <NarrativePanel title="Where to inspect next" items={narrative.next_steps} />
        </div>
      ) : null}

      <StateBanner title={bannerTitle} body={bannerBody} tone={phase === "degraded" ? "degraded" : "ready"} />

      <div className="trust-review__analysis-grid">
        <SafetyModesPanel session={session} modes={response.safety_modes} onSeek={onSeek} />
        <TransparencyDiffPanel
          session={session}
          diffs={response.transparency_diffs}
          findings={response.transparency_findings}
          onSeek={onSeek}
        />
      </div>

      <ForensicInputPanel key={session.id} session={session} onAttached={handleForensicAttached} />

      <div className="trust-review__layout">
        <OutboundMatrix session={session} rows={response.outbound_matrix} onSeek={onSeek} />
        <FindingsSection
          session={session}
          title="Control Surface"
          eyebrow="Control Surface"
          findings={response.control_surface}
          note="Control exposure signals returned by the live backend contract."
          onSeek={onSeek}
        />
      </div>

      <EvidenceGraphPanel session={session} onSeek={onSeek} refreshKey={refreshToken} />
    </section>
  );
}
