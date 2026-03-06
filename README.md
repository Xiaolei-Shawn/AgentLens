# AgentLens

AgentLens (AL) is a local-first audit toolkit for AI agent sessions.

- **[GitHub](https://github.com/Xiaolei-Shawn/AgentLens)** — source and issues

## Packages

- **[@xiaolei.shawn/schema](schema/)** — Canonical event envelope and session schema validation.
- **[@xiaolei.shawn/mcp-server](mcp-server/)** — MCP gateway server and local dashboard for recording and reviewing agent activity. See [mcp-server/README.md](mcp-server/README.md) for full docs.

## Install

```bash
npm install @xiaolei.shawn/schema
npm install @xiaolei.shawn/mcp-server
```

## Quick start (MCP server)

Run without installing (dashboard at http://127.0.0.1:4317):

```bash
npx @xiaolei.shawn/mcp-server start --open
```

MCP mode for Cursor/Codex integration:

```bash
npx @xiaolei.shawn/mcp-server mcp
```

After install you can use the `agentlens` (or `al-mcp`) binary instead of `npx @xiaolei.shawn/mcp-server`.

## Monorepo development

From the repo root:

```bash
pnpm install
pnpm -r build
```

See [mcp-server/README.md](mcp-server/README.md) for building/running individual packages.

## Integration check

Build all packages, start the MCP server, and verify API and dashboard:

```bash
pnpm run verify:integration
```
