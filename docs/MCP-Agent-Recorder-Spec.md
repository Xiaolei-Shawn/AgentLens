# MCP Specification: Agent-Recorder (Recording Middleware)

This specification defines an MCP server that acts as a **secure, auditable gateway** for an agent's file operations and plan tracking. Recording is not optional—it is enforced by the tool layer.

## Design principle: interception, not voluntary logging

- **Before (voluntary):** The agent uses host-provided tools (e.g. `write`, `search_replace`) and is *asked* to also call `record_*` tools. If the agent forgets, the trace is incomplete.
- **After (middleware):** The agent performs file and plan actions **only through** the MCP server’s tools. The server **records the intent and payload**, then **executes** the operation. Tracing is a side effect of execution, not a separate step.

---

## A. Server capabilities

### Resources (read-only)

Expose project state for the UI; no side effects.

| Resource / API | Purpose |
|----------------|---------|
| **Timeline** | Read-only stream of session events (plan steps, file ops, audit events) for the current (or selected) session. Powers the Timeline / Story view in the IDE. |
| **Evolution state** | Per-file revision chain derived from `file_op` events. Powers the “File Evolution” / Hackreels-style view. |

*(Concrete resource URIs and `list_sessions`-style discovery are defined in the server implementation.)*

### Tools (standardized; agent must use these to interact with the world)

Every action that should be traced goes through these tools. The server records first, then executes.

| Tool | Purpose |
|------|---------|
| **record_session_start** | Begin a session (id, title, user_message). Required before other tools. |
| **record_plan** | Submit the agent’s roadmap (ordered list of steps). Links future `file_op` and `audit_event` to a “current step” for the Story view. |
| **file_op** | **Single gateway for file changes.** Parameters: `session_id`, `path`, `action` (`create` \| `edit` \| `delete`), and for create/edit: `content`. Server (1) records before/after state and action, (2) performs the filesystem operation. |
| **audit_event** | Non-file events: decisions, milestones, notes (e.g. “Decision: Used JWT for auth”). Recorded as structured events for the timeline. |
| **record_session_end** | End session and flush to disk. |

Optional / backward compatibility: `record_plan_step` (single step), `record_file_edit` / `record_file_create` / `record_file_delete` (record-only) can remain for hosts that don’t yet route file writes through the MCP server.

---

## B. Core tool definitions

### record_plan

| Parameter | Type | Description |
|-----------|------|-------------|
| session_id | string | Current session. |
| steps | string[] | Ordered list of step descriptions. Stored as `plan_step` events with indices 0, 1, 2, … so the UI can group subsequent file ops by “current step”. |

**Internal logic:** For each `steps[i]`, append a `plan_step` event with `step: steps[i]`, `index: i`, and timestamp. No filesystem side effect. Enables the “Story” view by linking future actions to these step IDs.

---

### file_op

| Parameter | Type | Description |
|-----------|------|-------------|
| session_id | string | Current session. |
| path | string | File path (relative to workspace root or absolute within workspace). |
| action | `"create"` \| `"edit"` \| `"delete"` | Operation to perform. |
| content | string | Required for `create` and `edit`; ignored for `delete`. New file content (full body). |

**Internal logic (the “recorder” value):**

1. **Resolve and validate path** against the configured workspace root (no escaping above root).
2. **Record before state:**
   - **create:** Record `file_create` with `path`, `content`, timestamp.
   - **edit:** Read current file content as `old_content`; record `file_edit` with `path`, `old_content`, `new_content` = `content`, timestamp.
   - **delete:** Read current file content (for trace); record `file_delete` with `path`, timestamp.
3. **Execute on filesystem:** Perform create (write), edit (write), or delete (unlink).
4. Return success or structured error to the agent.

This is the single source of truth for **File Evolution**: every change is captured with before/after state before the write happens.

---

### audit_event

| Parameter | Type | Description |
|-----------|------|-------------|
| session_id | string | Current session. |
| type | string | Short label (e.g. `"decision"`, `"milestone"`, `"note"`). |
| description | string | Human-readable description. |

**Internal logic:** Append a timeline event (e.g. stored as `deliverable` with `title` = type, `content` = description) so non-file events appear in the Timeline and can be used for the “mental model” / Story view.

---

## Linking MCP to real-world challenges

### Challenge 1: Fragile agent behavior (the “trace” problem)

**Problem:** Agents might forget to emit TRACE/plan logs or call record_* after editing.

**MCP solution:** Recording is moved to the **tool layer**. If the agent wants to edit a file, it **must** use the `file_op` tool provided by the MCP server. The server logs intent, timestamp, and diff as part of the tool’s execution. The agent does not need to “remember” to format or send a separate log.

---

### Challenge 2: Context switching and friction

**Problem:** Users don’t want to leave the IDE to check a separate dashboard.

**MCP solution:** MCP uses a host–client–server model. Hosts like Cursor and VS Code already support MCP, so the recording tool lives inside the user’s environment. The Timeline (and Evolution state) can be exposed as **resources** or a sidebar in the editor, without a separate app.

---

### Challenge 3: Building a “mental model” quickly

**Problem:** Reading long diffs is tedious.

**MCP solution:** Because the MCP server sees every `file_op` and every `record_plan` / `audit_event`, it can:
- Group micro-edits into **logical iterations** (e.g. by the plan step the agent is currently in).
- Summarize many small saves into a single “Story” step.
- Surface a high-level narrative instead of raw 500-line diffs.

---

### Challenge 4: Technical feasibility of “Evolution view”

**Problem:** Capturing file states across long sessions is complex (timing, ordering, missed writes).

**MCP solution:** The MCP server acts as a **local, Git-like state manager**. Every `file_op` is recorded with before/after content before the write is applied. That gives high-fidelity data for a Hackreels-style animated evolution view without relying on a filesystem watcher that might miss rapid or reordered changes.

---

## Summary of value

Using MCP as **recording middleware** turns the server from a passive log consumer into an **active infrastructure component**:

- **Agent “honesty”:** Recording is a **requirement** of the tool’s execution, not a separate, optional call.
- **Stickiness:** Integration is in the user’s primary workspace (IDE) via standard MCP hosts.
- **Single source of truth:** Timeline and File Evolution are derived from the same tool calls the agent uses to do work.
