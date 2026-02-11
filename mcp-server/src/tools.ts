/**
 * MCP tool implementations: health, record_*, file_op (record + execute), record_plan, audit_event, flush_sessions, list_sessions.
 */

import * as z from "zod";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import {
  ensureSession,
  appendEvent,
  markCompleted,
  getSession,
  getCompletedSessions,
} from "./store.js";
import { flushSession } from "./flush.js";
import { listSessions } from "./list-sessions.js";
import { getWorkspaceRoot, resolveWithinWorkspace } from "./config.js";
import type { SessionEvent } from "@al/schema/session-schema";

// ——— Tool input schemas (Zod) ———

const sessionStartSchema = {
  session_id: z.string(),
  started_at: z.string().optional(),
  title: z.string(),
  user_message: z.string(),
};

const planStepSchema = {
  session_id: z.string(),
  step: z.string(),
  index: z.number().optional(),
  at: z.string().optional(),
};

const fileEditSchema = {
  session_id: z.string(),
  path: z.string(),
  old_content: z.string().optional(),
  new_content: z.string().optional(),
  at: z.string().optional(),
};

const fileCreateSchema = {
  session_id: z.string(),
  path: z.string(),
  content: z.string().optional(),
  at: z.string().optional(),
};

const fileDeleteSchema = {
  session_id: z.string(),
  path: z.string(),
  at: z.string().optional(),
};

const deliverableSchema = {
  session_id: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  at: z.string().optional(),
};

const toolCallSchema = {
  session_id: z.string(),
  name: z.string(),
  args: z.unknown().optional(),
  result: z.unknown().optional(),
  at: z.string().optional(),
};

const sessionEndSchema = {
  session_id: z.string(),
};

/** Gateway tool: record + execute. Action create | edit | delete. */
const fileOpSchema = {
  session_id: z.string(),
  path: z.string(),
  action: z.enum(["create", "edit", "delete"]),
  content: z.string().optional(),
};

/** Batch plan steps for Story view; links future file_ops to step indices. */
const recordPlanSchema = {
  session_id: z.string(),
  steps: z.array(z.string()),
};

/** Non-file events: decisions, milestones, notes. */
const auditEventSchema = {
  session_id: z.string(),
  type: z.string(),
  description: z.string(),
  at: z.string().optional(),
};

// ——— Helpers ———

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorContent(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true as const };
}

// ——— Handlers ———

export async function handleHealth(): Promise<{ content: { type: "text"; text: string }[] }> {
  return textContent(JSON.stringify({ status: "ok", service: "al-mcp", timestamp: new Date().toISOString() }));
}

export async function handleRecordSessionStart(args: z.infer<z.ZodObject<typeof sessionStartSchema>>) {
  const started_at = args.started_at ?? new Date().toISOString();
  ensureSession(args.session_id, started_at, args.title, args.user_message);
  const event: SessionEvent = { type: "session_start", at: started_at };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? "session_start recorded" : "duplicate ignored");
}

export async function handleRecordPlanStep(args: z.infer<z.ZodObject<typeof planStepSchema>>) {
  const event: SessionEvent = { type: "plan_step", step: args.step, index: args.index, at: args.at };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? "plan_step recorded" : "duplicate ignored");
}

export async function handleRecordFileEdit(args: z.infer<z.ZodObject<typeof fileEditSchema>>) {
  const event: SessionEvent = {
    type: "file_edit",
    path: args.path,
    old_content: args.old_content,
    new_content: args.new_content,
    at: args.at,
  };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? "file_edit recorded" : "duplicate ignored");
}

export async function handleRecordFileCreate(args: z.infer<z.ZodObject<typeof fileCreateSchema>>) {
  const event: SessionEvent = {
    type: "file_create",
    path: args.path,
    content: args.content,
    at: args.at,
  };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? "file_create recorded" : "duplicate ignored");
}

export async function handleRecordFileDelete(args: z.infer<z.ZodObject<typeof fileDeleteSchema>>) {
  const event: SessionEvent = { type: "file_delete", path: args.path, at: args.at };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? "file_delete recorded" : "duplicate ignored");
}

export async function handleRecordDeliverable(args: z.infer<z.ZodObject<typeof deliverableSchema>>) {
  const event: SessionEvent = {
    type: "deliverable",
    title: args.title,
    content: args.content,
    at: args.at,
  };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? "deliverable recorded" : "duplicate ignored");
}

export async function handleRecordToolCall(args: z.infer<z.ZodObject<typeof toolCallSchema>>) {
  const event: SessionEvent = {
    type: "tool_call",
    name: args.name,
    args: args.args,
    result: args.result,
    at: args.at,
  };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? "tool_call recorded" : "duplicate ignored");
}

export async function handleRecordSessionEnd(args: z.infer<z.ZodObject<typeof sessionEndSchema>>) {
  const s = getSession(args.session_id);
  if (!s) return errorContent(`Session not found: ${args.session_id}`);
  markCompleted(args.session_id);
  const result = flushSession(s);
  if (result.error) return errorContent(result.error);
  return textContent(`Session ended and flushed to ${result.path}`);
}

export async function handleFlushSessions() {
  const completed = getCompletedSessions();
  const results: string[] = [];
  for (const s of completed) {
    const r = flushSession(s);
    if (r.error) results.push(`${s.id}: ${r.error}`);
    else results.push(`${s.id}: ${r.path}`);
  }
  if (results.length === 0) return textContent("No completed sessions to flush.");
  return textContent(results.join("\n"));
}

export async function handleListSessions() {
  const entries = listSessions();
  return textContent(JSON.stringify(entries, null, 2));
}

// ——— Middleware (record + execute) ———

export async function handleFileOp(args: z.infer<z.ZodObject<typeof fileOpSchema>>) {
  const { session_id, path: rawPath, action, content } = args;
  const s = getSession(session_id);
  if (!s) return errorContent(`Session not found: ${session_id}`);
  if (s.completed) return errorContent("Session already completed");

  const workspaceRoot = getWorkspaceRoot();
  let resolvedPath: string;
  try {
    resolvedPath = resolveWithinWorkspace(workspaceRoot, rawPath);
  } catch (e) {
    return errorContent(e instanceof Error ? e.message : "Path escapes workspace");
  }

  const at = new Date().toISOString();

  try {
    if (action === "create") {
      const newContent = content ?? "";
      const event: SessionEvent = { type: "file_create", path: rawPath, content: newContent, at };
      const { error } = appendEvent(session_id, event);
      if (error) return errorContent(error);
      mkdirSync(dirname(resolvedPath), { recursive: true });
      writeFileSync(resolvedPath, newContent, "utf-8");
      return textContent(`Created ${rawPath}`);
    }

    if (action === "edit") {
      const exists = existsSync(resolvedPath);
      if (!exists) return errorContent(`File not found for edit: ${rawPath}`);
      const oldContent = readFileSync(resolvedPath, "utf-8");
      const newContent = content ?? "";
      const event: SessionEvent = {
        type: "file_edit",
        path: rawPath,
        old_content: oldContent,
        new_content: newContent,
        at,
      };
      const { error } = appendEvent(session_id, event);
      if (error) return errorContent(error);
      writeFileSync(resolvedPath, newContent, "utf-8");
      return textContent(`Updated ${rawPath}`);
    }

    if (action === "delete") {
      const oldContent = existsSync(resolvedPath) ? readFileSync(resolvedPath, "utf-8") : undefined;
      const event: SessionEvent = { type: "file_delete", path: rawPath, at };
      if (oldContent !== undefined) (event as { old_content?: string }).old_content = oldContent;
      const { error } = appendEvent(session_id, event);
      if (error) return errorContent(error);
      if (existsSync(resolvedPath)) unlinkSync(resolvedPath);
      return textContent(`Deleted ${rawPath}`);
    }
  } catch (err) {
    return errorContent(err instanceof Error ? err.message : String(err));
  }

  return errorContent("Invalid action");
}

export async function handleRecordPlan(args: z.infer<z.ZodObject<typeof recordPlanSchema>>) {
  const at = new Date().toISOString();
  for (let i = 0; i < args.steps.length; i++) {
    const event: SessionEvent = { type: "plan_step", step: args.steps[i], index: i, at };
    const { error } = appendEvent(args.session_id, event);
    if (error) return errorContent(error);
  }
  return textContent(`Recorded ${args.steps.length} plan steps`);
}

export async function handleAuditEvent(args: z.infer<z.ZodObject<typeof auditEventSchema>>) {
  const event: SessionEvent = {
    type: "deliverable",
    title: args.type,
    content: args.description,
    at: args.at,
  };
  const { appended, error } = appendEvent(args.session_id, event);
  if (error) return errorContent(error);
  return textContent(appended ? `Audit event recorded: ${args.type}` : "duplicate ignored");
}

// Export schemas for server registration
export const toolSchemas = {
  health: { inputSchema: {} as Record<string, z.ZodTypeAny> },
  record_session_start: { inputSchema: sessionStartSchema },
  record_plan_step: { inputSchema: planStepSchema },
  record_plan: { inputSchema: recordPlanSchema },
  record_file_edit: { inputSchema: fileEditSchema },
  record_file_create: { inputSchema: fileCreateSchema },
  record_file_delete: { inputSchema: fileDeleteSchema },
  file_op: { inputSchema: fileOpSchema },
  record_deliverable: { inputSchema: deliverableSchema },
  audit_event: { inputSchema: auditEventSchema },
  record_tool_call: { inputSchema: toolCallSchema },
  record_session_end: { inputSchema: sessionEndSchema },
  flush_sessions: { inputSchema: {} as Record<string, z.ZodTypeAny> },
  list_sessions: { inputSchema: {} as Record<string, z.ZodTypeAny> },
} as const;
