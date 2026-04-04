import type { TrustFinding, TrustOutboundRow, TrustReviewResponse, TrustSeverity } from "./trustReview";

export interface OutboundGroup {
  endpoint_type: TrustOutboundRow["endpoint_type"];
  title: string;
  summary: string;
  rows: OutboundRowPresentation[];
}

export interface OutboundRowPresentation {
  row: TrustOutboundRow;
  destination: string;
  destination_detail?: string;
  category_label: string;
  payload_summary: string;
  payload_detail: string;
  event_count: number;
  is_high_signal: boolean;
  is_low_signal: boolean;
}

export interface TrustNarrative {
  takeaways: string[];
  next_steps: string[];
}

const HIGH_SIGNAL_DATA_CLASSES = new Set(["prompt", "memory", "file_content", "diff", "screenshot"]);

function rankSeverity(severity: TrustSeverity): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

export function hostFromEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.hostname || endpoint;
  } catch {
    return endpoint.length > 64 ? `${endpoint.slice(0, 61)}...` : endpoint;
  }
}

function endpointPath(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    return url.pathname && url.pathname !== "/" ? `${url.pathname}${url.search}` : undefined;
  } catch {
    return undefined;
  }
}

export function formatEndpointType(type: TrustOutboundRow["endpoint_type"]): string {
  switch (type) {
    case "model_api":
      return "Model API";
    case "error_reporting":
      return "Error reporting";
    case "policy":
      return "Policy";
    case "storage":
      return "Storage";
    case "telemetry":
      return "Telemetry";
    default:
      return "Unknown";
  }
}

function summarizeDataClasses(classes: string[]): string {
  if (classes.length === 0) return "unspecified payload";
  const normalized = [...new Set(classes)];
  if (normalized.length === 1) {
    const only = normalized[0];
    if (only === "session_metadata" || only === "metadata" || only === "usage") return "session metadata only";
    if (only === "prompt") return "prompt content";
    if (only === "memory") return "memory content";
    if (only === "diff") return "diff content";
    if (only === "file_content") return "file content";
  }
  const highSignal = normalized.filter((item) => HIGH_SIGNAL_DATA_CLASSES.has(item));
  if (highSignal.length > 0) {
    if (highSignal.length === 1) return `${highSignal[0].replace(/_/g, " ")} content`;
    return `${highSignal.slice(0, 2).map((item) => item.replace(/_/g, " ")).join(" and ")} content`;
  }
  return `${normalized.slice(0, 2).map((item) => item.replace(/_/g, " ")).join(", ")}${normalized.length > 2 ? ` +${normalized.length - 2}` : ""}`;
}

function contentVisibilityLabel(visibility: TrustOutboundRow["content_visibility"]): string {
  switch (visibility) {
    case "metadata_only":
      return "metadata only";
    case "summary":
      return "summary only";
    case "full":
      return "full content";
    default:
      return "unknown visibility";
  }
}

export function presentOutboundRow(row: TrustOutboundRow): OutboundRowPresentation {
  const destination = hostFromEndpoint(row.endpoint);
  const detail = endpointPath(row.endpoint);
  const highSignal = row.data_classes.some((item) => HIGH_SIGNAL_DATA_CLASSES.has(item));
  const lowSignal =
    row.endpoint_type === "telemetry" &&
    row.content_visibility === "metadata_only" &&
    !highSignal;
  return {
    row,
    destination,
    destination_detail: detail,
    category_label: formatEndpointType(row.endpoint_type),
    payload_summary: summarizeDataClasses(row.data_classes),
    payload_detail: `${contentVisibilityLabel(row.content_visibility)}${row.user_visible ? " · visible to user" : " · not user visible"}`,
    event_count: row.event_ids.length,
    is_high_signal: highSignal || row.risk_level === "high",
    is_low_signal: lowSignal,
  };
}

export function groupOutboundRows(rows: TrustOutboundRow[]): OutboundGroup[] {
  const grouped = new Map<TrustOutboundRow["endpoint_type"], OutboundRowPresentation[]>();
  for (const row of rows) {
    const presentation = presentOutboundRow(row);
    const list = grouped.get(row.endpoint_type) ?? [];
    list.push(presentation);
    grouped.set(row.endpoint_type, list);
  }

  const groups = [...grouped.entries()].map(([endpoint_type, groupRows]) => {
    groupRows.sort((a, b) => {
      const severity = rankSeverity(b.row.risk_level) - rankSeverity(a.row.risk_level);
      if (severity !== 0) return severity;
      if (Number(b.is_high_signal) !== Number(a.is_high_signal)) return Number(b.is_high_signal) - Number(a.is_high_signal);
      return b.event_count - a.event_count;
    });
    const highRiskCount = groupRows.filter((item) => item.row.risk_level === "high").length;
    const metadataOnlyCount = groupRows.filter((item) => item.row.content_visibility === "metadata_only").length;
    const title = formatEndpointType(endpoint_type);
    const summary =
      highRiskCount > 0
        ? `${highRiskCount} high-risk ${title.toLowerCase()} destination${highRiskCount === 1 ? "" : "s"}`
        : metadataOnlyCount > 0
          ? `${metadataOnlyCount} metadata-only ${title.toLowerCase()} destination${metadataOnlyCount === 1 ? "" : "s"}`
          : `${groupRows.length} ${title.toLowerCase()} destination${groupRows.length === 1 ? "" : "s"}`;
    return { endpoint_type, title, summary, rows: groupRows };
  });

  groups.sort((a, b) => {
    const aTop = a.rows[0];
    const bTop = b.rows[0];
    const severity = rankSeverity(bTop.row.risk_level) - rankSeverity(aTop.row.risk_level);
    if (severity !== 0) return severity;
    return b.rows.length - a.rows.length;
  });

  return groups;
}

function topFinding(findings: TrustFinding[]): TrustFinding | undefined {
  return [...findings].sort((a, b) => rankSeverity(b.severity) - rankSeverity(a.severity))[0];
}

export function deriveTrustNarrative(response: TrustReviewResponse): TrustNarrative {
  const takeaways: string[] = [];
  const nextSteps: string[] = [];

  const highestOutbound = [...response.outbound_matrix].sort((a, b) => {
    const severity = rankSeverity(b.risk_level) - rankSeverity(a.risk_level);
    if (severity !== 0) return severity;
    return b.event_ids.length - a.event_ids.length;
  })[0];
  const control = topFinding(response.control_surface);
  const transparency = topFinding(response.transparency_findings);

  if (highestOutbound) {
    takeaways.push(
      `${formatEndpointType(highestOutbound.endpoint_type)} destination ${hostFromEndpoint(highestOutbound.endpoint)} received ${summarizeDataClasses(highestOutbound.data_classes)}.`
    );
    nextSteps.push(`Inspect outbound destination ${hostFromEndpoint(highestOutbound.endpoint)} first.`);
  } else {
    takeaways.push("No outbound destinations were detected in this session.");
  }

  if (control) {
    takeaways.push(control.summary);
    nextSteps.push(`Review control finding: ${control.title}.`);
  } else {
    takeaways.push("No remote policy or control-surface findings were detected.");
  }

  if (transparency) {
    takeaways.push(transparency.summary);
    nextSteps.push(`Follow the top transparency finding: ${transparency.title}.`);
  } else {
    takeaways.push("No opaque prompt or transparency issues were detected.");
  }

  return {
    takeaways: takeaways.slice(0, 3),
    next_steps: nextSteps.slice(0, 3),
  };
}
