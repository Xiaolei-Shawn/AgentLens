import type { SessionEvent } from "../types/session";

export type ContextNodeType = "source" | "reasoning" | "decision" | "outcome";

export interface ContextNode {
  id: string;
  type: ContextNodeType;
  eventIndex: number;
  intentId?: string;
  label: string;
  detail?: string;
}

export interface ContextLink {
  from: string;
  to: string;
  reason: string;
}

export interface ContextPathModel {
  nodes: ContextNode[];
  links: ContextLink[];
  byType: Record<ContextNodeType, ContextNode[]>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function truncate(text: string, max = 180): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function readDetailsObject(event: SessionEvent): Record<string, unknown> {
  const details = event.payload?.details;
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

function detailFromEvent(event: SessionEvent): string | undefined {
  if (event.kind === "tool_call") {
    const details = readDetailsObject(event);
    const commands = asStringArray(details.commands);
    if (commands.length > 0) return truncate(commands.join(" | "), 220);
    const targets = asStringArray(details.targets);
    if (targets.length > 0) return truncate(`targets: ${targets.join(", ")}`, 220);
    const target = asString(event.payload.target);
    if (target) return truncate(target, 220);
    const action = asString(event.payload.action);
    return action ? truncate(action, 220) : undefined;
  }
  if (event.kind === "artifact_created") {
    const summary =
      asString(event.payload.summary) ?? asString(event.payload.title) ?? asString(event.payload.text);
    return summary ? truncate(summary, 220) : undefined;
  }
  if (event.kind === "decision") {
    const rationale = asString(event.payload.rationale) ?? asString(event.payload.summary);
    return rationale ? truncate(rationale, 220) : undefined;
  }
  if (event.kind === "file_op") {
    const target = asString(event.payload.target) ?? asString(event.scope?.file);
    return target ? truncate(target, 220) : undefined;
  }
  return undefined;
}

function labelFromEvent(event: SessionEvent): string {
  if (event.kind === "tool_call") {
    const category = asString(event.payload.category) ?? "tool";
    const action = asString(event.payload.action) ?? "context step";
    const details = readDetailsObject(event);
    const targets = asStringArray(details.targets);
    const commands = asStringArray(details.commands);
    if (commands.length > 0) return `${category}: ${truncate(commands[0], 96)}`;
    if (targets.length > 0) return `${category}: ${truncate(targets[0], 96)}`;
    return `${category}: ${truncate(action, 96)}`;
  }
  if (event.kind === "artifact_created") {
    const artifactType = asString(event.payload.artifact_type) ?? "artifact";
    const title = asString(event.payload.title) ?? asString(event.payload.summary) ?? asString(event.payload.text);
    return `${artifactType}: ${truncate(title ?? "Reasoning artifact", 96)}`;
  }
  if (event.kind === "decision") return asString(event.payload.summary) ?? "Decision";
  if (event.kind === "file_op") {
    const action = asString(event.payload.action) ?? "edit";
    const target = asString(event.payload.target) ?? asString(event.scope?.file) ?? "(unknown path)";
    return `${action}: ${truncate(target, 96)}`;
  }
  return event.kind;
}

function intentIdOf(event: SessionEvent): string | undefined {
  return asString(event.scope?.intent_id) ?? asString(event.payload.intent_id);
}

function makeNode(type: ContextNodeType, event: SessionEvent, eventIndex: number): ContextNode {
  return {
    id: `${type}:${event.id}`,
    type,
    eventIndex,
    intentId: intentIdOf(event),
    label: labelFromEvent(event),
    detail: detailFromEvent(event),
  };
}

function nearestPriorNode(
  nodes: ContextNode[],
  targetEventIndex: number,
  intentId: string | undefined
): ContextNode | undefined {
  let fallback: ContextNode | undefined;
  for (const node of nodes) {
    if (node.eventIndex >= targetEventIndex) continue;
    if (intentId && node.intentId && node.intentId !== intentId) continue;
    fallback = node;
  }
  return fallback;
}

export function deriveContextPath(events: SessionEvent[]): ContextPathModel {
  const nodes: ContextNode[] = [];
  const links: ContextLink[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.kind === "tool_call") {
      const category = asString(event.payload.category);
      if (category === "search" || category === "tool" || category === "execution") {
        nodes.push(makeNode("source", event, i));
      }
      continue;
    }
    if (event.kind === "artifact_created") {
      nodes.push(makeNode("reasoning", event, i));
      continue;
    }
    if (event.kind === "decision") {
      nodes.push(makeNode("decision", event, i));
      continue;
    }
    if (event.kind === "file_op") {
      nodes.push(makeNode("outcome", event, i));
    }
  }

  const sources = nodes.filter((node) => node.type === "source");
  const reasoning = nodes.filter((node) => node.type === "reasoning");
  const decisions = nodes.filter((node) => node.type === "decision");
  const outcomes = nodes.filter((node) => node.type === "outcome");

  for (const node of reasoning) {
    const source = nearestPriorNode(sources, node.eventIndex, node.intentId);
    if (!source) continue;
    links.push({ from: source.id, to: node.id, reason: "Context interpreted" });
  }

  for (const node of decisions) {
    const input = nearestPriorNode([...reasoning, ...sources], node.eventIndex, node.intentId);
    if (!input) continue;
    links.push({ from: input.id, to: node.id, reason: "Informed decision" });
  }

  for (const node of outcomes) {
    const priorDecision = nearestPriorNode(decisions, node.eventIndex, node.intentId);
    if (priorDecision) {
      links.push({ from: priorDecision.id, to: node.id, reason: "Implemented via file change" });
      continue;
    }
    const priorContext = nearestPriorNode([...reasoning, ...sources], node.eventIndex, node.intentId);
    if (!priorContext) continue;
    links.push({ from: priorContext.id, to: node.id, reason: "Context led to file change" });
  }

  return {
    nodes,
    links,
    byType: {
      source: sources,
      reasoning,
      decision: decisions,
      outcome: outcomes,
    },
  };
}
