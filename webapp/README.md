# AgentLens Session Replay (Web App)

Local web app for viewing agent session replays. Load a session JSON file (from the MCP server or sample fixtures), then use the timeline to scrub events, story steps, and playback.

## Stories covered

- **S32** — Local web app: load session via file drop or file input; validate with session schema; data stays on machine.
- **S14** — Story steps panel: `plan_step` and `deliverable` events; click to jump to event; active step highlighted.
- **S15** — Timeline strip + scrubber: horizontal range scrubber; current event index state; works with large event counts.
- **S16** — Current event renderer: plan/deliverable text; file create/edit/delete with diff or content.
- **S17** — Playback controls: play/pause, speed 1×/2×; auto-advance; manual scrub pauses playback.

## Run

From the [monorepo root](https://github.com/Xiaolei-Shawn/AgentLens):

```bash
pnpm install
pnpm --filter webapp dev
```

Open the URL shown (e.g. http://localhost:5173). Drop a session JSON file (e.g. from `../schema/sample-session-rich.json` or from `../sessions/`) to load and replay.

## Build

From the monorepo root:

```bash
pnpm --filter webapp build
```

Output is in `webapp/dist/`. The MCP server can serve this directory (or use it when publishing the npm package). You can also serve `dist/` with any static server.

## Session format

Session JSON must conform to the canonical schema (see `../schema/`). Same format produced by the MCP server on `record_session_end`.
