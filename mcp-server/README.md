# @xiaolei-shawn/mcp-server

Local-first MCP server for AI agent session auditing.

- Records canonical session events via MCP tools
- Persists events as local JSONL files
- Serves a local web dashboard + API from the same process
- Data never leaves the machine unless you explicitly move files

## Open-source connector model

This package is intended to be the open-source MCP connector layer.

- Open source: MCP tools + canonical event capture + local storage/API serving
- Proprietary (optional): advanced analyzer dashboard/heuristics binaries can be served separately

You can point the built-in dashboard server to any static bundle via `AL_DASHBOARD_WEBAPP_DIR`.

## Features

- Canonical event capture with sequence ordering and timestamps
- Gateway tools for low-friction agent instrumentation
- Local dashboard server (`/api/sessions`, `/api/sessions/:key`)
- Session storage on local disk (`AL_SESSIONS_DIR`)
- Local gateway API for middleware (`/api/gateway/*`)
- Export session JSON with normalized snapshot (`agentlens export`)

## Install

```bash
npm install @xiaolei-shawn/mcp-server
```

## Run

```bash
agentlens start --open
```

This starts the local dashboard + gateway API on `http://127.0.0.1:4317` and opens a browser tab.

MCP mode (for Cursor/Codex MCP config):

```bash
agentlens mcp
```

## MCP Tools

### Canonical recorders

- `record_session_start`
- `record_intent`
- `record_activity`
- `record_decision`
- `record_assumption`
- `record_verification`
- `record_session_end`

### Gateway tools

- `gateway_begin_run`
- `gateway_act`
- `gateway_end_run`

## Local Dashboard

When the server starts, it also runs a local HTTP server (enabled by default).

Default URL:

- `http://127.0.0.1:4317`

API endpoints:

- `GET /api/health`
- `GET /api/sessions`
- `GET /api/sessions/:key`
- `GET /api/sessions/:key/export`
- `POST /api/gateway/begin`
- `POST /api/gateway/act`
- `POST /api/gateway/end`

If web assets are available (default `../webapp/dist`), they are served by the same server.

## Automatic instrumentation defaults

To reduce agent friction:

- `gateway_act` auto-creates a session if no active session exists.
- `gateway_act` auto-creates an intent when activity arrives without an active intent.
- `record_session_end` and `gateway_end_run` persist both raw JSONL and a normalized session snapshot.

## Environment Variables

- `AL_SESSIONS_DIR` (default: `./sessions`): local session file directory.
- `AL_DASHBOARD_ENABLED` (default: `true`): enable/disable dashboard server.
- `AL_DASHBOARD_HOST` (default: `127.0.0.1`): dashboard bind host.
- `AL_DASHBOARD_PORT` (default: `4317`): dashboard bind port.
- `AL_DASHBOARD_WEBAPP_DIR` (default: auto): static webapp build directory.
- `AL_WORKSPACE_ROOT` (default: `process.cwd()`): workspace root for safe path operations.
- `AL_AUTO_GOAL` (default: `Agent task execution`): fallback goal for auto-started sessions.
- `AL_AUTO_USER_PROMPT` (default: `Auto-instrumented run`): fallback prompt for auto-started sessions.

## Cursor/Codex MCP configuration example

```json
{
  "mcpServers": {
    "agentlens": {
      "command": "agentlens",
      "args": ["mcp"],
      "env": {
        "AL_SESSIONS_DIR": "/absolute/path/to/sessions"
      }
    }
  }
}
```

## Build from source

```bash
pnpm install
pnpm --filter @xiaolei-shawn/mcp-server build
pnpm --filter @xiaolei-shawn/mcp-server start
```

## Export session JSON

Export latest session:

```bash
agentlens export --latest --out ./latest.session.json
```

Export by session id:

```bash
agentlens export --session sess_1771256059058_2bd2bd8f --out ./session.json
```

## Publish checklist

1. Update version in `package.json`.
2. Confirm repository URLs in `package.json` are correct.
3. Run:

```bash
npm run build
npm pack --dry-run
npm publish --access public --dry-run
```

4. Publish:

```bash
npm publish --access public
```
