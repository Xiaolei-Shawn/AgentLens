# AL Remotion (S25–S31)

Render agent session replays as video using [Remotion](https://remotion.dev). Uses the same session JSON as the web app and MCP.

## Compositions

- **SessionReplay** — Timeline strip, story steps, and current event content driven by frame. Props: `{ session: Session }`.
- **FunReplay** — Bouncy event cards, spring entrances, typewriter text. Props: `{ session: Session }`.
- **FileEvolution** — Per-file revision sequence with content and diff. Props: `{ session: Session, filePath: string }`.

## Setup

```bash
npm install
```

## Studio

Start Remotion Studio to preview and scrub:

```bash
npm run studio
# or: npx remotion studio src/index.ts
```

In Studio, select a composition and pass input props (e.g. paste session JSON from `../schema/sample-session-rich.json` or from MCP-flushed session). Duration is derived from event count (SessionReplay, FunReplay) or revision count (FileEvolution).

**Step-by-step for FunReplay:** see [../docs/Remotion-Studio-Preview.md](../docs/Remotion-Studio-Preview.md).

## Render to video (S31)

Render SessionReplay to MP4:

```bash
# Props file must export { session: Session }. Example: copy schema sample and wrap.
npx remotion render src/index.ts SessionReplay out/session.mp4 --props=./props.json
```

Example `props.json` (minimal):

```json
{
  "session": {
    "id": "render-1",
    "started_at": "2025-02-11T12:00:00.000Z",
    "title": "My session",
    "user_message": "",
    "events": []
  }
}
```

Use a full session from `../schema/sample-session-rich.json` or from `../sessions/` (MCP output). Copy the JSON and ensure the root key is `session`.

## Session contract

Same as web app and MCP: `id`, `started_at`, `title`, `user_message`, `events[]` with discriminated union (`session_start`, `plan_step`, `file_edit`, `file_create`, `file_delete`, `deliverable`, `tool_call`). Events with `at` (ISO 8601) and file events with content fields are used for frame mapping and diffs.
