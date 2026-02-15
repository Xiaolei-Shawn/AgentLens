#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  handleRecordActivity,
  handleRecordAssumption,
  handleRecordDecision,
  handleRecordIntent,
  handleRecordSessionEnd,
  handleRecordSessionStart,
  handleRecordVerification,
  toolSchemas,
} from "./tools.js";

const server = new McpServer({
  name: "al-mcp-server",
  version: "0.2.0",
});

server.registerTool(
  "record_session_start",
  {
    description: "Start a session and persist a canonical session_start event.",
    inputSchema: toolSchemas.record_session_start.inputSchema,
  },
  handleRecordSessionStart
);

server.registerTool(
  "record_intent",
  {
    description: "Record intent for the active session and return intent_id.",
    inputSchema: toolSchemas.record_intent.inputSchema,
  },
  handleRecordIntent
);

server.registerTool(
  "record_activity",
  {
    description: "Record activity events (file_op or tool_call) for the active session.",
    inputSchema: toolSchemas.record_activity.inputSchema,
  },
  handleRecordActivity
);

server.registerTool(
  "record_decision",
  {
    description: "Record a decision event for the active session.",
    inputSchema: toolSchemas.record_decision.inputSchema,
  },
  handleRecordDecision
);

server.registerTool(
  "record_assumption",
  {
    description: "Record an assumption event for the active session.",
    inputSchema: toolSchemas.record_assumption.inputSchema,
  },
  handleRecordAssumption
);

server.registerTool(
  "record_verification",
  {
    description: "Record verification outcomes (test/lint/typecheck/manual).",
    inputSchema: toolSchemas.record_verification.inputSchema,
  },
  handleRecordVerification
);

server.registerTool(
  "record_session_end",
  {
    description: "End active session and persist a canonical session_end event.",
    inputSchema: toolSchemas.record_session_end.inputSchema,
  },
  handleRecordSessionEnd
);

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  process.stderr.write("AL MCP server connected (stdio)\n");
});

