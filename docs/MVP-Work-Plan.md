# MVP Work Plan — Agent Work Visualization

**MVP scope (four deliverables):**

1. **MCP server** — Record agent activities and produce session JSON.
2. **Web app (local)** — Load session JSON (drop file or folder), view replay in the browser. Runs on localhost or file://; no install; data stays on machine. IDE-agnostic, LLM-free.
3. **Animated timeline view** — Replay the agentic plan (story steps, timeline, current event) inside the web app.
4. **Animate file evolution** — Single-file replay with animated diffs inside the web app.

**Later:** Standalone HTML export (one file or HTML + JSON, shareable); hosted web app (Open from URL). VS Code extension is deprioritized in favor of the web app.

References: [MVP-Stories.md](./MVP-Stories.md), [Idea-and-MVP-Scope.md](./Idea-and-MVP-Scope.md), [Tool-Product-Picture.md](./Tool-Product-Picture.md), session schema in Tool-Product-Picture.md §1.

---

## 1. Session JSON schema (shared contract)

Before building the MCP server and the extension, **fix the session schema** so both sides agree. No implementation work yet — just a single source of truth.

| Task | Description | Output |
|------|-------------|--------|
| **1.1** | Define the **session JSON schema** (TypeScript types or JSON Schema). Include: `id`, `started_at`, `title`, `user_message`, `events[]` with `id`, `timestamp`, `type`, `payload`. Event types: `session_start`, `plan_step`, `file_edit`, `file_create`, `file_delete`, `deliverable`, `tool_call` (optional). | `session-schema.ts` or `session.schema.json` in a shared folder or repo. |
| **1.2** | Add **one sample session JSON** (hand-written) with 3–5 events (one plan_step, two file_edit) for testing the extension and animations. | `sample-session.json` |

**Done when:** MCP and web app can both import or validate against the same schema; sample file loads in the web app.

---

## 2. MCP server — record agent activities, produce session JSON

The MCP server runs alongside the editor; it **records** agent activity and **writes** session JSON to disk (and optionally exposes it as an MCP resource).

| Task | Description | Dependencies | Output |
|------|-------------|--------------|--------|
| **2.1** | **Scaffold MCP server** — Use official MCP SDK (e.g. `@modelcontextprotocol/sdk`). Server name e.g. `agent-session-recorder`. Implement `initialize` and a minimal tool or subscription that the host can call. | Schema 1.1 | Server runs and is discoverable by Cursor/VS Code. |
| **2.2** | **Define how the server receives events** — Option A: MCP **tools** the agent (or IDE) calls: e.g. `record_session_start`, `record_plan_step`, `record_file_edit`, etc. Option B: MCP **resource** or **prompt** that the host pushes to the server when the agent runs. Option C: **File watcher** in the server that reads from a shared location (e.g. workspace) where the IDE writes raw events. Choose one for MVP; document it. | 2.1 | Design doc or README: “Event ingestion.” |
| **2.3** | **Implement event buffer** — In-memory list of events (session_start, plan_step, file_edit, …) with timestamps. Append when tools are called (or when ingestion receives data). | 2.2 | Buffer type; append logic. |
| **2.4** | **Implement session flush to JSON** — On `record_session_end` (or timeout / explicit tool), write one JSON file to a configurable path (e.g. `~/.agent-sessions/<session-id>.json` or workspace `.sessions/<id>.json`) using the schema from 1.1. Generate `id`, `started_at`, `title` (or from first user message). | 2.3, 1.1 | Session JSON files on disk. |
| **2.5** | **Optional: list sessions** — Tool or resource `list_sessions` that returns paths or contents of saved session files so the extension can discover them. | 2.4 | `list_sessions` implementation. |

**Done when:** Agent (or simulator) calls the MCP tools; server writes valid session JSON; web app can load that file.

**MVP simplification:** If MCP tool invocation from the agent is hard in your setup, **fallback:** server only **watches a folder** where another script (or IDE) drops event chunks; server merges them into session JSON. You can add MCP tools later.

---

## 3. VS Code extension — load session JSON

The extension provides a **view** (sidebar or webview) that loads session JSON and will later host the timeline and file-evolution UI.

| Task | Description | Dependencies | Output |
|------|-------------|--------------|--------|
| **3.1** | **Scaffold VS Code extension** — `yo code` or manual: `package.json` with `activationEvents`, a view container or webview. Extension id e.g. `agent-work-replay`. | — | Extension installs and activates. |
| **3.2** | **“Open session”** — Command + file picker: user selects a `.json` file. Parse with the session schema; validate. Show session title and event count in a simple view (e.g. tree or list). | 1.1, 1.2 | User can open `sample-session.json` and see session info. |
| **3.3** | **Session list** — If MCP server or a fixed folder (e.g. `~/.agent-sessions`) contains multiple sessions, list them (from disk or via MCP if you implement 2.5). User can pick a session to load. | 2.4, 1.1 | Recent / list of sessions. |
| **3.4** | **Webview host** — Create a **webview** panel or sidebar webview that will host the replay UI (timeline + file evolution). Pass the loaded session JSON into the webview (e.g. `postMessage` or inject as a script). Use a single HTML page that loads a React/Vue/Svelte app or vanilla JS. | 3.2 | Webview shows “Session loaded: N events.” (no timeline yet). |

**Done when:** User can open the extension, choose a session file (or pick from list), and the webview receives the session JSON and shows basic session info.

---

## 4. Animated timeline view of agentic plan

All inside the extension’s webview: **timeline** + **story steps** + **current event** content (diff or text). Animation = timeline playback (play/pause, scrub, optional auto-advance with timing).

| Task | Description | Dependencies | Output |
|------|-------------|--------------|--------|
| **4.1** | **Story steps list** — From `events` filter `plan_step` and `deliverable`; render a vertical list (e.g. left sidebar). Click step → jump to that event index. | 3.4, session schema | Story steps; click scrolls/jumps. |
| **4.2** | **Timeline strip** — Horizontal bar: one tick per event (or per “significant” event). Current event highlighted. **Scrubber**: click or drag to set current index. | 3.4 | Timeline; scrub to change current event. |
| **4.3** | **Current event content** — For current event: if `file_edit` or `file_create`, show **diff** (before/after or unified) with syntax highlighting. If `plan_step` or `deliverable`, show text. | 4.1, 4.2 | Center panel shows diff or text for current event. |
| **4.4** | **Play / Pause** — Auto-advance current event every N seconds (e.g. 2s). Play and Pause buttons. Optional: speed 1x, 2x. | 4.2 | Animated “playthrough” of the plan. |
| **4.5** | **Timeline animation polish** — Optional: animate the timeline cursor (e.g. a line or dot moving) when playing; smooth scrubber transition. | 4.4 | Timeline feels animated, not just discrete jumps. |

**Done when:** User can scrub the timeline or press Play and watch the plan advance step-by-step with story steps and current event diff/text updating.

---

## 5. Animate file evolution

Single-file view inside the **web app**: choose a file that was touched in the session; replay its revisions with **animated diffs** (lines in/out, highlights).

| Task | Description | Dependencies | Output |
|------|-------------|--------------|--------|
| **5.1** | **Changed-files list** — From events, derive list of file paths (from `file_edit`, `file_create`, `file_delete`). Show in a small panel or dropdown. Click file → open file-evolution view. | 3.4, session schema | List of changed files; click selects file. |
| **5.2** | **File revisions** — For selected file, compute ordered list of revisions: one per `file_create` or `file_edit` that touched that file. Each revision = (content at that point, optional diff from previous). | 5.1 | Revisions array for one file. |
| **5.3** | **File-evolution layout** — Dedicated view: **Previous / Next** (or slider) over revisions; **code block** showing content at that revision; **diff** vs previous revision (instant, no animation yet). Syntax highlighting. | 5.2 | User can step through file revisions; diff shown. |
| **5.4** | **Animate diff** — When moving to next revision, **animate** the diff: lines appearing/disappearing (e.g. opacity/height transition), or line-by-line highlight. Use CSS transitions or a small library (e.g. diffani-style or custom). | 5.3 | Animated file evolution. |
| **5.5** | **Entry from timeline** — From timeline or story steps, “Open file evolution for this event’s file” so user can jump to file-evolution from the current event. | 4.1, 5.3 | Link from timeline to file-evolution. |

**Done when:** User can open “Animate this file” for any changed file and watch its content evolve with clear, animated diffs between revisions.

---

## 5b. Standalone HTML export (web app)

| Task | Description | Dependencies | Output |
|------|-------------|--------------|--------|
| **5b.1** | **Export to HTML** — Button/action in web app: "Export to HTML". Produces one HTML file (or HTML + one JSON file) that embeds or references the current session and all UI/assets needed to replay it. No server; open in any browser. | 3.4, 4.x, 5.x | Single portable artifact (HTML or HTML+JSON). |
| **5b.2** | **Portable replay** — Exported bundle opens in any modern browser and shows the same timeline + current event + file evolution; no dependency on localhost or extension. | 5b.1 | Shareable, archivable replay. |

**Done when:** User can export the current session to a standalone HTML (or HTML+JSON) file and open it elsewhere for full replay.

---

## 5c. Hosted web app (optional later)

| Task | Description | Dependencies | Output |
|------|-------------|--------------|--------|
| **5c.1** | **Open from URL** — In the same web app, add "Open from URL": user pastes a URL that returns session JSON (e.g. CI artifact, internal server). App fetches, validates, loads. | 3.2 | Same replay experience for URL-sourced sessions. |

**Done when:** User can load a session from a URL and view replay in the same app; CORS or proxy documented if needed.

---

## 6. Suggested order and milestones

| Milestone | Tasks | Goal |
|-----------|--------|------|
| **M1 — Schema & sample** | 1.1, 1.2 | Shared session format + sample file. |
| **M2 — MCP server** | 2.1 → 2.4 (2.5 optional) | Server writes valid session JSON. |
| **M3 — Web app (local)** | 3.1, 3.2, 3.4 | Web app loads session (file/folder); replay shell ready. |
| **M4 — Timeline view** | 4.1 → 4.4 (4.5 optional) | Animated timeline + story steps + current event. |
| **M5 — File evolution** | 5.1 → 5.4 (5.5 optional) | Animate file evolution. |
| **M5b — Standalone export** | 5b.1, 5b.2 | Export to HTML (portable, shareable). |
| **M5c — Hosted (optional)** | 5c.1 | Open from URL. |

**Suggested sequence:**  
M1 first (unblocks M2 and M3). Then M2 and M3 in parallel if two people; otherwise M2 → M3 so you can test “MCP writes JSON, web app loads it.” Then M4 (timeline), then M5 (file evolution), then M5b (standalone HTML export). Optional: 3.3 (session list) after M3; 2.5 (list_sessions) when you want “Recent sessions” in the app; M5c when you need Open from URL.

---

## 7. Repo / structure suggestion

```
AL/  (or repo root)
├── docs/                    # brainstorm, spec, tool picture
├── schema/                  # shared session contract
│   ├── session-schema.ts
│   ├── session.schema.json
│   └── sample-session-*.json
├── mcp-server/              # MCP server (Node/TS)
│   ├── package.json
│   ├── src/
│   └── README.md
├── webapp/                  # Web app (local + export + optional hosted)
│   ├── package.json
│   ├── src/                 # or app entry, components
│   └── public/
├── extension/               # (optional, deprioritized) VS Code extension
│   └── ...
└── MVP-Work-Plan.md
```

Schema is shared by `mcp-server` and `webapp` (and optional `extension`); same session JSON format throughout.

---

## 8. Acceptance criteria (MVP complete)

- [ ] **MCP server:** When the agent (or a test script) records events via MCP tools (or fallback ingestion), the server writes a session JSON file that conforms to the schema.
- [ ] **Web app (local):** User can open the app (localhost or file://), drop or pick a session JSON file (or folder), and see the replay view. Data never leaves the machine unless user exports or shares. No IDE install; IDE-agnostic.
- [ ] **Standalone HTML export:** User can click "Export to HTML" and get a single file (or HTML + JSON) that opens in any browser for full replay—portable, shareable, no server.
- [ ] **Timeline:** User sees story steps and a timeline; can scrub or press Play to advance through events; current event shows diff or plan/deliverable text.
- [ ] **File evolution:** User can select a changed file and play through its revisions with animated diffs.

No LLM inside the tool. Session format is the contract between MCP server and web app. Extension (VS Code) is optional/deprioritized; hosted web app (Open from URL) is optional later.

---

## 9. Proposed tools for animations (file changes, agentic plan)

Suggested libraries and approaches for **animated timeline** (§4) and **animate file evolution** (§5). All run inside the extension webview.

### 9.1 Animate file evolution (diffs)

| Tool | Purpose | Notes |
|------|--------|------|
| **diff-match-patch** (Google) | Compute line/word diffs (LCS), get `before`/`after` hunks. | Small, no UI; use output to drive your own animated DOM. Best for 5.2–5.4. |
| **react-diff-view** / **react-diff-view-contributed** | React components for side-by-side or unified diff with syntax highlighting. | Good for 5.3 (layout + diff). Add CSS transitions for 5.4. |
| **Monaco DiffEditor** (`monaco-editor`) | Full diff editor (like VS Code) in webview. | Heavier; use if you want IDE-style diff. Can still “animate” by stepping revisions and swapping `original`/`modified`. |
| **CSS-based animation** | Animate line appearance: `opacity`/`max-height`/`transform` on `.line-add` / `.line-remove` with `transition`. | No extra deps; pair with any diff renderer. Use `requestAnimationFrame` or `setTimeout` for line-by-line stagger. |
| **Framer Motion** (React) | `AnimatePresence` + `motion` for enter/exit of diff lines. | Clean API for “lines in/out” and timeline cursor (4.5). |

**Recommendation for MVP:** Use **diff-match-patch** to compute hunks, render a simple unified diff in the webview (or use **react-diff-view** if already on React), then add **CSS transitions** or **Framer Motion** for line enter/exit when advancing to next revision (5.4).

### 9.2 Animated timeline and agentic plan

| Tool | Purpose | Notes |
|------|--------|------|
| **Custom scrubber** | `<input type="range">` or div with drag; value = current event index. | Minimal; full control for 4.2 (timeline strip, scrub). |
| **CSS transitions** | Smooth movement of “current event” indicator (line or dot) along the timeline. | For 4.5: transition `left` or `transform` when index changes. |
| **Framer Motion** | Animate timeline cursor and step list (e.g. highlight current step). | `layoutId` for shared element; `animate` for scrubber position. |
| **requestAnimationFrame + elapsed time** | Playback: advance index every N ms for “Play” (4.4). | Simple loop; no library. Optional: 1x/2x = scale interval. |
| **Howler / Web Audio** | Optional: subtle tick on step change. | Not required for MVP. |

**Recommendation for MVP:** Implement timeline as **custom range scrubber** + **CSS transition** for the cursor. Use **setInterval** (or rAF) for Play (4.4); optional **Framer Motion** for polish (4.5).

### 9.3 Syntax highlighting (for diffs and code blocks)

| Tool | Purpose | Notes |
|------|--------|------|
| **Prism.js** | Lightweight; language grammars + theme. | Easy in webview; use for “current event” code and file-evolution blocks (4.3, 5.3). |
| **Shiki** | VS Code themes and grammars (same as VS Code). | Better fidelity; can run in Node and send HTML to webview, or use Shiki web build. |
| **highlight.js** | Simple API, many languages. | Alternative to Prism. |

**Recommendation:** **Prism** or **highlight.js** for fastest MVP; **Shiki** if you want exact VS Code look.

### 9.4 Summary

- **File evolution (5.3–5.4):** diff-match-patch + custom or react-diff-view rendering + CSS or Framer Motion for line animation.
- **Timeline (4.2–4.5):** custom scrubber + CSS transitions + setInterval/rAF for Play.
- **Syntax:** Prism or highlight.js in webview (Shiki if you need theme parity with VS Code).

All of the above work inside a single webview; no native VS Code UI required for the animation itself.
