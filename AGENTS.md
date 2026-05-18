# AGENTS.md — Levea AI Video Editor (MCP)

Guidance for AI agents (Claude, GPT-class models, OpenClaw, Hermes, Cursor, Cline, …) calling the Levea MCP server. Pair with [`mcp-server/README.md`](./mcp-server/README.md).

## What this is

`levea-mcp-server` exposes the **Levea autonomous video editor** — an editor that is itself an agent — as a small set of MCP tools. Calling agents delegate goals (a sentence, a creative brief) and the editor plans, executes, verifies, and exports end-to-end. The MCP server is a thin, stable adapter over the backend contract `POST https://api.livecore.ai/api/v1/misc/openclaw/v1/execute`. No editing logic, shell, filesystem, or raw renderer lives here.

## Tools (10)

| Tool | When to use | Mutates? | Async? |
|---|---|---|---|
| `autonomous_edit` (**primary**) | Anything from one-line edits to multi-paragraph briefs. The default choice. | Yes | Yes — may auto-fire an export job |
| `generate_viral_clips` | Convenience over `autonomous_edit` for clip extraction. | Yes | Yes |
| `add_captions` | Word-highlighted styled captions. | Yes | Yes |
| `remove_silence` | Cut silent gaps. | Yes | Yes |
| `read_scene` | Inspect current scene/timeline state. | **No** | No |
| `read_media` / `read_visual` / `query_transcript` | Read-only inspection. | **No** | No |
| `export_video` | Export to MP4. Returns `jobId`; supports `wait: true`. | No (queues async job) | Yes |
| `check_job_status` | Poll an async job; supports `wait: true`. | **No** | Optional |
| `editor_execute` | Power-user escape hatch — allowlisted backend tools only. | Depends | Yes |
| `editor_health` | Connectivity diagnostic (no auth required). | **No** | No |

Full input schemas are returned by `tools/list` over MCP.

## How to call it well

1. **Prefer `autonomous_edit`.** Pass the user's intent verbatim or a faithful brief; the editor decomposes it. Don't over-decompose on the calling side — the inner agent's planner is the specialist.
2. **Treat every call as expensive and long-running.** A single `autonomous_edit` can plan + execute many steps and trigger an auto-export. Minutes, not seconds. **Do not retry on transient errors without backoff**; never re-invoke as a substitute for polling.
3. **Async / job pattern.** Mutating tools and `export_video` may return a `jobId`. Poll with `check_job_status` (or call with `wait: true` to block until terminal). Never re-invoke `export_video` to "check progress."
4. **Read-only first.** When uncertain about scene state, call `read_scene` / `query_transcript` before mutating.
5. **Plan approval for irreversible work.** When the user's intent is destructive or hard to undo, set `requirePlanApproval: true` in `autonomous_edit` params — the editor stops after planning, returns the plan, waits for confirmation.
6. **Use `editor_health` for connection diagnostics**, not auth diagnostics — it's unauthenticated.

## Response shape

Every tool call returns:

- `content: [{ type: "text", text }]` — a one-line human-readable summary (used for chat display).
- `structuredContent: {...}` — the full structured result. Read **this**, not the text, for state machines / agent loops.
- `isError: true` on failure — combined with `structuredContent.error`.

Fields you'll see on success: `success`, `message`, `videoUrl`, `jobId`, `status`, `data`.

## Auth & config

Set via the MCP client's `mcpServers[].env`. Canonical (v0.3.0+):

| Var | Required | Value |
|---|---|---|
| `LEVEA_API_URL` | yes | `https://api.livecore.ai` |
| `LEVEA_API_KEY` | yes | Generate at https://studio.livecore.ai |

Backward compat: `ADSCENE_API_URL` / `ADSCENE_API_KEY` still read as a silent fallback (v0.2.0 only honors these — `LEVEA_*` arrives in v0.3.0).

The client never accepts a *full path* in `LEVEA_API_URL` — set only the host. The path `/api/v1/misc/openclaw/v1/execute` is appended automatically. Do not point at `/api/v1/misc/editor/` (different route, different auth model).

## Errors — how to react

| Signal | What it means | What to do |
|---|---|---|
| `isError: true` + 401/403 in message | Bad/expired `LEVEA_API_KEY` | Surface to user; tell them to regenerate at studio.livecore.ai. **Do not retry.** |
| `isError: true` + "is required" | Env var missing | Surface; do not retry. |
| `isError: true` + 5xx / network | Transient backend | Retry **once** with backoff. Then surface. |
| `success: true`, `jobId` present | Async work running | Poll `check_job_status` — don't re-invoke the original tool. |
| `success: true`, `videoUrl` present | Export landed | Show the URL to the user. |

## Cost-shaping recommendations

- The editor auto-exports after most mutating calls. If your user is mid-iteration, mention this so they don't get surprise renders.
- Batch related edits into one `autonomous_edit` brief instead of many small tool calls — the inner planner is far cheaper than N round-trips.
- For pure inspection, always use `read_*` / `query_transcript`; never invoke a mutating tool "just to see."

## Safety boundary

Low-level operations (shell, ffmpeg flags, raw timeline JSON, filesystem) are **deliberately not exposed**. The backend allowlists tools server-side. `editor_execute` only accepts the typed enum of canonical tools, never arbitrary commands. Trust this boundary; do not try to construct paths around it.

## Source

- Repo: https://github.com/brajendrak00068/openclaw-ai-video-editor
- npm: https://www.npmjs.com/package/levea-mcp-server
- MCP Registry: `io.github.brajendrak00068/levea-mcp-server`
