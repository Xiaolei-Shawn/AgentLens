import { randomUUID } from "node:crypto";
import * as z from "zod";
import type { CanonicalEvent } from "./event-envelope.js";
import {
  buildSessionLog,
  createEvent,
  createSession,
  endActiveSession,
  getActiveSession,
  ensureActiveSession,
  initializeSessionLog,
  persistEvent,
  setActiveIntent,
} from "./store.js";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

const actor = { type: "agent" as const };

const sessionStartSchema = z
  .object({
    goal: z.string().min(1),
    user_prompt: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
  })
  .strict();

const intentSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1).optional(),
    priority: z.number().optional(),
  })
  .strict();

const activitySchema = z
  .object({
    category: z.enum(["file", "tool", "search", "execution"]),
    action: z.string().min(1),
    target: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();

const decisionSchema = z
  .object({
    summary: z.string().min(1),
    rationale: z.string().optional(),
    options: z.array(z.string()).optional(),
    chosen_option: z.string().optional(),
    reversibility: z.enum(["easy", "medium", "hard"]).optional(),
  })
  .strict();

const assumptionSchema = z
  .object({
    statement: z.string().min(1),
    validated: z.union([z.boolean(), z.literal("unknown")]).optional(),
    risk: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

const verificationSchema = z
  .object({
    type: z.enum(["test", "lint", "typecheck", "manual"]),
    result: z.enum(["pass", "fail", "unknown"]),
    details: z.string().optional(),
  })
  .strict();

const sessionEndSchema = z
  .object({
    outcome: z.enum(["completed", "partial", "failed", "aborted"]),
    summary: z.string().optional(),
  })
  .strict();

const gatewayBeginSchema = z
  .object({
    goal: z.string().min(1),
    user_prompt: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    intent_title: z.string().min(1).optional(),
    intent_description: z.string().min(1).optional(),
    intent_priority: z.number().optional(),
  })
  .strict();

const gatewayActSchema = z
  .object({
    op: z.enum([
      "file",
      "tool",
      "search",
      "execution",
      "intent",
      "decision",
      "assumption",
      "verification",
    ]),
    action: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    details: z.record(z.unknown()).optional(),
    usage: z
      .object({
        model: z.string().min(1).optional(),
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
        estimated_cost_usd: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    intent: intentSchema.optional(),
    decision: decisionSchema.optional(),
    assumption: assumptionSchema.optional(),
    verification: verificationSchema.optional(),
    visibility: z.enum(["raw", "review", "debug"]).optional(),
  })
  .strict();

const gatewayEndSchema = sessionEndSchema;

export const GATEWAY_RULES = {
  file: {
    maps_to_tool: "record_activity",
    emits_kind: "file_op",
    required_fields: ["action"] as const,
    default_visibility: "raw" as const,
  },
  tool: {
    maps_to_tool: "record_activity",
    emits_kind: "tool_call",
    required_fields: ["action"] as const,
    default_visibility: "raw" as const,
  },
  search: {
    maps_to_tool: "record_activity",
    emits_kind: "tool_call",
    required_fields: ["action"] as const,
    default_visibility: "raw" as const,
  },
  execution: {
    maps_to_tool: "record_activity",
    emits_kind: "tool_call",
    required_fields: ["action"] as const,
    default_visibility: "raw" as const,
  },
  intent: {
    maps_to_tool: "record_intent",
    emits_kind: "intent",
    required_fields: ["intent.title"] as const,
    default_visibility: "review" as const,
  },
  decision: {
    maps_to_tool: "record_decision",
    emits_kind: "decision",
    required_fields: ["decision.summary"] as const,
    default_visibility: "review" as const,
  },
  assumption: {
    maps_to_tool: "record_assumption",
    emits_kind: "assumption",
    required_fields: ["assumption.statement"] as const,
    default_visibility: "review" as const,
  },
  verification: {
    maps_to_tool: "record_verification",
    emits_kind: "verification",
    required_fields: ["verification.type", "verification.result"] as const,
    default_visibility: "review" as const,
  },
} as const;

function textContent(value: unknown): ToolResponse {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorContent(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

async function appendCurrentSessionEvent(input: {
  kind: string;
  payload: Record<string, unknown>;
  scope?: {
    intent_id?: string;
    file?: string;
    module?: string;
  };
  visibility?: "raw" | "review" | "debug";
}): Promise<CanonicalEvent> {
  const state = ensureActiveSession();
  const event = createEvent(state, {
    session_id: state.session_id,
    kind: input.kind,
    actor,
    scope: input.scope,
    payload: input.payload,
    visibility: input.visibility,
  });
  await persistEvent(event);
  return event;
}

export async function handleRecordSessionStart(
  raw: z.infer<typeof sessionStartSchema>
): Promise<ToolResponse> {
  try {
    const args = sessionStartSchema.parse(raw);
    const state = createSession(args);
    initializeSessionLog(state);
    const event = createEvent(state, {
      session_id: state.session_id,
      kind: "session_start",
      actor,
      payload: {
        goal: args.goal,
        user_prompt: args.user_prompt,
        repo: args.repo,
        branch: args.branch,
      },
      visibility: "review",
    });
    await persistEvent(event);
    return textContent({
      session_id: state.session_id,
      event_id: event.id,
      seq: event.seq,
      ts: event.ts,
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordIntent(raw: z.infer<typeof intentSchema>): Promise<ToolResponse> {
  try {
    const args = intentSchema.parse(raw);
    const intentId = `intent_${Date.now()}_${randomUUID().slice(0, 8)}`;
    setActiveIntent(intentId);
    const event = await appendCurrentSessionEvent({
      kind: "intent",
      payload: {
        intent_id: intentId,
        title: args.title,
        description: args.description,
        priority: args.priority,
      },
      scope: { intent_id: intentId },
      visibility: "review",
    });
    return textContent({
      intent_id: intentId,
      event_id: event.id,
      seq: event.seq,
      ts: event.ts,
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordActivity(raw: z.infer<typeof activitySchema>): Promise<ToolResponse> {
  try {
    const args = activitySchema.parse(raw);
    const state = ensureActiveSession();
    const kind = args.category === "file" ? "file_op" : "tool_call";
    const scope = {
      intent_id: state.active_intent_id,
      file: args.category === "file" ? args.target : undefined,
      module:
        args.details && typeof args.details.module === "string"
          ? (args.details.module as string)
          : undefined,
    };

    const event = await appendCurrentSessionEvent({
      kind,
      payload: {
        category: args.category,
        action: args.action,
        target: args.target,
        details: args.details ?? {},
      },
      scope,
      visibility: "raw",
    });
    return textContent({
      event_id: event.id,
      kind: event.kind,
      seq: event.seq,
      ts: event.ts,
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordDecision(raw: z.infer<typeof decisionSchema>): Promise<ToolResponse> {
  try {
    const args = decisionSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "decision",
      payload: {
        summary: args.summary,
        rationale: args.rationale,
        options: args.options,
        chosen_option: args.chosen_option,
        reversibility: args.reversibility,
      },
      scope: { intent_id: state.active_intent_id },
      visibility: "review",
    });
    return textContent({
      event_id: event.id,
      seq: event.seq,
      ts: event.ts,
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordAssumption(
  raw: z.infer<typeof assumptionSchema>
): Promise<ToolResponse> {
  try {
    const args = assumptionSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "assumption",
      payload: {
        statement: args.statement,
        validated: args.validated ?? "unknown",
        risk: args.risk,
      },
      scope: { intent_id: state.active_intent_id },
      visibility: "review",
      });
    return textContent({
      event_id: event.id,
      seq: event.seq,
      ts: event.ts,
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordVerification(
  raw: z.infer<typeof verificationSchema>
): Promise<ToolResponse> {
  try {
    const args = verificationSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "verification",
      payload: {
        type: args.type,
        result: args.result,
        details: args.details,
      },
      scope: { intent_id: state.active_intent_id },
      visibility: "review",
    });
    return textContent({
      event_id: event.id,
      seq: event.seq,
      ts: event.ts,
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordSessionEnd(
  raw: z.infer<typeof sessionEndSchema>
): Promise<ToolResponse> {
  try {
    const args = sessionEndSchema.parse(raw);
    const state = ensureActiveSession();
    const event = createEvent(state, {
      session_id: state.session_id,
      kind: "session_end",
      actor,
      payload: {
        outcome: args.outcome,
        summary: args.summary,
      },
      visibility: "review",
    });
    await persistEvent(event);
    const ended = await endActiveSession(event.ts);
    const snapshot = buildSessionLog(ended, [event]);
    return textContent({
      session_id: ended.session_id,
      ended_at: ended.ended_at,
      final_event_id: event.id,
      seq: event.seq,
      outcome: args.outcome,
      note: "Events are persisted as JSONL per session in AL_SESSIONS_DIR.",
      session_log_preview: snapshot,
    });
  } catch (err) {
    return errorContent(err);
  }
}

function createIntentId(): string {
  return `intent_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

async function appendIntentEvent(input: z.infer<typeof intentSchema>): Promise<{ event: CanonicalEvent; intent_id: string }> {
  const intentId = createIntentId();
  setActiveIntent(intentId);
  const event = await appendCurrentSessionEvent({
    kind: "intent",
    payload: {
      intent_id: intentId,
      title: input.title,
      description: input.description,
      priority: input.priority,
    },
    scope: { intent_id: intentId },
    visibility: "review",
  });
  return { event, intent_id: intentId };
}

export async function handleGatewayBeginRun(
  raw: z.infer<typeof gatewayBeginSchema>
): Promise<ToolResponse> {
  try {
    const args = gatewayBeginSchema.parse(raw);
    let active = getActiveSession();
    let sessionStartEvent: CanonicalEvent | null = null;
    let reusedSession = false;

    if (!active || active.ended_at) {
      active = createSession({
        goal: args.goal,
        user_prompt: args.user_prompt,
        repo: args.repo,
        branch: args.branch,
      });
      initializeSessionLog(active);
      sessionStartEvent = createEvent(active, {
        session_id: active.session_id,
        kind: "session_start",
        actor,
        payload: {
          goal: args.goal,
          user_prompt: args.user_prompt,
          repo: args.repo,
          branch: args.branch,
        },
        visibility: "review",
      });
      await persistEvent(sessionStartEvent);
    } else {
      reusedSession = true;
    }

    let intent: { event: CanonicalEvent; intent_id: string } | null = null;
    if (args.intent_title) {
      intent = await appendIntentEvent({
        title: args.intent_title,
        description: args.intent_description,
        priority: args.intent_priority,
      });
    }

    return textContent({
      session_id: active.session_id,
      reused_session: reusedSession,
      start_event_id: sessionStartEvent?.id ?? null,
      start_seq: sessionStartEvent?.seq ?? null,
      intent_id: intent?.intent_id ?? active.active_intent_id ?? null,
      intent_event_id: intent?.event.id ?? null,
      rule_hint: "Use gateway_act for all subsequent operations.",
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleGatewayAct(raw: z.infer<typeof gatewayActSchema>): Promise<ToolResponse> {
  try {
    const args = gatewayActSchema.parse(raw);
    const state = ensureActiveSession();
    const rule = GATEWAY_RULES[args.op];
    const visibility = args.visibility ?? rule.default_visibility;
    const usagePayload = args.usage
      ? {
          model: args.usage.model,
          prompt_tokens: args.usage.prompt_tokens,
          completion_tokens: args.usage.completion_tokens,
          total_tokens: args.usage.total_tokens,
          estimated_cost_usd: args.usage.estimated_cost_usd,
        }
      : undefined;

    if (args.op === "intent") {
      if (!args.intent) throw new Error("op=intent requires `intent` payload.");
      const intent = await appendIntentEvent(args.intent);
      return textContent({
        mapped_tool: rule.maps_to_tool,
        event_id: intent.event.id,
        kind: intent.event.kind,
        seq: intent.event.seq,
        ts: intent.event.ts,
        intent_id: intent.intent_id,
      });
    }

    if (args.op === "decision") {
      if (!args.decision) throw new Error("op=decision requires `decision` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "decision",
        payload: {
          summary: args.decision.summary,
          rationale: args.decision.rationale,
          options: args.decision.options,
          chosen_option: args.decision.chosen_option,
          reversibility: args.decision.reversibility,
          usage: usagePayload,
        },
        scope: { intent_id: state.active_intent_id },
        visibility,
      });
      return textContent({
        mapped_tool: rule.maps_to_tool,
        event_id: event.id,
        kind: event.kind,
        seq: event.seq,
        ts: event.ts,
      });
    }

    if (args.op === "assumption") {
      if (!args.assumption) throw new Error("op=assumption requires `assumption` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "assumption",
        payload: {
          statement: args.assumption.statement,
          validated: args.assumption.validated ?? "unknown",
          risk: args.assumption.risk,
          usage: usagePayload,
        },
        scope: { intent_id: state.active_intent_id },
        visibility,
      });
      return textContent({
        mapped_tool: rule.maps_to_tool,
        event_id: event.id,
        kind: event.kind,
        seq: event.seq,
        ts: event.ts,
      });
    }

    if (args.op === "verification") {
      if (!args.verification) throw new Error("op=verification requires `verification` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "verification",
        payload: {
          type: args.verification.type,
          result: args.verification.result,
          details: args.verification.details,
          usage: usagePayload,
        },
        scope: { intent_id: state.active_intent_id },
        visibility,
      });
      return textContent({
        mapped_tool: rule.maps_to_tool,
        event_id: event.id,
        kind: event.kind,
        seq: event.seq,
        ts: event.ts,
      });
    }

    if (!args.action) {
      throw new Error(`op=${args.op} requires 'action'.`);
    }

    const kind = args.op === "file" ? "file_op" : "tool_call";
    const scope = {
      intent_id: state.active_intent_id,
      file: args.op === "file" ? args.target : undefined,
      module:
        args.details && typeof args.details.module === "string"
          ? (args.details.module as string)
          : undefined,
    };
    const event = await appendCurrentSessionEvent({
      kind,
      payload: {
        category: args.op,
        action: args.action,
        target: args.target,
        details: args.details ?? {},
        usage: usagePayload,
      },
      scope,
      visibility,
    });

    let verificationEvent: CanonicalEvent | null = null;
    if (args.verification) {
      verificationEvent = await appendCurrentSessionEvent({
        kind: "verification",
        payload: {
          type: args.verification.type,
          result: args.verification.result,
          details: args.verification.details,
          usage: usagePayload,
        },
        scope: { intent_id: state.active_intent_id },
        visibility: "review",
      });
    }

    return textContent({
      mapped_tool: rule.maps_to_tool,
      event_id: event.id,
      kind: event.kind,
      seq: event.seq,
      ts: event.ts,
      verification_event_id: verificationEvent?.id ?? null,
      usage: usagePayload ?? null,
    });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleGatewayEndRun(
  raw: z.infer<typeof gatewayEndSchema>
): Promise<ToolResponse> {
  try {
    const active = getActiveSession();
    if (!active || active.ended_at) {
      return textContent({
        ended: false,
        reason: "No active session to close.",
      });
    }
    return handleRecordSessionEnd(gatewayEndSchema.parse(raw));
  } catch (err) {
    return errorContent(err);
  }
}

export const toolSchemas = {
  record_session_start: { inputSchema: sessionStartSchema.shape },
  record_intent: { inputSchema: intentSchema.shape },
  record_activity: { inputSchema: activitySchema.shape },
  record_decision: { inputSchema: decisionSchema.shape },
  record_assumption: { inputSchema: assumptionSchema.shape },
  record_verification: { inputSchema: verificationSchema.shape },
  record_session_end: { inputSchema: sessionEndSchema.shape },
  gateway_begin_run: { inputSchema: gatewayBeginSchema.shape },
  gateway_act: { inputSchema: gatewayActSchema.shape },
  gateway_end_run: { inputSchema: gatewayEndSchema.shape },
} as const;

export const EVENT_EXAMPLES = {
  record_session_start: {
    id: "sess_1739620000000_abcd1234:1:a1b2c3d4",
    session_id: "sess_1739620000000_abcd1234",
    seq: 1,
    ts: "2026-02-15T20:00:00.000Z",
    kind: "session_start",
    actor: { type: "agent" },
    payload: {
      goal: "Add robust audit logging",
      user_prompt: "Refactor tools to canonical event model",
      repo: "AL/mcp-server",
      branch: "codex/refactor-audit-tools",
    },
    visibility: "review",
    schema_version: 1,
  } satisfies CanonicalEvent,
  record_intent: {
    id: "sess_1739620000000_abcd1234:2:e5f6a7b8",
    session_id: "sess_1739620000000_abcd1234",
    seq: 2,
    ts: "2026-02-15T20:00:10.000Z",
    kind: "intent",
    actor: { type: "agent" },
    scope: { intent_id: "intent_1739620010000_1122aabb" },
    payload: {
      intent_id: "intent_1739620010000_1122aabb",
      title: "Replace old MCP tools",
      description: "Converge to 7 semantic tools",
      priority: 1,
    },
    visibility: "review",
    schema_version: 1,
  } satisfies CanonicalEvent,
  record_activity: {
    id: "sess_1739620000000_abcd1234:3:c9d0e1f2",
    session_id: "sess_1739620000000_abcd1234",
    seq: 3,
    ts: "2026-02-15T20:00:20.000Z",
    kind: "file_op",
    actor: { type: "agent" },
    scope: {
      intent_id: "intent_1739620010000_1122aabb",
      file: "src/tools.ts",
      module: "tools",
    },
    payload: {
      category: "file",
      action: "edit",
      target: "src/tools.ts",
      details: { lines_changed: 120, module: "tools" },
    },
    visibility: "raw",
    schema_version: 1,
  } satisfies CanonicalEvent,
  record_decision: {
    id: "sess_1739620000000_abcd1234:4:3344ccdd",
    session_id: "sess_1739620000000_abcd1234",
    seq: 4,
    ts: "2026-02-15T20:00:30.000Z",
    kind: "decision",
    actor: { type: "agent" },
    scope: { intent_id: "intent_1739620010000_1122aabb" },
    payload: {
      summary: "Use JSONL for append-only persistence",
      rationale: "Reduces corruption risk and preserves ordering",
      options: ["single JSON rewrite", "JSONL append-only"],
      chosen_option: "JSONL append-only",
      reversibility: "easy",
    },
    visibility: "review",
    schema_version: 1,
  } satisfies CanonicalEvent,
  record_assumption: {
    id: "sess_1739620000000_abcd1234:5:99aabbcc",
    session_id: "sess_1739620000000_abcd1234",
    seq: 5,
    ts: "2026-02-15T20:00:40.000Z",
    kind: "assumption",
    actor: { type: "agent" },
    scope: { intent_id: "intent_1739620010000_1122aabb" },
    payload: {
      statement: "Single active session is sufficient for one agent run",
      validated: "unknown",
      risk: "medium",
    },
    visibility: "review",
    schema_version: 1,
  } satisfies CanonicalEvent,
  record_verification: {
    id: "sess_1739620000000_abcd1234:6:77dd8899",
    session_id: "sess_1739620000000_abcd1234",
    seq: 6,
    ts: "2026-02-15T20:00:50.000Z",
    kind: "verification",
    actor: { type: "agent" },
    scope: { intent_id: "intent_1739620010000_1122aabb" },
    payload: {
      type: "test",
      result: "pass",
      details: "npm run build",
    },
    visibility: "review",
    schema_version: 1,
  } satisfies CanonicalEvent,
  record_session_end: {
    id: "sess_1739620000000_abcd1234:7:44ee66ff",
    session_id: "sess_1739620000000_abcd1234",
    seq: 7,
    ts: "2026-02-15T20:01:00.000Z",
    kind: "session_end",
    actor: { type: "agent" },
    payload: {
      outcome: "completed",
      summary: "Tool model refactor finished",
    },
    visibility: "review",
    schema_version: 1,
  } satisfies CanonicalEvent,
} as const;

export const AGENT_INSTRUCTIONS = [
  "Preferred low-friction path: call gateway_begin_run once, gateway_act for every operation, then gateway_end_run once.",
  "Call record_session_start once before any other tool.",
  "Call record_intent whenever objective shifts; use one intent per cohesive chunk.",
  "Use record_activity for every meaningful file/tool/search/execution step.",
  "Use record_decision for irreversible or high-impact choices.",
  "Use record_assumption for uncertain premises that affect implementation.",
  "Use record_verification for tests/lint/typecheck/manual checks with explicit result.",
  "Call record_session_end exactly once to close the session.",
] as const;
