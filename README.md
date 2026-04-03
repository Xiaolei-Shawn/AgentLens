# AgentLens

AgentLens (AL) is a local-first trust and audit toolkit for AI agent sessions, centered on **Trust View**.

- **[GitHub](https://github.com/Xiaolei-Shawn/AgentLens)** — source and issues

Trust View is the session inspection surface built for the concerns highlighted by the Claude Code source leak discussion:

- hidden data egress
- remote control paths
- opaque prompt and tool mutation
- background agent activity outside the visible user flow

## What AgentLens does

AgentLens helps users inspect what an AI agent actually did during a session and how trustworthy that session was.

- Record or import canonical agent-session events.
- Replay session behavior across orchestration, reviewer, deliverables, context, and flow views.
- Run a Trust Review that summarizes outbound activity, control surfaces, transparency findings, and user-facing safety modes.
- Visualize a session evidence graph that connects prompts, files, endpoints, memory stores, background workers, and outputs.
- Attach forensic inputs such as raw logs, config snapshots, env snapshots, and proxy traces to improve trust analysis coverage.

## Packages

- **[@xiaolei.shawn/schema](schema/)** — canonical event envelope, trust-review contracts, evidence-graph contracts, forensic-input contracts, and session schema validation.
- **[@xiaolei.shawn/mcp-server](mcp-server/)** — fully local MCP gateway server that records agent sessions and serves a local dashboard for replay, Trust Review, evidence graph inspection, and forensic workflows.
- **[webapp](webapp/)** — local replay and Trust Review UI for session inspection, evidence navigation, evidence graph visualization, and forensic input attachment.

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

**Recommended:** Use the [mcp-gateway-audit](skills/mcp-gateway-audit/) agent skill when using the MCP server so the agent produces complete canonical event traces for the dashboard. See [mcp-server README](mcp-server/README.md#recommended-use-the-agent-skill).

## Trust View

Trust View is designed around the questions a user actually cares about after running an agent:

- What data left the machine?
- What could remotely influence agent behavior?
- Was the session executed transparently?
- Did anything happen outside the visible workflow?

Trust View currently includes:

- `Trust Summary`
- `Outbound Matrix`
- `Control Surface` findings
- `Transparency` findings and before/after diffs
- `Safety Modes`
- `Session Evidence Graph`
- `Forensic Inputs`

## Monorepo development

From the repo root:

```bash
pnpm install
pnpm -r build
```

Run local services:

```bash
pnpm --filter @xiaolei.shawn/mcp-server start
pnpm --filter webapp dev
```

See [mcp-server/README.md](mcp-server/README.md) and [webapp/README.md](webapp/README.md) for package-level details.

## Integration check

Build all packages, start the MCP server, and verify API and dashboard:

```bash
pnpm run verify:integration
```
