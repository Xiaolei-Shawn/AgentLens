import type { Session } from "../types/session";
import { EvidenceSourcePill } from "./EvidenceSourcePill";
import { getEventIndexById, type TrustSafetyModeResult } from "../lib/trustReview";

interface SafetyModesPanelProps {
  session: Session;
  modes?: TrustSafetyModeResult[];
  onSeek?: (index: number) => void;
}

const MODE_LABELS: Record<string, { title: string; description: string }> = {
  local_only: {
    title: "Local only",
    description: "Checks whether the session stayed local and avoided remote execution paths.",
  },
  no_telemetry: {
    title: "No telemetry",
    description: "Checks whether the session avoided analytics, crash reporting, and usage telemetry.",
  },
  no_remote_policy: {
    title: "No remote policy",
    description: "Checks whether remote policy, feature flag, or control-plane overrides were observed.",
  },
  no_silent_background_work: {
    title: "No silent background work",
    description: "Checks whether background jobs, watchers, or hidden subagents were active without user visibility.",
  },
  transparent_prompting: {
    title: "Transparent prompting",
    description: "Checks whether prompts, tools, or system instructions were changed without a visible explanation.",
  },
};

function formatModeTitle(id: string): string {
  return MODE_LABELS[id]?.title ?? id.replace(/[_-]+/g, " ");
}

function formatModeDescription(id: string): string {
  return (
    MODE_LABELS[id]?.description ??
    "User-facing safety check returned by the backend trust analysis."
  );
}

function ModeEvidenceChips({
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

export function SafetyModesPanel({ session, modes, onSeek }: SafetyModesPanelProps) {
  const list = modes ?? [];
  const passed = list.filter((mode) => mode.status === "pass").length;
  const failed = list.length - passed;
  const verdict =
    list.length === 0 ? "neutral" : failed > 0 ? "danger" : "live";

  return (
    <section className="trust-review__panel trust-review__panel--modes">
      <header className="trust-review__panel-head">
        <div>
          <p className="trust-review__eyebrow">Safety modes</p>
          <h3>User-facing trust checks</h3>
        </div>
        <span className={`trust-review__state-pill trust-review__state-pill--${verdict}`}>
          {list.length === 0 ? "Pending" : failed > 0 ? "Needs attention" : "Passed"}
        </span>
      </header>

      <p className="trust-review__panel-note trust-review__panel-note--wide">
        These checks turn the backend trust analysis into simple pass/fail signals for end users.
      </p>

      {list.length === 0 ? (
        <p className="trust-review__empty-inline">
          No safety mode verdicts were returned for this session yet.
        </p>
      ) : (
        <div className="trust-review__mode-list">
          {list.map((mode) => (
            <article className="trust-review__mode-card" key={mode.mode_id}>
              <div className="trust-review__mode-head">
                <div>
                  <h4>{mode.title || formatModeTitle(mode.mode_id)}</h4>
                  <p>{formatModeDescription(mode.mode_id)}</p>
                </div>
                <span
                  className={`trust-review__state-pill ${
                    mode.status === "pass"
                      ? "trust-review__state-pill--live"
                      : "trust-review__state-pill--danger"
                  }`}
                >
                  {mode.status === "pass" ? "Pass" : "Fail"}
                </span>
              </div>

              <p className="trust-review__graph-desc">{mode.summary}</p>

              <ul className="trust-review__mode-reasons">
                {mode.failure_reason_codes.length > 0 ? (
                  mode.failure_reason_codes.map((reason) => <li key={reason}>{reason}</li>)
                ) : (
                  <li>No failure reason codes were returned.</li>
                )}
              </ul>

              <EvidenceSourcePill
                source={mode.evidence_sources?.[0]}
                sources={mode.evidence_sources}
              />
              <ModeEvidenceChips session={session} eventIds={mode.event_ids} onSeek={onSeek} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
