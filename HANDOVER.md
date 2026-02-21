# AgentLens Handover (for Next Agent)

This document is the fast path to understand the codebase and continue work without scanning every file.

## 1) Monorepo layout

- `/Users/xiaoleishawn/private/AL/schema`
  - Shared contracts: canonical event envelope + session schema validation utilities.
- `/Users/xiaoleishawn/private/AL/mcp-server`
  - MCP server, local API server, ingest pipeline, local storage.
- `/Users/xiaoleishawn/private/AL/webapp`
  - Browser viewer/replay + reviewer analysis pipeline.

Workspace config:
- `/Users/xiaoleishawn/private/AL/pnpm-workspace.yaml`
- `/Users/xiaoleishawn/private/AL/package.json`

## 2) Core architecture (data path)

There are 2 ingestion paths into the same canonical session log:

1. Live MCP instrumentation (preferred when agent cooperates)
- Agent calls `gateway_begin_run` / `gateway_act` / `gateway_end_run`.
- Router in `/Users/xiaoleishawn/private/AL/mcp-server/src/tools.ts` validates and maps to canonical events.
- Events append to `*.jsonl` via `/Users/xiaoleishawn/private/AL/mcp-server/src/store.ts`.

2. Raw log ingestion adapters (fallback/import path)
- CLI/API calls ingest pipeline in `/Users/xiaoleishawn/private/AL/mcp-server/src/ingest.ts`.
- Adapter auto-detect + transform in `/Users/xiaoleishawn/private/AL/mcp-server/src/adapters/*`.
- Canonical events append to session JSONL, raw file preserved as sidecar.

Unified storage outputs:
- Canonical log: `<session_id>.jsonl`
- Raw sidecar: `<session_id>.<adapter>.raw.jsonl`
- Optional exported normalized JSON from `agentlens export`.

## 3) Canonical contracts

Event envelope type:
- `/Users/xiaoleishawn/private/AL/schema/event-envelope.ts`
- Mirror used by server runtime:
  - `/Users/xiaoleishawn/private/AL/mcp-server/src/event-envelope.ts`

Important event classes now preserved from raw logs:
- User intent messages
- Reasoning traces (`artifact_created` with reasoning content)
- Tool calls/results (`tool_call`)
- Token usage checkpoints (`token_usage_checkpoint`)
- Session start/end boundaries

## 4) MCP server entrypoints

Main process entry:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/index.ts`
  - Commands: `start`, `mcp`, `export`, `ingest`
  - Registers all recorder + gateway tools.

Tool schemas + handlers:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/tools.ts`
  - Validation is Zod-based.
  - `gateway_act` routes operation payloads to semantic event kinds.

Persistence and ordering:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/store.ts`
  - Seq ordering maintained in-memory per active session.
  - Write lock serializes appends.

Dashboard/API server:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/dashboard.ts`
  - APIs: sessions listing/read/export, gateway endpoints, `/api/ingest`.

## 5) Raw adapters (current behavior)

Adapter registry:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/adapters/index.ts`

Codex adapter:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/adapters/codex.ts`
- Handles:
  - `event_msg.user_message` -> intent
  - `event_msg.agent_reasoning` and `response_item.reasoning` -> artifact reasoning
  - `response_item.function_call*` -> tool call/execution
  - `event_msg.token_count` -> normalized token checkpoint

Cursor adapter:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/adapters/cursor.ts`
- Handles:
  - `<user_query>...</user_query>` -> intent
  - `<think>...</think>` -> artifact reasoning
  - `Tool call:` / `Tool result:` blocks -> tool events
  - token lines (`input_tokens`, `output_tokens`, `total_tokens`) -> token checkpoint
  - Synthesizes timestamps when missing.

## 6) Session merge strategy (ingest)

Implemented in:
- `/Users/xiaoleishawn/private/AL/mcp-server/src/ingest.ts`

Selection order when `--merge-session` is NOT supplied:
1. Reuse `adapted.session_id` only if that canonical file already exists.
2. Try fingerprint match:
   - Primary: prompt similarity (normalized text + token overlap)
   - Secondary: time proximity
   - Reject low-confidence matches
3. Else create new session id.

Ingest result includes:
- `merge_strategy` = `explicit_merge` | `adapted_session_id` | `fingerprint_match` | `new_session`
- `merge_confidence` for fingerprint matches.

## 7) Webapp architecture (viewer + analysis)

App shell:
- `/Users/xiaoleishawn/private/AL/webapp/src/App.tsx`

Primary UI:
- `/Users/xiaoleishawn/private/AL/webapp/src/components/ReplayView.tsx`
- `/Users/xiaoleishawn/private/AL/webapp/src/components/FlowView.tsx`
  - Pivot/ride/perspective interactions and event travel visualization.

Analysis/normalization pipeline:
- `/Users/xiaoleishawn/private/AL/webapp/src/lib/auditPipeline.ts`
  - Intent grouping, risk/impact/hotspot derivations, reviewer view model.
- `/Users/xiaoleishawn/private/AL/webapp/src/lib/actionRecommendationEngine.ts`
- `/Users/xiaoleishawn/private/AL/webapp/src/lib/analyzer.ts`

## 8) Commands the next agent will actually use

From repo root:

```bash
pnpm install
pnpm -r build
pnpm run start:gateway
```

Ingest shortcuts:

```bash
pnpm run ingest:auto -- --input /abs/path/raw.log
pnpm run ingest:codex -- --input /abs/path/rollout.jsonl
pnpm run ingest:cursor -- --input /abs/path/cursor-log.txt
pnpm run ingest -- --input /abs/path/raw.log --adapter auto --merge-session sess_123
```

## 9) Known tech debt / transfer items

P0 (correctness / reliability):
- Add automated tests for adapters and ingest merge behavior.
  - Current logic is exercised manually; no regression suite yet.
- Make fingerprint merge thresholds configurable via env (`min confidence`, `max hours`) and document defaults.

P1 (maintainability):
- `event-envelope.ts` exists in both `schema` and `mcp-server`; keep in sync manually today.
  - Better: import only from `@xiaolei.shawn/schema` in server runtime types.
- Ingest reads candidate session metadata by scanning JSONL files each run.
  - Better: cache/index session fingerprints to reduce IO on large session directories.

P1 (data quality):
- Cursor adapter is pattern-based and tolerant; can produce lower-confidence mappings for unusual logs.
  - Add explicit parser variants for known Cursor export formats if available.
- Codex reasoning content may include encrypted/large payloads.
  - Add truncation policy controls and redaction options.

P2 (product polish):
- Dashboard and webapp behavior is rich but has limited automated UI checks.
- Add importer diagnostics in UI (show why a file failed to parse and which adapter matched).

## 10) Suggested first tasks for next agent

1. Add ingest test fixtures + unit tests:
   - codex sample
   - cursor sample
   - fingerprint merge positive/negative cases
2. Wire env-configurable fingerprint thresholds in `config.ts` and `ingest.ts`.
3. Add a small `agentlens doctor` command to validate sessions dir, adapter availability, and dashboard/webapp paths.

