# @al/mcp-server

Local-first MCP server for AI agent session auditing.

- Records canonical session events via MCP tools
- Persists events as local JSONL files
- Serves a local web dashboard + API from the same process
- Data never leaves the machine unless you explicitly move files

## Features

- Canonical event capture with sequence ordering and timestamps
- Gateway tools for low-friction agent instrumentation
- Local dashboard server (`/api/sessions`, `/api/sessions/:key`)
- Session storage on local disk (`AL_SESSIONS_DIR`)

## Install

```bash
npm install @al/mcp-server
```

## Run

```bash
al-mcp
```

Or:

```bash
node dist/index.js
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

If web assets are available (default `../webapp/dist`), they are served by the same server.

## Environment Variables

- `AL_SESSIONS_DIR` (default: `./sessions`): local session file directory.
- `AL_DASHBOARD_ENABLED` (default: `true`): enable/disable dashboard server.
- `AL_DASHBOARD_HOST` (default: `127.0.0.1`): dashboard bind host.
- `AL_DASHBOARD_PORT` (default: `4317`): dashboard bind port.
- `AL_DASHBOARD_WEBAPP_DIR` (default: auto): static webapp build directory.
- `AL_WORKSPACE_ROOT` (default: `process.cwd()`): workspace root for safe path operations.

## Cursor/Codex MCP configuration example

```json
{
  "mcpServers": {
    "al-recorder": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/dist/index.js"],
      "env": {
        "AL_SESSIONS_DIR": "/absolute/path/to/sessions"
      }
    }
  }
}
```

## Build from source

```bash
npm install
npm run build
npm start
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
