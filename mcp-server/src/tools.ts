import { randomUUID } from "node:crypto";
import * as z from "zod";
import type { CanonicalEvent } from "@al/schema/event-envelope";
import {
  buildSessionLog,
  createEvent,
  createSession,
  endActiveSession,
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

export const toolSchemas = {
  record_session_start: { inputSchema: sessionStartSchema.shape },
  record_intent: { inputSchema: intentSchema.shape },
  record_activity: { inputSchema: activitySchema.shape },
  record_decision: { inputSchema: decisionSchema.shape },
  record_assumption: { inputSchema: assumptionSchema.shape },
  record_verification: { inputSchema: verificationSchema.shape },
  record_session_end: { inputSchema: sessionEndSchema.shape },
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
  "Call record_session_start once before any other tool.",
  "Call record_intent whenever objective shifts; use one intent per cohesive chunk.",
  "Use record_activity for every meaningful file/tool/search/execution step.",
  "Use record_decision for irreversible or high-impact choices.",
  "Use record_assumption for uncertain premises that affect implementation.",
  "Use record_verification for tests/lint/typecheck/manual checks with explicit result.",
  "Call record_session_end exactly once to close the session.",
] as const;
