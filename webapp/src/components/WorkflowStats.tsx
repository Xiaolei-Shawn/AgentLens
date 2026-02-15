import type { Session } from "../types/session";
import { formatEventLogLine } from "../lib/workflowHelpers";

import "./WorkflowStats.css";

interface WorkflowStatsProps {
  session: Session;
  /** Last N events to show in logs */
  logTail?: number;
}

function formatDuration(events: Session["events"]): string {
  if (events.length < 2) return "—";
  const first = events[0].ts ? new Date(events[0].ts).getTime() : 0;
  const last = events[events.length - 1].ts
    ? new Date(events[events.length - 1].ts).getTime()
    : 0;
  if (last <= first) return "—";
  const sec = (last - first) / 1000;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return m > 0 ? `${m}:${s.padStart(4, "0")} S` : `${s} S`;
}

export function WorkflowStats({ session, logTail = 8 }: WorkflowStatsProps) {
  const events = session.events;
  const totalRuntime = formatDuration(events);
  const logs = events.slice(-logTail).map((e, i) => ({
    index: events.length - logTail + i,
    line: formatEventLogLine(e, events.length - logTail + i),
  }));

  return (
    <div className="workflow-stats">
      <h3 className="workflow-stats__title">Workflow Stats</h3>
      <dl className="workflow-stats__grid">
        <dt>TOTAL EVENTS</dt>
        <dd>{events.length}</dd>
        <dt>RUNTIME</dt>
        <dd>{totalRuntime}</dd>
      </dl>
      <div className="workflow-stats__logs">
        <h4 className="workflow-stats__logs-title">Logs</h4>
        <ul className="workflow-stats__logs-list">
          {logs.map(({ index, line }) => (
            <li key={index} className="workflow-stats__log-line">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
