# Example: Use al-recorder MCP in a New Chat

Paste one of the prompts below at the **start** of a new Cursor (or other MCP) chat. Replace the placeholders with your session id and task.

---

## 1. Minimal (start → work → end)

Use this when you only want the session to be recorded with start/end and basic events.

```text
Use the AL MCP server (al-recorder) to record this session.

- Session id: chat-001
- Title: [Your task title, e.g. "Add login feature"]
- User message: [Your request, or "this message"]

Do this:
1. Call record_session_start with the session id, title, and user message above.
2. Do the task as usual (edit files, run commands, etc.). Optionally call record_plan_step for key steps and record_file_edit / record_file_create / record_file_delete when you change files.
3. When we're done, call record_session_end with the same session id.
```

---

## 2. Middleware style (file_op + record_plan)

Use this when you want **every file change** to be recorded automatically by the MCP server (no need for the agent to call separate record_file_*). The agent should use the MCP **file_op** tool for creates/edits/deletes and **record_plan** for the roadmap.

**Requirement:** In your MCP config for `al-recorder`, set `AL_WORKSPACE_ROOT` (or `MCP_AL_WORKSPACE_ROOT`) to your project root so `file_op` can resolve paths.

```text
Use the AL MCP server (al-recorder) to record this session with the recording middleware.

- Session id: chat-002
- Title: [Your task title]
- User message: [Your request]

Recording rules:
1. Call record_session_start with the session id, title, and user message above.
2. Call record_plan with the same session_id and an ordered list of steps (e.g. ["Scaffold API", "Add auth", "Write tests"]).
3. For every file change (create, edit, delete), use the MCP tool file_op with session_id, path, action ("create" | "edit" | "delete"), and for create/edit provide content. Do not use the host's write/edit/delete tools for files we want recorded.
4. For decisions or milestones, call audit_event with session_id, type (e.g. "decision", "milestone"), and description.
5. When we're done, call record_session_end with the same session id.

Then do the task as usual.
```

---

## 3. Detailed trace (full diffs and tool calls)

Use this when you want a **rich session JSON** for playback or debugging: full or meaningful file diffs, multiple plan steps, and tool-call args/results.

```text
Use the AL MCP server (al-recorder) to record this session with a detailed trace.

- Session id: chat-003
- Title: [Your task title]
- User message: [Your request]

Recording rules:
1. Call record_session_start first with the session id above.
2. For plan steps: call record_plan_step for each logical step (not one big step), with a clear "step" string and optional "index" (0, 1, 2, …).
3. For every file edit: call record_file_edit with path, and include old_content and new_content (full previous and new content, or a representative snippet if very long) so the trace has usable diffs.
4. For file create: call record_file_create with path and content (initial content).
5. For file delete: call record_file_delete with path.
6. When you use a tool (read_file, grep, run terminal, etc.): call record_tool_call with name, and include args and result (a short summary or key output) so tool usage is visible.
7. For deliverables or milestones: call record_deliverable with title and content.
8. When we're done: call record_session_end with the same session id.

Then do the task as usual.
```

---

## Session id and output file

- Use a **unique** `session_id` per chat (e.g. `chat-001`, `my-feature-2025-02-11`).
- The saved file will be written to `AL_SESSIONS_DIR` as `{session_id}_{started_at_epoch}.json` (e.g. `chat-001_1739260800000.json`).

## MCP config reminder (Cursor)

Ensure `al-recorder` is in your MCP config, for example:

```json
{
  "mcpServers": {
    "al-recorder": {
      "command": "node",
      "args": ["/Users/xiaoleishawn/private/AL/mcp-server/dist/index.js"],
      "env": {
        "AL_SESSIONS_DIR": "/Users/xiaoleishawn/private/AL/sessions",
        "AL_WORKSPACE_ROOT": "/Users/xiaoleishawn/private/AL"
      }
    }
  }
}
```

Use your real paths. Set `AL_WORKSPACE_ROOT` if you use **file_op** (middleware style). Restart Cursor or reload MCP after changing config.
