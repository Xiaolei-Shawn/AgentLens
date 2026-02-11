# MVP Stories (Parallel-First Backlog)

Goal: define stories that can be implemented in parallel with minimal cross-team blocking.

## Session data: Timeline, File Evolution, and Remotion

**MCP session logs are the single source of truth** for the Timeline UI, File Evolution view, and Remotion animations. Session JSON produced by the MCP server (or loaded from disk after `record_session_end`) is the same format consumed by:

- **Timeline** (S14–S17): ordered `events[]` with `plan_step`, `deliverable`, and file events; current event index drives scrubber and playback.
- **File Evolution** (S18–S22): file events (`file_create`, `file_edit`, `file_delete`) with `path` and content fields (`content`, `old_content`, `new_content`) are used to derive revisions and diffs.
- **Remotion** (S25–S31): composition props are the session object; frame-to-event mapping (S26) and revision sequences (S29) read from the same session schema.

**Data contract for Remotion-ready sessions:**

- Every event SHOULD have `at` (ISO 8601) so frame mapping can be timestamp-based or equal-segment.
- File events MUST have content for diffs: `file_edit` → `old_content` and `new_content`; `file_create` → `content`; `file_delete` → path (optional `old_content` for last state).
- `plan_step` events SHOULD have `index` (0, 1, 2, …) so the Story view and Remotion timeline can group and highlight steps.
- Using the MCP **middleware** tools (`file_op`, `record_plan`, `audit_event`) ensures session logs are complete and Remotion-ready without relying on the agent to emit optional fields.

## Story Map

| Story ID | Track | Story | Depends On |
|---|---|---|---|
| S01 | Contract | Define session schema types + JSON schema | — |
| S02 | Contract | Publish sample sessions (happy path + edge cases) | S01 |
| S03 | Contract | Add schema validation utility package | S01 |
| S04 | MCP | Scaffold MCP server package + health tool | — |
| S05 | MCP | Implement event ingestion tools (`record_*`) | S01, S04 |
| S06 | MCP | Implement in-memory session assembler | S01, S05 |
| S07 | MCP | Flush completed sessions to disk | S01, S06 |
| S08 | MCP | Session discovery API (`list_sessions`) | S07 |
| S09 | MCP | Fallback folder watcher ingestion mode | S01, S04 |
| S10 | Extension (deprioritized) | Scaffold extension + command registration | — |
| S11 | Extension (deprioritized) | Open-session command + JSON parse + validate | S01, S03, S10 |
| S12 | Extension (deprioritized) | Recent sessions list (filesystem mode) | S10 |
| S13 | Extension (deprioritized) | Webview host + postMessage bridge | S10 |
| S32 | Web App | Local web app (localhost/file://, drop JSON or folder, view replay) | S01, S03 |
| S33 | Web App | Standalone HTML export (one file or HTML + JSON, shareable) | S32, S14, S16, S18, S20 |
| S34 | Web App | Hosted web app — Open from URL (CI artifact, internal server) | S32 |
| S14 | Timeline UI | Story steps panel (`plan_step`, `deliverable`) | S01, S32 |
| S15 | Timeline UI | Timeline strip + scrubber + current index state | S32 |
| S16 | Timeline UI | Current event renderer (text + diff) | S01, S32 |
| S17 | Timeline UI | Playback controls (play/pause/speed) | S15, S16 |
| S18 | File Evolution | Changed-files derivation + selector | S01, S32 |
| S19 | File Evolution | Revision builder for selected file | S01, S18 |
| S20 | File Evolution | File evolution view + next/prev + static diff | S19 |
| S21 | File Evolution | Animated diff transitions | S20 |
| S22 | File Evolution | “Open in file evolution” from timeline event | S16, S20 |
| S23 | QA | End-to-end fixture + smoke test script | S02, S07, S32 |
| S24 | Docs | Developer runbook + architecture diagram | S01, S04, S32 |
| S25 | Remotion | Remotion project scaffold + composition with session props | S01 |
| S26 | Remotion | Frame-to-event mapping (startFrame/endFrame per event) | S25 |
| S27 | Remotion | Timeline composition (strip + playhead + story steps) | S26 |
| S28 | Remotion | Current event composition (plan/diff + frame-based reveal) | S26 |
| S29 | Remotion | File evolution composition (revisions + animated diff) | S26 |
| S30 | Remotion (deprioritized) | Remotion Player in extension webview | S13, S25, S27, S28 |
| S31 | Remotion | Render session replay to video (MP4) | S25 |

## Story Details

### S01 - Define Session Schema Contract
- As a developer, I need one canonical session schema so MCP, extension, Timeline, File Evolution, and Remotion agree on data.
- Deliverables:
- `schema/session-schema.ts`
- `schema/session.schema.json`
- Acceptance criteria:
- Includes required top-level fields (`id`, `started_at`, `title`, `user_message`, `events[]`).
- Includes event discriminated union for: `session_start`, `plan_step`, `file_edit`, `file_create`, `file_delete`, `deliverable`, optional `tool_call`.
- File events support Remotion/Evolution: `file_edit` has optional `old_content`, `new_content`; `file_create` has optional `content`; all events support optional `at` (ISO 8601). `plan_step` has optional `index` for Story/Remotion step grouping.
- Can validate S02 sample files without code changes.
- Session JSON is the same format consumed by Timeline (S14–S17), File Evolution (S18–S22), and Remotion compositions (S25–S31).

### S02 - Create Sample Session Fixtures
- As a UI developer, I need realistic sample sessions to build UI and Remotion before MCP is ready.
- Deliverables:
- `schema/sample-session-minimal.json`
- `schema/sample-session-rich.json`
- Acceptance criteria:
- Minimal fixture has 3-5 events.
- Rich fixture includes at least one of each primary event type; file events include `old_content`/`new_content` or `content` so Timeline diff and File Evolution (and Remotion S28/S29) have data to render.
- All events have `at` (ISO 8601); `plan_step` events have `index` where applicable.
- Fixtures pass schema validation in CI/local script and are valid inputs for frame-to-event mapping (S26) and revision builder (S19).

### S03 - Add Shared Validation Utility
- As an extension/server developer, I need reusable validation logic to avoid divergent parsing.
- Deliverables:
- `schema/validateSession.ts` (or equivalent module)
- Acceptance criteria:
- Exposes `validateSession(data)` returning typed result or structured errors.
- Used by extension loader and MCP flush checks.

### S04 - MCP Server Scaffold
- As a platform engineer, I need a runnable MCP service skeleton.
- Deliverables:
- `mcp-server/` package with startup command and one health tool.
- Acceptance criteria:
- Server starts without runtime errors.
- Host can discover server and invoke health tool.

### S05 - MCP Event Ingestion Tools
- As a recorder, I need tool endpoints to accept event chunks and (optionally) execute file operations so recording is mandatory.
- Deliverables:
- Record-only tools: `record_session_start`, `record_plan_step`, `record_file_edit`, `record_file_create`, `record_file_delete`, `record_deliverable`, `record_tool_call`, `record_session_end`.
- Middleware (record + execute): `file_op` (path, action: create | edit | delete, content), `record_plan` (batch steps), `audit_event` (type, description). Using `file_op` ensures every file change is logged with before/after state for Timeline and File Evolution.
- Acceptance criteria:
- Each tool validates required payload fields.
- Invalid payloads return clear errors; valid payloads are appended.
- `file_op` records then performs the filesystem operation; paths are scoped to a configurable workspace root. Session logs produced this way are Remotion-ready (content fields and ordering).

### S06 - MCP Session Assembler
- As a recorder, I need session state grouped by session id in memory.
- Deliverables:
- In-memory store keyed by session id.
- Acceptance criteria:
- Handles out-of-order duplicates deterministically (documented strategy).
- Events are timestamped and ordered for flush.

### S07 - MCP Flush to Disk
- As a user, I need completed sessions persisted as JSON files that Timeline, File Evolution, and Remotion can load.
- Deliverables:
- Flush mechanism on `record_session_end` and explicit flush command.
- Acceptance criteria:
- Writes valid schema-conformant JSON to configured folder.
- File naming is deterministic and collision-safe.
- Flushed session JSON is a valid input for the web app (S32), Timeline UI (S14–S17), File Evolution (S18–S22), and Remotion compositions (S25–S31); no extra transformation required.

### S08 - MCP Session Listing API
- As a client, I need to discover saved sessions.
- Deliverables:
- `list_sessions` tool/resource returning ids, paths, timestamps.
- Acceptance criteria:
- Returns newest-first list.
- Gracefully handles empty directory.

### S09 - MCP Fallback Folder Watcher
- As an integrator, I need non-tool ingestion for environments that cannot call MCP tools directly.
- Deliverables:
- Optional watcher mode reading event fragments from a configured folder.
- Acceptance criteria:
- Can merge fragments into one session and flush.
- Mode can be enabled/disabled via config.

### S10 - Extension Scaffold
- As a developer, I need a base VS Code extension shell.
- Deliverables:
- `extension/` package, activation events, base commands.
- Acceptance criteria:
- Extension installs/loads in extension host.
- Command palette shows extension commands.

### S11 - Open Session Command
- As a user, I need to pick a JSON file and load session metadata.
- Deliverables:
- File picker command, parser, validator hook.
- Acceptance criteria:
- Invalid JSON shows actionable error.
- Valid session shows title + event count.

### S12 - Recent Sessions (Filesystem Mode)
- As a user, I need fast access to previously generated sessions.
- Deliverables:
- Session list view from configured folder.
- Acceptance criteria:
- Shows recent sessions sorted by modified time.
- Selecting an item loads it into current session state.

### S13 - Webview Host and Bridge (deprioritized)
- As a UI engineer, I need a webview runtime receiving session data.
- Deliverables:
- Webview panel/sidebar and extension-to-webview message protocol.
- Acceptance criteria:
- Webview renders “session loaded” state with event count.
- Reloading webview keeps session state synchronized.

### S32 - Local Web App
- As a user, I want a local web app to visualise agent logs without installing an IDE extension; data stays on my machine.
- Deliverables:
- Web app (e.g. `webapp/` or `app/`) that runs in the browser on localhost or via `file://`. No install; works on any OS. Build produces static assets (HTML/JS/CSS) that can be served or opened locally.
- Load session: user drops in a session JSON file (file input or drag-and-drop) or selects a folder containing session JSON files; app parses and validates with schema (S01, S03), then displays session(s) and enables replay (timeline + file evolution).
- Acceptance criteria:
- App runs at `http://localhost:*` (dev server) or from a local HTML file; no backend required for core flow. Session data never leaves the machine unless the user explicitly exports or shares.
- IDE-agnostic and LLM-free by design. Same session JSON format as MCP output; valid input for Timeline (S14–S17) and File Evolution (S18–S22).

### S33 - Standalone HTML Export
- As a user, I want to export the current session replay as a single, portable artifact I can open anywhere or share (e.g. with a teammate or for audit).
- Deliverables:
- "Export to HTML" (or equivalent) in the web app: produces one HTML file, or one HTML file plus a single JSON payload (embedded inline or as a sibling file). The bundle contains everything needed to replay the current session in any modern browser—no server, no app install.
- Acceptance criteria:
- Exported file(s) open in any browser and show the same timeline + current event + (optionally) file evolution as in the app. Format is portable, shareable, and long-lived (no runtime dependency on the dev server or extension).

### S34 - Hosted Web App (Open from URL)
- As a user, I want to open a session from a URL (e.g. CI artifact or internal server) in the same web app UI.
- Deliverables:
- Same web app as S32, with an "Open from URL" (or "Load from URL") option: user enters a URL that returns session JSON; app fetches, validates, and loads it into the replay view.
- Acceptance criteria:
- Works with CORS-friendly URLs or configurable proxy if needed. Same replay experience as loading from file; no duplicate code paths for rendering.

### S14 - Story Steps Panel
- As a user, I need the plan narrative summarized as steps from the loaded session.
- Deliverables:
- Panel showing `plan_step` and `deliverable` events (from session `events[]`; same data as Remotion timeline).
- Acceptance criteria:
- Clicking a step jumps to matching event index.
- Active step is visually highlighted.
- Uses session JSON produced by MCP (or loaded from disk); no separate data source.

### S15 - Timeline Strip + Scrubber
- As a user, I need to scrub events quickly.
- Deliverables:
- Horizontal timeline with ticks and draggable scrubber.
- Acceptance criteria:
- Changing scrubber updates current event index.
- Handles sessions with large event counts without jank.

### S16 - Current Event Renderer
- As a user, I need event content in readable form.
- Deliverables:
- Renderer for text events and file diff events.
- Acceptance criteria:
- `file_edit/create/delete` shows diff or file change summary.
- `plan_step/deliverable` shows rich text payload content.

### S17 - Playback Controls
- As a user, I need playback to auto-advance the timeline.
- Deliverables:
- Play/pause buttons and speed control (1x/2x).
- Acceptance criteria:
- Auto-advance honors current speed and stops at end.
- Manual scrub pauses playback cleanly.

### S18 - Changed Files Derivation
- As a user, I need a list of touched files in a session from the session log.
- Deliverables:
- Derived changed-files model + selector UI (from session `file_create`/`file_edit`/`file_delete` events).
- Acceptance criteria:
- No duplicate file entries.
- File list updates when loaded session changes.
- Same session format as Timeline and Remotion; file events with `path` (and content when present) drive the list.

### S19 - File Revision Builder
- As a user, I need ordered revisions for one selected file.
- Deliverables:
- Revision computation utility from event stream.
- Acceptance criteria:
- Includes create/edit/delete transitions.
- Produces stable revision order for deterministic playback.

### S20 - File Evolution Viewer (Static Diff)
- As a user, I need to step revisions and inspect deltas.
- Deliverables:
- Prev/next controls, revision index UI, code viewer, static diff.
- Acceptance criteria:
- Revision navigation updates content and diff correctly.
- Supports keyboard left/right navigation.

### S21 - Animated Diff Transitions
- As a user, I want visual continuity when moving between revisions.
- Deliverables:
- Animation layer for added/removed/changed lines.
- Acceptance criteria:
- Transition runs when revision changes.
- Degrades gracefully when diff is too large.

### S22 - Jump to File Evolution from Timeline
- As a user, I need deep-link from a timeline event to that file’s evolution.
- Deliverables:
- Action on timeline event to open file view at nearest revision.
- Acceptance criteria:
- Jump lands on correct file and relevant revision index.
- Works for both `file_create` and `file_edit`.

### S23 - End-to-End Smoke Test
- As a maintainer, I need one reproducible E2E check across schema, MCP, and web app.
- Deliverables:
- Script or test doc covering: generate session (via MCP or fixture) -> load in web app (S32) -> render timeline/replay.
- Acceptance criteria:
- Can be run by a new developer in under 10 minutes.
- Fails fast with clear stage-specific errors.

### S24 - Docs and Architecture
- As a contributor, I need concise setup and architecture docs.
- Deliverables:
- Root `README` sections for local run (MCP, web app), data flow, and component boundaries.
- Acceptance criteria:
- Includes architecture diagram and troubleshooting notes.
- Links to schema contract, sample fixtures, and web app (local + export + hosted) usage.

### S25 - Remotion Project Scaffold
- As a developer, I need a Remotion project that can render a session as a timed composition using the same session JSON as Timeline and File Evolution.
- Deliverables:
- Remotion package or subfolder (e.g. `remotion/` or `extension/remotion/`) with `remotion.config.ts`, a root composition, and session schema types (aligned with `schema/session-schema.ts`).
- Acceptance criteria:
- Composition accepts session JSON as props (MCP-flushed or sample fixtures); `durationInFrames` and `fps` are configurable (e.g. derived from event count or fixed).
- Remotion Studio (or `npx remotion studio`) runs and shows the composition with sample session data (S02 fixtures are Remotion-ready).
- Session data contract: events with `at`, file events with content fields, `plan_step` with `index` — all supported by current schema and MCP output.

### S26 - Frame-to-Event Mapping
- As a Remotion developer, I need to map frame number to the current event index and segment using the session event list.
- Deliverables:
- Utility that computes `startFrame` and `endFrame` for each event (equal segments or timestamp-proportional using event `at` when present).
- Hook or helper (e.g. `useCurrentEvent(session, frame)`) returning current event index and progress-within-segment.
- Acceptance criteria:
- At frame 0, current event is first event; at end of composition, last event is active.
- Supports both equal-length and timestamp-based duration strategies.
- Consumes the same session `events[]` array used by Timeline and File Evolution; no separate data shape.

### S27 - Timeline Composition (Remotion)
- As a viewer, I need a timeline strip and story steps driven by the current frame.
- Deliverables:
- Timeline strip with playhead position derived from `useCurrentFrame()`.
- Story steps list (from `plan_step` and `deliverable` events) with active step highlighted based on current event index.
- Acceptance criteria:
- Playhead moves smoothly as frame advances; active step updates in sync.
- Layout works for 5–50 events without overflow.

### S28 - Current Event Composition (Remotion)
- As a viewer, I need the current event’s content (plan text or file diff) with frame-based reveal.
- Deliverables:
- Component that renders `plan_step`/`deliverable` text or `file_edit`/`file_create` diff for the current event.
- Optional: line-by-line or chunk reveal using `interpolate(frame, ...)` or Remotion `spring()`.
- Acceptance criteria:
- Correct content for current event; diff or code has syntax highlighting if applicable.
- Animation (if implemented) stays in sync with composition timeline.

### S29 - File Evolution Composition (Remotion)
- As a viewer, I need a single-file evolution sequence with animated diff between revisions from the session log.
- Deliverables:
- Composition or sequence that takes session + file path; computes revisions from session file events (same logic as S19; `file_create`/`file_edit`/`file_delete` with `old_content`/`new_content`/`content`).
- Per-revision segment: show file content and animate diff (lines in/out) based on frame within segment.
- Acceptance criteria:
- Revisions advance in order; diff animation is smooth and readable.
- Works for at least 3–5 revisions in one file.
- Session data from MCP (with content fields populated via `file_op` or detailed record_* calls) is sufficient; no extra preprocessing for Remotion.

### S30 - Remotion Player in Extension Webview
- As a user, I need to play or scrub the session replay inside the VS Code extension.
- Deliverables:
- Embed Remotion Player in the extension webview; pass loaded session JSON as composition input props.
- Use existing “open session” flow to load session, then render via Player instead of (or in addition to) custom timeline UI.
- Acceptance criteria:
- User can open a session and see Remotion Player with timeline; play/scrub updates the frame.
- No hard dependency on Remotion Studio; Player runs in webview context.

### S31 - Render Session Replay to Video
- As a user, I want to export a session replay as an MP4 (or similar) for sharing.
- Deliverables:
- CLI or extension command that invokes Remotion render (e.g. `npx remotion render`) with the selected session and output path.
- Acceptance criteria:
- Rendered video plays back the same composition as in the Player.
- Output path and format are configurable.

## Recommended Parallel Sprint Layout

| Lane | Stories |
|---|---|
| Lane A (Contract) | S01, S02, S03 |
| Lane B (MCP Core) | S04, S05, S06, S07 |
| Lane C (Web App) | S32 (local web app), S33 (standalone HTML export), S34 (hosted — Open from URL) |
| Lane D (Timeline UI) | S14, S15, S16, S17 — inside web app; consumes session JSON (same as Remotion) |
| Lane E (File Evolution) | S18, S19, S20, S21, S22 — inside web app; derives from session file events (same data as S29) |
| Lane F (Cross-cutting) | S08, S09, S23, S24 |
| Lane G (Remotion) | S25, S26, S27, S28, S29, S30, S31 — session props = MCP session JSON; S02 fixtures are Remotion-ready |
| Extension (deprioritized) | S10, S11, S12, S13 — optional later; not required for MVP |

## Minimum Story Set for MVP

Must-have: S01, S02, S04, S05, S06, S07, **S32** (local web app), S14, S15, S16, S17, S18, S19, S20, S21.

Should-have: S22, S23, **S33** (standalone HTML export).

Could-have: S08, S09, S24, **S34** (hosted web app). Remotion (S25–S31): optional add-on for video/programmatic replay. Extension (S10–S13, S30): deprioritized.

**Data flow:** MCP session logs (and flushed session JSON) are the single source for Timeline UI, File Evolution, and Remotion. Ensuring session events have `at`, file events have content fields, and `plan_step` has `index` (via MCP middleware tools or detailed record_* usage) keeps the data Remotion-ready without extra transformation.
