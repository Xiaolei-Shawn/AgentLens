#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startDashboardServer } from "./dashboard.js";
import { exportSessionJson, listSessionFiles } from "./store.js";
import {
  handleGatewayAct,
  handleGatewayBeginRun,
  handleGatewayEndRun,
  handleRecordActivity,
  handleRecordAssumption,
  handleRecordDecision,
  handleRecordIntent,
  handleRecordSessionEnd,
  handleRecordSessionStart,
  handleRecordVerification,
  toolSchemas,
} from "./tools.js";

function registerTools(server: McpServer): void {
  server.registerTool(
    "gateway_begin_run",
    {
      description: "Gateway start: starts/reuses session and can create initial intent.",
      inputSchema: toolSchemas.gateway_begin_run.inputSchema,
    },
    handleGatewayBeginRun
  );

  server.registerTool(
    "gateway_act",
    {
      description: "Gateway action router: maps operation to semantic recorder tools/events with validation.",
      inputSchema: toolSchemas.gateway_act.inputSchema,
    },
    handleGatewayAct
  );

  server.registerTool(
    "gateway_end_run",
    {
      description: "Gateway end: closes active session with outcome/summary.",
      inputSchema: toolSchemas.gateway_end_run.inputSchema,
    },
    handleGatewayEndRun
  );

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
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "darwin"
      ? [url]
      : platform === "win32"
      ? ["/c", "start", "", url]
      : [url];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.unref();
}

async function runMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "al-mcp-server",
    version: "0.2.0",
  });
  registerTools(server);
  startDashboardServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("AL MCP server connected (stdio)\n");
}

function runStart(openFlag: boolean): void {
  const dashboard = startDashboardServer();
  if (!dashboard) {
    process.stderr.write("Dashboard is disabled via env.\n");
    process.exitCode = 1;
    return;
  }
  const url = `http://${dashboard.host}:${dashboard.port}`;
  if (openFlag) {
    try {
      openBrowser(url);
    } catch (error) {
      process.stderr.write(
        `Failed to open browser: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
  process.stderr.write(
    `AgentLens local gateway is running at ${url}\n` +
      "Use MCP mode in your agent config with: `agentlens mcp`\n"
  );
}

function parseFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function runExport(): void {
  const explicitSession = parseFlag("--session");
  const out = parseFlag("--out");
  const latest = process.argv.includes("--latest");

  const sessions = listSessionFiles();
  if (sessions.length === 0) {
    throw new Error("No sessions found.");
  }
  const target = explicitSession
    ? sessions.find((item) => item.session_id === explicitSession)
    : latest || !explicitSession
    ? sessions[0]
    : undefined;
  if (!target) {
    throw new Error(`Session not found: ${explicitSession}`);
  }

  const exported = exportSessionJson(target.session_id);
  if (out) {
    const path = resolve(out);
    writeFileSync(path, exported, "utf-8");
    process.stdout.write(`Exported ${target.session_id} -> ${path}\n`);
    return;
  }
  process.stdout.write(exported + "\n");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "mcp";
  if (command === "start") {
    runStart(process.argv.includes("--open"));
    return;
  }
  if (command === "export") {
    runExport();
    return;
  }
  if (command === "mcp") {
    await runMcpServer();
    return;
  }
  process.stderr.write(
    "Usage:\n" +
      "  agentlens start [--open]\n" +
      "  agentlens mcp\n" +
      "  agentlens export [--latest|--session <id>] [--out <path>]\n"
  );
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(
    `Fatal: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
