#!/usr/bin/env node
/**
 * AL MCP Server — stdio transport. Start with: node dist/index.js (or npx al-mcp after link).
 * S04: scaffold + health tool.
 * S05: record_* tools. S06: in-memory assembler. S07: flush. S08: list_sessions. S09: optional watcher.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isWatcherEnabled } from "./config.js";
import { startWatcher } from "./watcher.js";
import {
  handleHealth,
  handleRecordSessionStart,
  handleRecordPlanStep,
  handleRecordPlan,
  handleFileOp,
  handleRecordFileEdit,
  handleRecordFileCreate,
  handleRecordFileDelete,
  handleRecordDeliverable,
  handleAuditEvent,
  handleRecordToolCall,
  handleRecordSessionEnd,
  handleFlushSessions,
  handleListSessions,
  toolSchemas,
} from "./tools.js";

const server = new McpServer({
  name: "al-mcp-server",
  version: "0.1.0",
});

// S04: health tool
server.registerTool(
  "health",
  {
    description: "Health check for the AL MCP server",
    inputSchema: toolSchemas.health.inputSchema,
  },
  handleHealth
);

// S05: record_* tools
server.registerTool(
  "record_session_start",
  {
    description: "Start a new session (id, title, user_message). Creates in-memory session.",
    inputSchema: toolSchemas.record_session_start.inputSchema,
  },
  handleRecordSessionStart
);
server.registerTool(
  "record_plan_step",
  {
    description: "Record a plan_step event",
    inputSchema: toolSchemas.record_plan_step.inputSchema,
  },
  handleRecordPlanStep
);
server.registerTool(
  "record_plan",
  {
    description: "Submit roadmap: ordered list of steps. Links future file_op/audit_event to step indices for Story view.",
    inputSchema: toolSchemas.record_plan.inputSchema,
  },
  handleRecordPlan
);
// Alias for clients (e.g. Codex) that only expose record_* tools
server.registerTool(
  "record_plan_batch",
  {
    description: "Same as record_plan. Submit roadmap: ordered list of steps (session_id, steps: string[]).",
    inputSchema: toolSchemas.record_plan.inputSchema,
  },
  handleRecordPlan
);
server.registerTool(
  "file_op",
  {
    description: "Record + execute: single gateway for file changes. action: create | edit | delete. Server records before/after then writes to disk. Use this instead of host write tools for full trace.",
    inputSchema: toolSchemas.file_op.inputSchema,
  },
  handleFileOp
);
// Alias for clients that filter out file_op
server.registerTool(
  "record_file_op",
  {
    description: "Same as file_op. Record + execute file change: session_id, path, action (create|edit|delete), optional content.",
    inputSchema: toolSchemas.file_op.inputSchema,
  },
  handleFileOp
);
server.registerTool(
  "record_file_edit",
  {
    description: "Record a file_edit event",
    inputSchema: toolSchemas.record_file_edit.inputSchema,
  },
  handleRecordFileEdit
);
server.registerTool(
  "record_file_create",
  {
    description: "Record a file_create event",
    inputSchema: toolSchemas.record_file_create.inputSchema,
  },
  handleRecordFileCreate
);
server.registerTool(
  "record_file_delete",
  {
    description: "Record a file_delete event",
    inputSchema: toolSchemas.record_file_delete.inputSchema,
  },
  handleRecordFileDelete
);
server.registerTool(
  "record_deliverable",
  {
    description: "Record a deliverable event",
    inputSchema: toolSchemas.record_deliverable.inputSchema,
  },
  handleRecordDeliverable
);
server.registerTool(
  "audit_event",
  {
    description: "Non-file events: decisions, milestones, notes (e.g. type: 'decision', description: 'Used JWT for auth').",
    inputSchema: toolSchemas.audit_event.inputSchema,
  },
  handleAuditEvent
);
// Alias for clients that filter out audit_event
server.registerTool(
  "record_audit_event",
  {
    description: "Same as audit_event. Record interpretation/reasoning/decision: session_id, type (e.g. interpretation|reasoning|decision), description.",
    inputSchema: toolSchemas.audit_event.inputSchema,
  },
  handleAuditEvent
);
server.registerTool(
  "record_tool_call",
  {
    description: "Record a tool_call event",
    inputSchema: toolSchemas.record_tool_call.inputSchema,
  },
  handleRecordToolCall
);
server.registerTool(
  "record_session_end",
  {
    description: "End session and flush to disk",
    inputSchema: toolSchemas.record_session_end.inputSchema,
  },
  handleRecordSessionEnd
);

// S07: explicit flush
server.registerTool(
  "flush_sessions",
  {
    description: "Flush all completed sessions to disk",
    inputSchema: toolSchemas.flush_sessions.inputSchema,
  },
  handleFlushSessions
);

// S08: list_sessions
server.registerTool(
  "list_sessions",
  {
    description: "List saved sessions (ids, paths, timestamps), newest first",
    inputSchema: toolSchemas.list_sessions.inputSchema,
  },
  handleListSessions
);

// S09: optional folder watcher
let stopWatcher: (() => void) | undefined;
if (isWatcherEnabled()) {
  stopWatcher = startWatcher();
}

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  process.stderr.write("AL MCP server connected (stdio)\n");
});

process.on("SIGINT", () => {
  stopWatcher?.();
  process.exit(0);
});
