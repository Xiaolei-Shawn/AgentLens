# @al/mcp-server

AL MCP server: event ingestion, session assembly, flush to disk, session listing, optional folder watcher.

---

## How to use the MCP server to record agent activities in a new chat

### 1. Add the server to Cursor (or your MCP host)

So the server is available in every chat:

1. Open Cursor **Settings** → **MCP** (or edit the MCP config file directly).
2. Add a server entry that runs the AL MCP server over stdio, for example:

```json
{
  "mcpServers": {
    "al-recorder": {
      "command": "node",
      "args": ["/absolute/path/to/AL/mcp-server/dist/index.js"],
      "env": {
        "AL_SESSIONS_DIR": "/absolute/path/to/AL/sessions"
      }
    }
  }
}
```

Use the real path to your `AL` repo (e.g. `/Users/xiaoleishawn/private/AL/mcp-server/dist/index.js`) and where you want session JSON files (e.g. `/Users/xiaoleishawn/private/AL/sessions`). Restart Cursor or reload MCP so the server connects.

**Making the server available to other agents (e.g. Codex)**  
MCP config is **per client**. Cursor’s global config under `~/.cursor` only applies to Cursor. Codex, VS Code, Claude Desktop, etc. each use their own config, so you need to add the AL MCP server in each place where you want it.

- **Codex** uses **`~/.codex/config.toml`**. Add the server under the `mcp_servers` table (note: TOML uses `mcp_servers`, not `mcpServers`). Example:

  ```toml
  # In ~/.codex/config.toml
  [mcp_servers.al-recorder]
  command = "node"
  args = ["/Users/xiaoleishawn/private/AL/mcp-server/dist/index.js"]
  env = { "AL_SESSIONS_DIR" = "/Users/xiaoleishawn/private/AL/sessions" }
  ```

  Replace the paths with your real AL repo and sessions directory. Restart Codex (or start a new session) so it picks up the config. After that, the Codex agent in that session can use the same `record_*` and `list_sessions` tools.

- **Other clients** (e.g. VS Code with Copilot, Claude Desktop): add an equivalent entry in that app’s MCP config (usually JSON with `command`, `args`, `env` under a server name). Config file locations vary by product.

### 2. Recording flow in a new chat

For **each new chat** (one “session” of agent work), do this:

| Step | When | Tool / action |
|------|------|----------------|
| **Start** | Beginning of the chat, after the user’s first message | Call **`record_session_start`** with a unique `session_id`, plus `title` and `user_message` (e.g. the user’s first message or a short summary). |
| **During** | Whenever the agent does something | Call the right **`record_*`** tool with the same `session_id`: `record_plan_step` for plan steps, `record_file_edit` / `record_file_create` / `record_file_delete` for file changes, `record_tool_call` for tool use, `record_deliverable` for deliverables. |
| **End** | When the chat/session is done | Call **`record_session_end`** with that `session_id`. This flushes the session to a JSON file in `AL_SESSIONS_DIR`. |

So in one chat you use **one** `session_id` for the whole conversation and call `record_session_start` once, then many `record_*` calls, then `record_session_end` once.

### 3. Who calls the tools?

- **Option A — You or the AI in the chat**  
  In the same Cursor chat where the agent is working, you (or the AI, if you ask it to) call the AL MCP tools. For example you can say:  
  *“At the start of this task, call the AL MCP server’s `record_session_start` with session_id `chat-2025-02-11-1`, title and user_message from my request. As you do plan steps or edit files, call the matching `record_*` tools with that session_id. When we’re done, call `record_session_end` with that session_id.”*  
  Then the AI uses the `al-recorder` MCP server’s tools while it works.

- **Option B — Folder watcher (no Cursor integration)**  
  If the agent runs elsewhere (e.g. another script or service), that system can write **event fragment** JSON files into `AL_WATCHER_DIR`. Run the MCP server with `AL_WATCHER_ENABLED=1` and `AL_WATCHER_DIR` set; see [Watcher fragment format](#watcher-fragment-format) below. The server merges fragments into a session and flushes when it sees a `session_end` event.

### 4. Example: one session in one chat

In a **new** Cursor chat, you can say:

1. *“Use the AL MCP server (al-recorder) to record this session. Session id: `my-session-001`, title: ‘Add login feature’, user message: this message. Then implement a simple login in `src/auth.ts` and when you’re done, call record_session_end for this session.”*

The agent would then:

- Call `record_session_start` with `session_id: "my-session-001"`, `title: "Add login feature"`, `user_message: "..."`.
- Call `record_plan_step` (e.g. “Create auth module”), `record_file_edit` or `record_file_create` for `src/auth.ts`, then `record_session_end` with `session_id: "my-session-001"`.

The session file will appear under `AL_SESSIONS_DIR`, e.g. `my-session-001_1739260800000.json` (epoch from `started_at`).

### 5. Getting a more detailed trace

Yes. The schema and tools already support rich payloads; the agent just has to **pass** them when calling the record_* tools. You can ask for a **detailed trace** so the session JSON is useful for playback, diffs, and debugging.

**What “more detailed” can include:**

| Event | Optional fields you can ask the agent to fill |
|-------|------------------------------------------------|
| **plan_step** | `index` (step number), `at` (ISO time). Use **multiple** steps (one per logical step) instead of one big step. |
| **file_edit** | `old_content` and `new_content` (full or meaningful snippet) so the session has real diffs. |
| **file_create** | `content` (initial file content). |
| **tool_call** | `args` and `result` (e.g. summary or key data) so tool usage is visible in the timeline. |
| **deliverable** | `title` and `content` with a short summary of what was delivered. |
| Any event | `at` (ISO timestamp) for accurate ordering. |

**Prompt you can paste at the start of a chat** (customize session id and task):

```text
Use the AL MCP server (al-recorder) to record this session with a detailed trace.

- Session id: chat-001
- Title: [your task title]
- User message: [your request]

Recording rules:
1. Call record_session_start first with the session id above.
2. For plan steps: call record_plan_step for each logical step (not one big step), with a clear "step" string and optional "index" (0, 1, 2, …).
3. For every file edit: call record_file_edit with path, and include old_content and new_content (the full previous and new content, or a representative snippet if very long) so the trace has usable diffs.
4. For file create: call record_file_create with path and content (initial content).
5. For file delete: call record_file_delete with path.
6. When you use a tool (read_file, grep, run terminal, etc.): call record_tool_call with name, and include args and result (a short summary or key output) so tool usage is visible.
7. For deliverables or milestones: call record_deliverable with title and content.
8. When we're done: call record_session_end with the same session id.

Then do the task as usual.
```

With that, the saved session JSON will contain full or meaningful `old_content`/`new_content`, multiple `plan_step` events, and `tool_call` events with args/result, which the timeline UI (and file evolution view) can use for a much richer playback.

### 6. Listing and opening recorded sessions

- Call **`list_sessions`** (from the same MCP server or any client) to get the list of saved session files (ids, paths, timestamps).
- The extension (S11+) will later let you “Open session” and pick one of these JSON files to view the timeline.

### 7. Recording middleware (no voluntary trace)

To avoid relying on the agent to "remember" to emit trace logs, use the **gateway** tools so recording is a side effect of execution:

| Tool | Use instead of | Effect |
|------|----------------|--------|
| **file_op** | Host's write/edit/delete | Server **records** before/after state and **then** performs the filesystem operation. Single source for File Evolution. |
| **record_plan** | One-off record_plan_step calls | Submit the full roadmap (ordered steps); server stores step indices so the UI can link later file_ops to the "current step" (Story view). |
| **audit_event** | Optional deliverable | Decisions, milestones, notes (e.g. `type: "decision"`, `description: "Used JWT for auth"`). |

**Required:** Set **`AL_WORKSPACE_ROOT`** (or `MCP_AL_WORKSPACE_ROOT`) to the project root when using **file_op**. Paths are resolved relative to this root; paths that escape the workspace are rejected. If unset, the server uses the process current working directory.

**Example flow:** Agent calls `record_session_start` → `record_plan` with `steps: ["Scaffold API", "Add auth", "Tests"]` → for each file change, **`file_op`** with `action: "create"|"edit"|"delete"` and `content` as needed. No separate record_file_* calls; every write is recorded automatically. End with `record_session_end`.

See **`docs/MCP-Agent-Recorder-Spec.md`** for the full specification and how this addresses the trace, context-switching, mental-model, and evolution-view challenges.

---

## Stories (S04–S09)

- **S04** Scaffold: stdio transport, one `health` tool.
- **S05** Event ingestion: `record_session_start`, `record_plan_step`, `record_file_edit`, `record_file_create`, `record_file_delete`, `record_deliverable`, `record_tool_call`, `record_session_end`. Payloads validated; invalid returns clear errors.
- **S06** Session assembler: in-memory store by session id; events ordered by `at` then receipt; duplicates deduped by event key.
- **S07** Flush: on `record_session_end` and via `flush_sessions`; writes schema-conformant JSON; filename `{id}_{started_at_epoch}.json`.
- **S08** `list_sessions`: returns ids, paths, timestamps (newest first); empty dir handled.
- **S09** Folder watcher: optional; `AL_WATCHER_ENABLED=1`, `AL_WATCHER_DIR`; reads JSON fragments, merges into session; flush on `session_end` marker.

## Run

```bash
npm run build
node dist/index.js
```

Or `npx al-mcp` when linked.

Host connects via stdio (e.g. Cursor MCP with command `node /path/to/mcp-server/dist/index.js`).

## Config (env)

| Env | Default | Description |
|-----|---------|-------------|
| `AL_SESSIONS_DIR` | `./sessions` | Where to write session JSON files. |
| `AL_WORKSPACE_ROOT` | `process.cwd()` | Project root for **file_op**; paths are resolved and validated against this. Required for recording middleware. |
| `AL_WATCHER_ENABLED` | — | Set to `1` or `true` to enable folder watcher. |
| `AL_WATCHER_DIR` | `./watcher-events` | Directory to watch for event fragment JSON files. |

## Tools

- **health** — No args. Returns status and timestamp.
- **record_session_start** — `session_id`, `title`, `user_message`; optional `started_at`.
- **record_plan_step** — `session_id`, `step`; optional `index`, `at`.
- **record_file_edit** — `session_id`, `path`; optional `old_content`, `new_content`, `at`.
- **record_file_create** — `session_id`, `path`; optional `content`, `at`.
- **record_file_delete** — `session_id`, `path`; optional `at`.
- **record_deliverable** — `session_id`; optional `title`, `content`, `at`.
- **record_tool_call** — `session_id`, `name`; optional `args`, `result`, `at`.
- **record_session_end** — `session_id`. Marks session complete and flushes to disk.
- **record_plan** — `session_id`, `steps` (string[]). Batch roadmap; links future actions to step indices (Story view).
- **file_op** — `session_id`, `path`, `action` (`create` \| `edit` \| `delete`), optional `content`. **Record + execute:** records before/after then writes to disk. Use instead of host file tools for full trace.
- **audit_event** — `session_id`, `type`, `description`. Non-file events (decisions, milestones).
- **flush_sessions** — No args. Flushes all in-memory completed sessions.
- **list_sessions** — No args. Lists saved sessions (ids, paths, timestamps).

## Watcher fragment format

JSON file in `AL_WATCHER_DIR`:

```json
{
  "session_id": "my-session",
  "started_at": "2025-02-11T12:00:00Z",
  "title": "Optional",
  "user_message": "Optional",
  "events": [
    { "type": "session_start" },
    { "type": "plan_step", "step": "Do something" },
    { "type": "session_end" }
  ]
}
```

Including an event with `"type": "session_end"` triggers flush and removes the fragment file.
