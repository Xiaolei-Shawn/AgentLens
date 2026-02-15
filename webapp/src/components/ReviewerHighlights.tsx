import type { ReviewerView, SessionNormalized } from "../lib/auditPipeline";

import "./ReviewerHighlights.css";

interface ReviewerHighlightsProps {
  normalized: SessionNormalized;
  reviewer: ReviewerView;
}

function riskClass(level: "low" | "medium" | "high"): string {
  return `reviewer-chip reviewer-chip--${level}`;
}

export function ReviewerHighlights({ normalized, reviewer }: ReviewerHighlightsProps) {
  const sessionImpact = normalized.impacts.find((i) => i.intent_id === undefined);
  const highRisk = reviewer.high_risk_items.slice(0, 3);
  const topHotspots = reviewer.hotspots.slice(0, 5);

  return (
    <section className="reviewer-highlights">
      <header className="reviewer-highlights__header">
        <h2>Reviewer Highlights</h2>
        <div className="reviewer-summary-line">
          <span className="reviewer-pill">Outcome: {reviewer.outcome}</span>
          <span className="reviewer-pill">Confidence: {(reviewer.confidence_estimate * 100).toFixed(0)}%</span>
          <span className="reviewer-pill">
            Verification: {reviewer.verification_summary.coverage} ({reviewer.verification_summary.pass} pass / {reviewer.verification_summary.fail} fail)
          </span>
        </div>
      </header>

      <div className="reviewer-grid">
        <div className="reviewer-card">
          <h3>High Risk Items</h3>
          {highRisk.length === 0 ? (
            <p className="reviewer-empty">No high-risk items detected.</p>
          ) : (
            <ul>
              {highRisk.map((item, i) => (
                <li key={`${item.intent_id ?? "session"}-${i}`}>
                  <span className={riskClass(item.level)}>{item.level}</span>{" "}
                  <strong>{item.intent_id ?? "session"}</strong>: {item.reasons.join("; ")}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="reviewer-card">
          <h3>Impact</h3>
          {sessionImpact ? (
            <ul>
              <li>Blast radius: <span className="reviewer-pill">{sessionImpact.blast_radius}</span></li>
              <li>Files touched: {sessionImpact.files_touched.length}</li>
              <li>Modules affected: {sessionImpact.modules_affected.length}</li>
              <li>Public API changed: {sessionImpact.public_api_changed ? "yes" : "no"}</li>
              <li>Schema changed: {sessionImpact.schema_changed ? "yes" : "no"}</li>
              <li>Dependency change: {sessionImpact.dependency_added ? "yes" : "no"}</li>
            </ul>
          ) : (
            <p className="reviewer-empty">No impact data.</p>
          )}
        </div>

        <div className="reviewer-card">
          <h3>Hotspots</h3>
          {topHotspots.length === 0 ? (
            <p className="reviewer-empty">No hotspots.</p>
          ) : (
            <ul>
              {topHotspots.map((h) => (
                <li key={h.file}>
                  <code>{h.file}</code> <span className="reviewer-pill">score {h.score}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

