import type { ReviewerView, SessionNormalized } from "../lib/auditPipeline";
import type { Session } from "../types/session";

import "./ReviewerFocusPanel.css";

interface CriticalEvent {
  index: number;
  severity: "high" | "medium";
  reason: string;
}

interface ReviewerFocusPanelProps {
  session: Session;
  normalized: SessionNormalized;
  reviewer: ReviewerView;
  currentIndex: number;
  onSeek: (index: number) => void;
  criticalEvents: CriticalEvent[];
}

export function ReviewerFocusPanel({
  session,
  normalized,
  reviewer,
  currentIndex,
  onSeek,
  criticalEvents,
}: ReviewerFocusPanelProps) {
  const highRisk = reviewer.high_risk_items.slice(0, 5);
  const failedChecks = normalized.verifications.filter((v) => v.result === "fail");
  const unknownChecks = normalized.verifications.filter((v) => v.result === "unknown");
  const topHotspots = normalized.hotspots.slice(0, 8);
  const topRevisions = normalized.revisions.slice(0, 6);
  const highSignals = criticalEvents.filter((e) => e.severity === "high");

  return (
    <section className="reviewer-focus">
      <header className="reviewer-focus__alert">
        <h2>Critical Review Required</h2>
        <p>
          {highSignals.length} high-severity signals, {failedChecks.length} failed checks,{" "}
          {highRisk.length} high-risk artifacts.
        </p>
      </header>

      <div className="reviewer-focus__grid">
        <article className="reviewer-focus__card reviewer-focus__card--danger">
          <h3>Highest Risk</h3>
          {highRisk.length === 0 ? (
            <p>No high-risk artifacts detected.</p>
          ) : (
            <ul>
              {highRisk.map((r, i) => (
                <li key={`${r.intent_id ?? "session"}-${i}`}>
                  <strong>{r.intent_id ?? "session"}</strong>: {r.reasons.join("; ")}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="reviewer-focus__card reviewer-focus__card--warn">
          <h3>Verification Gaps</h3>
          <ul>
            <li>
              Failed: <strong>{failedChecks.length}</strong>
            </li>
            <li>
              Unknown: <strong>{unknownChecks.length}</strong>
            </li>
            <li>
              Coverage: <strong>{reviewer.verification_summary.coverage}</strong>
            </li>
          </ul>
        </article>

        <article className="reviewer-focus__card">
          <h3>Hotspot Files</h3>
          {topHotspots.length === 0 ? (
            <p>No hotspots.</p>
          ) : (
            <ul>
              {topHotspots.map((h) => (
                <li key={h.file}>
                  <code>{h.file}</code> (score {h.score})
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      <div className="reviewer-focus__grid reviewer-focus__grid--2">
        <article className="reviewer-focus__card">
          <h3>Critical Event Jump List</h3>
          {criticalEvents.length === 0 ? (
            <p>No critical event markers.</p>
          ) : (
            <div className="reviewer-focus__jump-list">
              {criticalEvents.slice(0, 14).map((item, i) => (
                <button
                  key={`${item.index}-${i}`}
                  type="button"
                  className={`reviewer-focus__jump ${item.severity === "high" ? "is-high" : "is-medium"} ${item.index === currentIndex ? "is-current" : ""}`}
                  onClick={() => onSeek(item.index)}
                  title={`Event ${item.index + 1}`}
                >
                  E{item.index + 1}: {item.reason}
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="reviewer-focus__card">
          <h3>Revision Signals</h3>
          {topRevisions.length === 0 ? (
            <p>No revision artifacts.</p>
          ) : (
            <ul>
              {topRevisions.map((r) => (
                <li key={r.id}>
                  <strong>{r.type}</strong>: {r.explanation}
                </li>
              ))}
            </ul>
          )}
          <p className="reviewer-focus__footnote">
            Session: <code>{session.id}</code> · Outcome: <strong>{reviewer.outcome}</strong>
          </p>
        </article>
      </div>
    </section>
  );
}

