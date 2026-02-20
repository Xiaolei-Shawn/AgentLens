import { randomUUID } from "node:crypto";
import * as z from "zod";
import type { CanonicalEvent, EventKind, EventVisibility } from "./event-envelope.js";
import {
  buildSessionLog,
  createEvent,
  createSession,
  endActiveSession,
  getActiveSession,
  ensureActiveSession,
  initializeSessionLog,
  persistEvent,
  persistNormalizedSnapshot,
  setActiveIntent,
} from "./store.js";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

const actor = { type: "agent" as const };
const AUTO_GOAL = process.env.AL_AUTO_GOAL ?? "Agent task execution";
const AUTO_PROMPT = process.env.AL_AUTO_USER_PROMPT ?? "Auto-instrumented run";

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

const artifactCreatedSchema = z
  .object({
    artifact_type: z.enum(["file", "patch", "report", "pr", "migration", "test", "build", "other"]),
    title: z.string().min(1),
    path: z.string().min(1).optional(),
    url: z.string().url().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();

const intentTransitionSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    reason: z.string().optional(),
  })
  .strict();

const riskSignalSchema = z
  .object({
    level: z.enum(["low", "medium", "high"]),
    reasons: z.array(z.string().min(1)).min(1),
    files: z.array(z.string().min(1)).optional(),
    modules: z.array(z.string().min(1)).optional(),
    mitigation_hint: z.string().optional(),
  })
  .strict();

const verificationRunSchema = z
  .object({
    run_type: z.enum(["test", "lint", "typecheck", "manual", "build"]),
    status: z.enum(["started", "completed", "failed"]),
    command: z.string().min(1).optional(),
    scope: z.string().optional(),
    result: z.enum(["pass", "fail", "unknown"]).optional(),
    duration_ms: z.number().nonnegative().optional(),
  })
  .strict();

const diffSummarySchema = z
  .object({
    file: z.string().min(1),
    lines_added: z.number().int().nonnegative().optional(),
    lines_removed: z.number().int().nonnegative().optional(),
    public_api_changed: z.boolean().optional(),
    dependency_changed: z.boolean().optional(),
    schema_changed: z.boolean().optional(),
  })
  .strict();

const decisionLinkSchema = z
  .object({
    decision_event_id: z.string().min(1),
    summary: z.string().min(1),
    affected_files: z.array(z.string().min(1)).optional(),
    related_event_ids: z.array(z.string().min(1)).optional(),
  })
  .strict();

const assumptionLifecycleSchema = z
  .object({
    statement: z.string().min(1),
    state: z.enum(["created", "validated", "invalidated", "unresolved"]),
    risk: z.enum(["low", "medium", "high"]).optional(),
    related_files: z.array(z.string().min(1)).optional(),
    details: z.string().optional(),
  })
  .strict();

const blockerSchema = z
  .object({
    code: z.string().min(1),
    summary: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]).default("medium"),
    resolved: z.boolean().optional(),
    resolution: z.string().optional(),
  })
  .strict();

const tokenUsageCheckpointSchema = z
  .object({
    category: z.string().optional(),
    model: z.string().optional(),
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    estimated_cost_usd: z.number().nonnegative().optional(),
  })
  .strict();

const sessionQualitySchema = z
  .object({
    score: z.number().min(0).max(100),
    verification_coverage: z.enum(["none", "partial", "full"]).optional(),
    unresolved_risks: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
  })
  .strict();

const replayBookmarkSchema = z
  .object({
    label: z.string().min(1),
    event_id: z.string().optional(),
    seq: z.number().int().positive().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    reason: z.string().optional(),
  })
  .strict();

const hotspotSchema = z
  .object({
    file: z.string().min(1),
    score: z.number().nonnegative(),
    reasons: z.array(z.string().min(1)).optional(),
    module: z.string().optional(),
    edit_count: z.number().int().nonnegative().optional(),
    lines_changed: z.number().int().nonnegative().optional(),
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
      "artifact_created",
      "intent_transition",
      "risk_signal",
      "verification_run",
      "diff_summary",
      "decision_link",
      "assumption_lifecycle",
      "blocker",
      "token_usage_checkpoint",
      "session_quality",
      "replay_bookmark",
      "hotspot",
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
    artifact_created: artifactCreatedSchema.optional(),
    intent_transition: intentTransitionSchema.optional(),
    risk_signal: riskSignalSchema.optional(),
    verification_run: verificationRunSchema.optional(),
    diff_summary: diffSummarySchema.optional(),
    decision_link: decisionLinkSchema.optional(),
    assumption_lifecycle: assumptionLifecycleSchema.optional(),
    blocker: blockerSchema.optional(),
    token_usage_checkpoint: tokenUsageCheckpointSchema.optional(),
    session_quality: sessionQualitySchema.optional(),
    replay_bookmark: replayBookmarkSchema.optional(),
    hotspot: hotspotSchema.optional(),
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
  artifact_created: {
    maps_to_tool: "record_artifact_created",
    emits_kind: "artifact_created",
    required_fields: ["artifact_created.title"] as const,
    default_visibility: "review" as const,
  },
  intent_transition: {
    maps_to_tool: "record_intent_transition",
    emits_kind: "intent_transition",
    required_fields: ["intent_transition.from", "intent_transition.to"] as const,
    default_visibility: "review" as const,
  },
  risk_signal: {
    maps_to_tool: "record_risk_signal",
    emits_kind: "risk_signal",
    required_fields: ["risk_signal.level", "risk_signal.reasons"] as const,
    default_visibility: "review" as const,
  },
  verification_run: {
    maps_to_tool: "record_verification_run",
    emits_kind: "verification_run",
    required_fields: ["verification_run.run_type", "verification_run.status"] as const,
    default_visibility: "review" as const,
  },
  diff_summary: {
    maps_to_tool: "record_diff_summary",
    emits_kind: "diff_summary",
    required_fields: ["diff_summary.file"] as const,
    default_visibility: "raw" as const,
  },
  decision_link: {
    maps_to_tool: "record_decision_link",
    emits_kind: "decision_link",
    required_fields: ["decision_link.decision_event_id", "decision_link.summary"] as const,
    default_visibility: "review" as const,
  },
  assumption_lifecycle: {
    maps_to_tool: "record_assumption_lifecycle",
    emits_kind: "assumption_lifecycle",
    required_fields: ["assumption_lifecycle.statement", "assumption_lifecycle.state"] as const,
    default_visibility: "review" as const,
  },
  blocker: {
    maps_to_tool: "record_blocker",
    emits_kind: "blocker",
    required_fields: ["blocker.code", "blocker.summary"] as const,
    default_visibility: "review" as const,
  },
  token_usage_checkpoint: {
    maps_to_tool: "record_token_usage_checkpoint",
    emits_kind: "token_usage_checkpoint",
    required_fields: [] as const,
    default_visibility: "raw" as const,
  },
  session_quality: {
    maps_to_tool: "record_session_quality",
    emits_kind: "session_quality",
    required_fields: ["session_quality.score"] as const,
    default_visibility: "review" as const,
  },
  replay_bookmark: {
    maps_to_tool: "record_replay_bookmark",
    emits_kind: "replay_bookmark",
    required_fields: ["replay_bookmark.label"] as const,
    default_visibility: "review" as const,
  },
  hotspot: {
    maps_to_tool: "record_hotspot",
    emits_kind: "hotspot",
    required_fields: ["hotspot.file", "hotspot.score"] as const,
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
  kind: EventKind;
  payload: Record<string, unknown>;
  scope?: {
    intent_id?: string;
    file?: string;
    module?: string;
  };
  visibility?: EventVisibility;
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

async function ensureGatewaySession(): Promise<ReturnType<typeof ensureActiveSession>> {
  const active = getActiveSession();
  if (active && !active.ended_at) return active;
  const state = createSession({
    goal: AUTO_GOAL,
    user_prompt: AUTO_PROMPT,
    repo: process.env.AL_AUTO_REPO,
    branch: process.env.AL_AUTO_BRANCH,
  });
  initializeSessionLog(state);
  const event = createEvent(state, {
    session_id: state.session_id,
    kind: "session_start",
    actor,
    payload: {
      goal: state.goal,
      user_prompt: state.user_prompt,
      repo: state.repo,
      branch: state.branch,
      auto_created: true,
    },
    visibility: "review",
  });
  await persistEvent(event);
  return state;
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

export async function handleRecordArtifactCreated(
  raw: z.infer<typeof artifactCreatedSchema>
): Promise<ToolResponse> {
  try {
    const args = artifactCreatedSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "artifact_created",
      payload: {
        artifact_type: args.artifact_type,
        title: args.title,
        path: args.path,
        url: args.url,
        details: args.details ?? {},
      },
      scope: { intent_id: state.active_intent_id, file: args.path },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordIntentTransition(
  raw: z.infer<typeof intentTransitionSchema>
): Promise<ToolResponse> {
  try {
    const args = intentTransitionSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "intent_transition",
      payload: args,
      scope: { intent_id: state.active_intent_id },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordRiskSignal(
  raw: z.infer<typeof riskSignalSchema>
): Promise<ToolResponse> {
  try {
    const args = riskSignalSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "risk_signal",
      payload: {
        level: args.level,
        reasons: args.reasons,
        files: args.files ?? [],
        modules: args.modules ?? [],
        mitigation_hint: args.mitigation_hint,
      },
      scope: {
        intent_id: state.active_intent_id,
        file: args.files?.[0],
        module: args.modules?.[0],
      },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordVerificationRun(
  raw: z.infer<typeof verificationRunSchema>
): Promise<ToolResponse> {
  try {
    const args = verificationRunSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "verification_run",
      payload: args,
      scope: { intent_id: state.active_intent_id, module: args.scope },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordDiffSummary(
  raw: z.infer<typeof diffSummarySchema>
): Promise<ToolResponse> {
  try {
    const args = diffSummarySchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "diff_summary",
      payload: args,
      scope: { intent_id: state.active_intent_id, file: args.file },
      visibility: "raw",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordDecisionLink(
  raw: z.infer<typeof decisionLinkSchema>
): Promise<ToolResponse> {
  try {
    const args = decisionLinkSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "decision_link",
      payload: args,
      scope: { intent_id: state.active_intent_id, file: args.affected_files?.[0] },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordAssumptionLifecycle(
  raw: z.infer<typeof assumptionLifecycleSchema>
): Promise<ToolResponse> {
  try {
    const args = assumptionLifecycleSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "assumption_lifecycle",
      payload: args,
      scope: { intent_id: state.active_intent_id, file: args.related_files?.[0] },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordBlocker(raw: z.infer<typeof blockerSchema>): Promise<ToolResponse> {
  try {
    const args = blockerSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "blocker",
      payload: args,
      scope: { intent_id: state.active_intent_id },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordTokenUsageCheckpoint(
  raw: z.infer<typeof tokenUsageCheckpointSchema>
): Promise<ToolResponse> {
  try {
    const args = tokenUsageCheckpointSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "token_usage_checkpoint",
      payload: args,
      scope: { intent_id: state.active_intent_id, module: args.category },
      visibility: "raw",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordSessionQuality(
  raw: z.infer<typeof sessionQualitySchema>
): Promise<ToolResponse> {
  try {
    const args = sessionQualitySchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "session_quality",
      payload: args,
      scope: { intent_id: state.active_intent_id },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordReplayBookmark(
  raw: z.infer<typeof replayBookmarkSchema>
): Promise<ToolResponse> {
  try {
    const args = replayBookmarkSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "replay_bookmark",
      payload: args,
      scope: { intent_id: state.active_intent_id },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
  } catch (err) {
    return errorContent(err);
  }
}

export async function handleRecordHotspot(raw: z.infer<typeof hotspotSchema>): Promise<ToolResponse> {
  try {
    const args = hotspotSchema.parse(raw);
    const state = ensureActiveSession();
    const event = await appendCurrentSessionEvent({
      kind: "hotspot",
      payload: args,
      scope: { intent_id: state.active_intent_id, file: args.file, module: args.module },
      visibility: "review",
    });
    return textContent({ event_id: event.id, seq: event.seq, ts: event.ts });
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
    const normalized = await persistNormalizedSnapshot(ended);
    const snapshot = buildSessionLog(ended, [event]);
    return textContent({
      session_id: ended.session_id,
      ended_at: ended.ended_at,
      final_event_id: event.id,
      seq: event.seq,
      outcome: args.outcome,
      note: "Events are persisted as JSONL per session in AL_SESSIONS_DIR.",
      session_log_preview: snapshot,
      normalized_snapshot: normalized,
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
    const state = await ensureGatewaySession();
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

    if (args.op === "artifact_created") {
      if (!args.artifact_created) throw new Error("op=artifact_created requires `artifact_created` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "artifact_created",
        payload: args.artifact_created,
        scope: {
          intent_id: state.active_intent_id,
          file: args.artifact_created.path,
        },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "intent_transition") {
      if (!args.intent_transition) throw new Error("op=intent_transition requires `intent_transition` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "intent_transition",
        payload: args.intent_transition,
        scope: { intent_id: state.active_intent_id },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "risk_signal") {
      if (!args.risk_signal) throw new Error("op=risk_signal requires `risk_signal` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "risk_signal",
        payload: args.risk_signal,
        scope: {
          intent_id: state.active_intent_id,
          file: args.risk_signal.files?.[0],
          module: args.risk_signal.modules?.[0],
        },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "verification_run") {
      if (!args.verification_run) throw new Error("op=verification_run requires `verification_run` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "verification_run",
        payload: args.verification_run,
        scope: { intent_id: state.active_intent_id, module: args.verification_run.scope },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "diff_summary") {
      if (!args.diff_summary) throw new Error("op=diff_summary requires `diff_summary` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "diff_summary",
        payload: args.diff_summary,
        scope: { intent_id: state.active_intent_id, file: args.diff_summary.file },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "decision_link") {
      if (!args.decision_link) throw new Error("op=decision_link requires `decision_link` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "decision_link",
        payload: args.decision_link,
        scope: { intent_id: state.active_intent_id, file: args.decision_link.affected_files?.[0] },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "assumption_lifecycle") {
      if (!args.assumption_lifecycle) throw new Error("op=assumption_lifecycle requires `assumption_lifecycle` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "assumption_lifecycle",
        payload: args.assumption_lifecycle,
        scope: { intent_id: state.active_intent_id, file: args.assumption_lifecycle.related_files?.[0] },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "blocker") {
      if (!args.blocker) throw new Error("op=blocker requires `blocker` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "blocker",
        payload: args.blocker,
        scope: { intent_id: state.active_intent_id },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "token_usage_checkpoint") {
      if (!args.token_usage_checkpoint) throw new Error("op=token_usage_checkpoint requires `token_usage_checkpoint` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "token_usage_checkpoint",
        payload: args.token_usage_checkpoint,
        scope: { intent_id: state.active_intent_id, module: args.token_usage_checkpoint.category },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "session_quality") {
      if (!args.session_quality) throw new Error("op=session_quality requires `session_quality` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "session_quality",
        payload: args.session_quality,
        scope: { intent_id: state.active_intent_id },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "replay_bookmark") {
      if (!args.replay_bookmark) throw new Error("op=replay_bookmark requires `replay_bookmark` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "replay_bookmark",
        payload: args.replay_bookmark,
        scope: { intent_id: state.active_intent_id },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (args.op === "hotspot") {
      if (!args.hotspot) throw new Error("op=hotspot requires `hotspot` payload.");
      const event = await appendCurrentSessionEvent({
        kind: "hotspot",
        payload: args.hotspot,
        scope: { intent_id: state.active_intent_id, file: args.hotspot.file, module: args.hotspot.module },
        visibility,
      });
      return textContent({ mapped_tool: rule.maps_to_tool, event_id: event.id, kind: event.kind, seq: event.seq, ts: event.ts });
    }

    if (!args.action) {
      throw new Error(`op=${args.op} requires 'action'.`);
    }

    if (!state.active_intent_id) {
      const intent = await appendIntentEvent({
        title: `Auto intent: ${args.op} ${args.action}`.trim(),
        description: "Created automatically by gateway_act",
      });
      setActiveIntent(intent.intent_id);
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
  record_artifact_created: { inputSchema: artifactCreatedSchema.shape },
  record_intent_transition: { inputSchema: intentTransitionSchema.shape },
  record_risk_signal: { inputSchema: riskSignalSchema.shape },
  record_verification_run: { inputSchema: verificationRunSchema.shape },
  record_diff_summary: { inputSchema: diffSummarySchema.shape },
  record_decision_link: { inputSchema: decisionLinkSchema.shape },
  record_assumption_lifecycle: { inputSchema: assumptionLifecycleSchema.shape },
  record_blocker: { inputSchema: blockerSchema.shape },
  record_token_usage_checkpoint: { inputSchema: tokenUsageCheckpointSchema.shape },
  record_session_quality: { inputSchema: sessionQualitySchema.shape },
  record_replay_bookmark: { inputSchema: replayBookmarkSchema.shape },
  record_hotspot: { inputSchema: hotspotSchema.shape },
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
