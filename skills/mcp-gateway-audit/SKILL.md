---
name: mcp-gateway-audit
description: Use AL gateway MCP tools to produce reliable, low-friction session tracing for AgentLens canonical events.
---

# MCP Gateway Audit

This skill ensures the agent produces a **canonical event trace** for AgentLens: the server emits `session_start`, `intent`, `file_op`, `tool_call`, `decision`, `assumption`, `verification`, and `session_end` (and optionally other kinds) so sessions can be replayed and analyzed in the AgentLens dashboard.

## Behavior Contract (Do This Exactly)

When this skill is active, the agent MUST follow this contract:

1. **Start once**
   - Call `gateway_begin_run` before any meaningful action.
   - Pass `goal` from the user request.
   - Include `user_prompt` (full user request) when available.

2. **Trace everything**
   - For every meaningful operation, call `gateway_act`.
   - Do not perform silent file/tool/search/execution operations.
   - Prefer `gateway_act` over raw `record_*` tools.

3. **Use strict operation mapping**
   - File create/edit/delete → `gateway_act` with `op: "file"`, `action` ("create"|"edit"|"delete"), and `target` (file path). Optionally pass `details` (e.g. for dashboard).
   - Tool call (read/search/run/build/etc.) → `gateway_act` with `op: "tool"` or `op: "search"` or `op: "execution"`, plus `action` and optional `target`.
   - New objective/phase shift → `gateway_act` with `op: "intent"` and `intent` payload.
   - Decision point → `gateway_act` with `op: "decision"` and `decision` payload.
   - Assumption/risk → `gateway_act` with `op: "assumption"` and `assumption` payload.
   - Validation/check result → `gateway_act` with `op: "verification"` and `verification` payload.

4. **Handle failures**
   - If an operation fails, still call `gateway_act` with failure details in `details` (and attach `verification` when relevant).
   - Continue safely or stop with an explicit reason.

5. **End once**
   - Call `gateway_end_run` exactly once at completion or abort with `outcome` and `summary`.
   - Never leave an active run unclosed.

## Optional (richer canonical trace)

For a fuller AgentLens trace, use `gateway_act` with these ops when they apply:

- `op: "artifact_created"` — deliverables (patch, report, migration, test).
- `op: "risk_signal"` — explicit risk level and reasons.
- `op: "verification_run"` — verification run lifecycle (started/completed/failed).
- `op: "diff_summary"` — file diff/impact summary (file, lines_added, lines_removed, optional summary).
- `op: "blocker"` — blockers and optional resolution.
- `op: "token_usage_checkpoint"` — token/cost checkpoint.
- `op: "hotspot"` — file/module hotspot signal (file, score).
- `op: "intent_transition"` — phase shift (from/to intent).
- `op: "decision_link"` — link decision to affected files/events.
- `op: "assumption_lifecycle"` — assumption state (created/validated/invalidated).
- `op: "session_quality"` — derived quality score.
- `op: "replay_bookmark"` — bookmark key moments.

## Minimal Execution Sequence

1. `gateway_begin_run`
2. `gateway_act` (repeat for all meaningful operations)
3. `gateway_end_run`

## Expected Output

- **Canonical event stream**: session_start, intent, file_op, tool_call, decision, assumption, verification, session_end (and any optional kinds above).
- Server-owned ordering and timestamps.
- No missing file/tool/execution events for downstream analysis and AgentLens replay.

## Example Minimal Prompt (Copy/Paste)

```text
Use MCP gateway audit mode for this task.
<user prompt goes here>
```

## Interpretation Rule For The Agent

If the user includes the line:

`Use MCP gateway audit mode for this task.`

then the agent MUST apply all tracing rules in this skill automatically, without asking the user to repeat tracing instructions.
