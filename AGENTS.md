# AGENTS.md — Levea AI Video Editor (MCP)

Guidance for AI agents (Claude, GPT-class models, OpenClaw, Hermes, Cursor, Cline, …) calling the Levea MCP server. Pair with [`mcp-server/README.md`](./mcp-server/README.md).

## What this is

`levea-mcp-server` exposes the **Levea autonomous video editor** — an editor that is itself an agent — as a small set of MCP tools. Calling agents delegate goals (a sentence, a creative brief) and the editor plans, executes, verifies, and exports end-to-end. The MCP server is a thin, stable adapter over the backend contract `POST https://api.livecore.ai/api/v1/misc/openclaw/v1/execute`. No editing logic, shell, filesystem, or raw renderer lives here.

## Tools

The surface is **one edit tool plus management & polling**. The editing path is single-tool by design (the backend planner owns intent decomposition); the rest is typed state-management you'd otherwise have to call raw HTTP for.

### Edit (1 + 2 variants)

| Tool | Mutates? | Async? |
|---|---|---|
| `autonomous_edit` (**primary**) | Yes | Yes — may auto-fire an export job |
| `autonomous_edit_streaming` (SSE — emits per-step progress notifications) | Yes | Yes |
| `queue_edit` (fire-and-forget; returns `taskId` for `check_task_status`) | Yes | Yes |

### Job / task polling (3)

`check_job_status` (export jobs by numeric id), `check_task_status` (queued edits by taskId), `get_active_task` (currently-running edit for a project).

### Caption templates (5)

`list_caption_templates`, `apply_caption_template`, `save_caption_template`, `save_current_caption_template`, `delete_caption_template`. 41 builtin templates (hormozi, mrbeast, viral-pop, minimal-pro, karaoke, neon-pop, typewriter, pop-wave, subtitle-bar, creator-box, …) plus your saved templates.

### Brand kits (5)

`list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit`, `delete_brand_kit`. Palette / fonts / logo / voice / gradeBias / enforcement. Pass returned id as `brandId` or `projectBrandId` on `autonomous_edit` to apply.

### Projects (4)

`list_projects`, `get_project`, `create_project`, `delete_project`.

### Assets (4)

`asset_upload_url` (signed PUT URL — upload local files via the API), `list_assets`, `delete_asset`, `transcribe_asset`.

### Diagnostics (1)

`editor_health` (unauthenticated connectivity probe).

Full input schemas are returned by `tools/list` over MCP.

### Why one edit tool (not many)?

There is no per-capability shim (`add_captions`, `generate_viral_clips`, `remove_silence`, `export_video`, …) and no `editor_execute` escape hatch in the editing path. The backend planner is the specialist; exposing typed editing shims would encourage calling LLMs to dispatch them in isolation and lose multi-step intent that only the full prompt carries. Send the user's intent to `autonomous_edit` verbatim — the planner picks the right canonical actions (`GENERATE_VIRAL_CLIPS`, `GENERATE_CAPTIONS`, `EXPORT_VIDEO`, …) server-side.

The non-editing tools (brand kit CRUD, project CRUD, asset upload, caption template CRUD) are **state management**, not editing — they don't decide what to do with the scene, they just give integrators typed access to the surrounding data so they can build full integrations through one API key instead of mixing JWT and MCP.

## How to call it well

1. **Send the user's intent verbatim.** Don't pre-decompose on the calling side. "Make 3 vertical TikTok clips with captions, sync to beat, export" is one `autonomous_edit` call — not four.
2. **Treat every call as expensive and long-running.** A single `autonomous_edit` can plan + execute many steps and trigger an auto-export. Minutes, not seconds. **Do not retry on transient errors without backoff**; never re-invoke as a substitute for polling.
3. **Async / job pattern.** Mutating calls may return a `jobId`. Poll with `check_job_status` (or call with `wait: true` to block until terminal). Never re-invoke `autonomous_edit` to "check progress."
4. **Plan approval for irreversible work.** When the user's intent is destructive or hard to undo, set `requirePlanApproval: true` in `autonomous_edit` params — the editor stops after planning, returns the plan, waits for confirmation. Resume by re-calling with the returned `workingMemory` + an approval prompt (`"yes"`, `"approve"`, `"do it"`).
5. **Use `editor_health` for connection diagnostics**, not auth diagnostics — it's unauthenticated. A 200 here just means the host is reachable; a bad `LEVEA_API_KEY` will surface on the first `autonomous_edit` call.

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
| `success: true`, `jobId` present | Async work running | Poll `check_job_status` — don't re-invoke `autonomous_edit`. |
| `success: true`, `videoUrl` present | Export landed | Show the URL to the user. |

## Cost-shaping recommendations

- The editor auto-exports after most mutating calls. If your user is mid-iteration, mention this so they don't get surprise renders.
- Batch related edits into one `autonomous_edit` brief instead of many sequential calls — the inner planner is far cheaper than N round-trips.
- For pure inspection ("what's in this scene?", "what does the transcript say?"), phrase it as a read-only intent inside `autonomous_edit` — the planner takes a non-mutating path and won't trigger auto-export.

## Safety boundary

Low-level operations (shell, ffmpeg flags, raw timeline JSON, filesystem) are **deliberately not exposed**. The backend allowlists canonical actions server-side; the MCP surface offers a single high-level edit tool plus diagnostics. Trust this boundary; do not try to construct paths around it.

## Source

- Repo: https://github.com/brajendrak00068/openclaw-ai-video-editor
- npm: https://www.npmjs.com/package/levea-mcp-server
- MCP Registry: `io.github.brajendrak00068/levea-mcp-server`
