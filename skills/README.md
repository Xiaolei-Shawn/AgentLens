# Agent skills for AgentLens

Agent skills that work with the [@xiaolei.shawn/mcp-server](https://github.com/Xiaolei-Shawn/AgentLens/tree/main/mcp-server) MCP server.

## mcp-gateway-audit

**Use this skill when using the MCP server.** It instructs the agent to follow a strict tracing contract so every run produces a complete canonical event trace for replay and analysis in the AgentLens dashboard.

- **[SKILL.md](mcp-gateway-audit/SKILL.md)** — full skill content
- **Install:** Copy the `mcp-gateway-audit` folder into your `.cursor/skills/` (Cursor) or `.codex/skills/` (Codex) directory.
- **Trigger:** In chat, include *"Use MCP gateway audit mode for this task."* with your request.

See [mcp-server README — Recommended: use the agent skill](https://github.com/Xiaolei-Shawn/AgentLens/tree/main/mcp-server#recommended-use-the-agent-skill).
