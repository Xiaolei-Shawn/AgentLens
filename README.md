# AgentLens

AgentLens is a local-first audit toolkit for AI agent sessions.

## Packages

- `@xiaolei.shawn/schema`  
  Canonical event envelope and session schema validation utilities.
- `@xiaolei.shawn/mcp-server`  
  MCP gateway server + local dashboard for recording and reviewing agent activity.

## Install

```bash
npm install @xiaolei.shawn/schema
npm install @xiaolei.shawn/mcp-server
```

## Quick Start (MCP Server)

```bash
npx @xiaolei.shawn/mcp-server start --open
```

MCP mode for agent integration:

```bash
npx @xiaolei.shawn/mcp-server mcp
```

## Monorepo Development

```bash
pnpm install
pnpm -r build
```
