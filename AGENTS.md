# AGENTS.md — Levea AI Video Editor (MCP)

Guidance for AI agents (Claude, GPT-class models, OpenClaw, Hermes, Cursor, Cline, …) calling the Levea MCP server. Pair with [`mcp-server/README.md`](./mcp-server/README.md).

## What this is

`levea-mcp-server` exposes the **Levea autonomous video editor** — an editor that is itself an agent — as a small set of MCP tools. Calling agents delegate goals (a sentence, a creative brief) and the editor plans, executes, verifies, and exports end-to-end. The MCP server is a thin, stable adapter over the backend contract `POST https://api.livecore.ai/api/v1/misc/openclaw/v1/execute`. No editing logic, shell, filesystem, or raw renderer lives here.

## Tools (39 Annotated Tools Unlocking All 195 Canonical Actions, 28 Read Tools & 100+ Craft Skills)

The surface supports **two complementary execution modes** plus typed management & polling:
- **Mode A — Goal Delegation (`autonomous_edit`, `autonomous_edit_streaming`, `queue_edit`):** Delegate a full creative brief to Levea's autonomous editing agent (inspects footage, executes actions iteratively, checks rendered frames, repairs issues, and exports).
- **Mode B — Universal Direct Canonical Control & Skill Discovery (`search_tools`, `get_action_schema`, `execute_action`, `execute_batch`, `render_preview`, `search_skills`, `load_skill`, `read_skill_resource`):** Drive any of the **195 canonical actions**, **28 read/inspection tools**, and **100+ production craft skills (`SKILL.md`)** directly from your own agent loop without invoking `autonomous_edit`, inspect real GPU-composited JPEG screenshots via `render_preview` (like `ffmpeg` frame grabs), and export via `EXPORT_VIDEO`.

### Mode A: Goal Delegation (1 + 2 variants)

| Tool | Mutates? | Async? |
|---|---|---|
| `autonomous_edit` (**primary**) | Yes | Yes — may auto-fire an export job |
| `autonomous_edit_streaming` (SSE — emits per-step progress notifications) | Yes | Yes |
| `queue_edit` (fire-and-forget; returns `taskId` for `check_task_status`) | Yes | Yes |

### Mode B: Universal Direct Canonical Suite (8)

| Tool | What it does |
|---|---|
| `search_tools` | Search all 195 canonical actions, 28 read tools, and preset catalogs (`captions`, `vfx`, `transitions`, `color_presets`, `title_cards`, `fonts`, `blend_modes`, `properties`, `animatable`); returns matching actions/presets and the 5-phase NLE `editorialPlaybook` |
| `get_action_schema` | Fetch the full JSON `inputSchema` and parameter constraints for any canonical action or read tool |
| `execute_action` | Execute any single canonical action (all 195 actions, e.g. `REMOVE_SILENCES`, `VERTICAL_REFRAME`, `COLOR_GRADE`, `GENERATE_CAPTIONS`, `PLAN_MOTION_GRAPHICS`, `GENERATE_MUSIC`, `AUTO_DUCK`, `EXPORT_VIDEO`) or read tool (`list_layers`, `query_transcript`, `inspect_layer`, `list_sources`, `search_shots`, `shot_timeline`, `read_source_transcript`, `measure_audio`, `measure_picture`, `measure_color`) directly on `project_id`. Pass `video_url` or `assets` on the first call to bootstrap a new project |
| `execute_batch` | Execute an ordered array of `{ action, params }` steps in one atomic round-trip with automatic safe-zone checks, timeline reconciliation, layout de-stacking, async asset completion, and project commit |
| `render_preview` | Render real GPU-composited JPEG screenshots at `timestamps: [...]` (with optional `0..1` `region` crop) showing all live video layers, captions, title cards, grades, and VFX; returns native MCP `image` blocks + `frames[]` so the agent can visually verify frames before `EXPORT_VIDEO` |
| `search_skills` | Search 100+ production craft skills (`SKILL.md` playbooks across editing, color grading, captions, audio mixing, motion graphics, VFX, documentary, podcast, and social shorts) |
| `load_skill` | Load the full craft playbook (`SKILL.md`) and bundled resource list for one or more skill IDs |
| `read_skill_resource` | Read a bundled reference or template file belonging to a production skill |

### ShaderFX — your own GPU effects (4)

Write WGSL (`fn fx(c: FxCtx) -> vec4<f32>`, ShaderFX ABI v2) for filters that read the footage (`src()`), transitions that read clip A / clip B (`clip_a()` / `clip_b()`), and generators. The server wraps and validates it (errors come back as `{ line, column, message }` in your source); preview and export run the same shader. ABI v3 adds named textures (a layer or an image URL: `tex_<name>()`), feedback (`prev()` for trails), multi-pass (`pass_<name>` / `buf_<name>`, e.g. bloom), a data buffer (`data` / `data_url`: charts, lookup tables) and geometry mode (instanced quads for particles and sprite sheets); `create_shader_effect` / `apply_shader_effect` take `textures`, `feedback`, `data` / `data_url`, `geometry`. Contract, output modes, params manifest and twelve worked examples (six v2, six v3): `load_skill({ skill_id: "shaderfx-effects" })` or [`skills/shaderfx-effects`](./skills/shaderfx-effects/SKILL.md).

| Tool | What it does |
|---|---|
| `create_shader_effect` | Validate + save `{ name, source, manifest }` to your effect library; returns the effect id (`CREATE_SHADER_EFFECT`) |
| `list_shader_effects` | List saved effects (`LIST_SHADER_EFFECTS`; `GET_SHADER_EFFECT` via `execute_action`) |
| `apply_shader_effect` | Put an effect (`effect_id`, or inline `source` + `manifest`) on a project as a `filter` (`target_layer_id`), `transition` (`from_layer_id` + `to_layer_id`) or `generator`, with `params`, `param_keyframes` (per-param animation), `start_time` / `end_time`, `output` (`APPLY_SHADER_EFFECT`). Transitions draw across the A/B overlap; clips meeting at a cut get one laid on media handles (`duration_sec`, default 0.8 s), else `SHADER_FX_NO_HANDLES` |
| `delete_shader_effect` | Delete a saved effect (`DELETE_SHADER_EFFECT`) |

### Job / task polling (3)

`check_job_status` (export jobs by numeric id), `check_task_status` (queued edits by taskId), `get_active_task` (currently-running edit for a project).

### History, checkpoints & variants (direct tools, via `execute_action` / `execute_batch`)

Every committed call is a saved version, so you can always go back:
- **`UNDO` / `REDO`** step back or forward **one** version. Versions you undo past are kept as an "abandoned redo branch" after a new edit; `list_versions` shows them and `restore_version { revision }` brings one back.
- **`restore_version { revision }` or `{ label }`** jumps to any saved version or checkpoint. It is itself a new version (UNDO reverses it), so no confirmation is needed. `scene_diff { from_revision, to_revision }` compares two versions.
- **`checkpoint { label }`** names the current version (e.g. "rough cut v1"). Automatic checkpoints: `auto: after assemble`, `auto: after first finishing`, `auto: before export`. Checkpoints outlive the 100-version cap (30 kept; oldest automatic ones go first).
- **Variants: try alternatives side by side.** `fork_variant { label }` copies the scene into a sibling branch; send later calls with `variant: "<id or label>"` beside `project_id` to edit it (the main scene and the editor UI are untouched). `list_variants`, `compare_variants { a, b, judge: true }` (layer diff, plus a rendered pairwise judgement of which edit is better), `promote_variant { variant }` (makes it the main scene; undoable), `delete_variant { variant, confirm_destructive: true }`.

### Late generation jobs (`APPLY_PENDING`)

A generation step (music, B-roll, images) that is still running when its call ends returns `pendingJobs`. Attach them later with `execute_action APPLY_PENDING { task_ids: [...], wait_for_completion: true }` (only jobs you launched on that project; a result whose scene a restore / undo moved off is not applied). A job's result is applied once: if the launching call already landed it, a later APPLY_PENDING reports nothing to do.

### Your own skills (2)

`save_skill` (`skill_md` or, with the local stdio server, `path`; stored as `user/<slug>`), `delete_skill`. `search_skills` lists them first; `autonomous_edit` / `queue_edit` apply them via `skills`, or always with frontmatter `apply: always`.

### Caption templates (5)

`list_caption_templates`, `apply_caption_template`, `save_caption_template`, `save_current_caption_template`, `delete_caption_template`. 216 built-in templates (e.g. hormozi, mrbeast, viral-pop, karaoke, neon-pop, subtitle-bar, spotlight) plus your saved templates; call `list_caption_templates` for the exact ids.

### Brand kits (5)

`list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit`, `delete_brand_kit`. Palette / fonts / logo / voice / gradeBias / enforcement. Pass returned id as `brandId` or `projectBrandId` on `autonomous_edit` to apply.

### Projects (4)

`list_projects`, `get_project`, `create_project`, `delete_project`.

### Assets (4)

`asset_upload_url` (signed PUT URL — upload local files via the API), `list_assets`, `delete_asset`, `transcribe_asset`.

### Your skills (2)

`save_skill` (save your own `SKILL.md` folder — `path` from the local npx server, or `skill_md` text — to your account as `user/<slug>`; frontmatter `apply: always`, `brand_id`, `caption_template`, `style_reference_url`), `delete_skill`. Saved skills appear in `search_skills` / `load_skill` / `read_skill_resource`; pass `skills: ["user/<slug>"]` on `autonomous_edit` / `queue_edit`.

### ShaderFX (4)

`create_shader_effect`, `list_shader_effects`, `apply_shader_effect`, `delete_shader_effect` — your own WGSL GPU filters, transitions and generators.

### History (inside `execute_action` / `execute_batch`)

`UNDO` / `REDO`, `revert_steps`, `checkpoint { label }`, `restore_version { revision | label }` (no confirmation, undoable; the redo branch is kept), `list_versions`, `scene_diff`, and variants: `fork_variant { label }`, then send calls with `variant: "<id or label>"`, `compare_variants { a, b, judge: true }`, `promote_variant`, `list_variants`, `delete_variant` (needs `confirm_destructive`). Restore receipts list side effects; async jobs never write into a scene a restore moved off.

### Diagnostics (1)

`editor_health` (unauthenticated connectivity probe).

Full input schemas are returned by `tools/list` over MCP.

### When to use Mode A (`autonomous_edit`) vs. Mode B (`search_tools` → `execute_action` / `execute_batch` → `render_preview`)

- **Use Mode A (`autonomous_edit`)** when the user gives a broad or creative goal ("Turn this podcast into 3 viral TikTok clips with Hormozi captions, B-roll, and music"). One call runs Levea's autonomous editing agent + 100+ craft skills end-to-end.
- **Use Mode B (`search_tools` → `execute_action` / `execute_batch` → `render_preview` → `EXPORT_VIDEO`)** when your agent wants 100% direct deterministic control, surgical tweaks that apply in about a second, custom timestamp math from local files, or an interactive `observe → edit → render_preview screenshot → adjust → export` loop without invoking our internal planner.
- **5-Phase NLE Execution Order for Mode B:**
  1. **Inspect:** `list_layers`, `query_transcript`, `list_sources`
  2. **Structure & Cuts:** `CLEAR`, `REGISTER_REMOTE_ASSET`, `SET_SOURCE_RANGE`, `TRIM_LAYER`, `SPLIT_LAYER`, `REMOVE_SILENCES`, `CONFIGURE_CANVAS`, `VERTICAL_REFRAME` *(always cut and resize before adding timed overlays/captions)*
  3. **Visuals & Overlays:** `COLOR_GRADE`, `APPLY_VFX`, `TITLE_CARD`, `PLAN_MOTION_GRAPHICS`, `GENERATE_CAPTIONS`, `STYLE_CAPTIONS`
  4. **Audio Mix:** `CLEAN_AUDIO`, `GENERATE_VOICEOVER`, `GENERATE_MUSIC`, `ADD_SFX`, `AUTO_DUCK`
  5. **Visual Screenshot Check & Deliver:** Call `render_preview` (`RENDER_PREVIEW`) to inspect GPU-composited JPEG screenshots, fix any visual overlap, then call `EXPORT_VIDEO` / `GENERATE_VIRAL_CLIPS`.

### How Skills Work (Built-In Craft Skills & Custom User `SKILL.md` Playbooks)

1. **Discover & Load Levea's 100+ Built-In Craft Skills over MCP:**
   - Call `search_skills({ query: "..." })` to find domain playbooks (captions, color grading, podcast cuts, documentary montage, motion graphics, VFX, audio mastering).
   - Call `load_skill({ skill_id: "..." })` to load the full `SKILL.md` craft instructions and list of bundled resources into your context.
   - Call `read_skill_resource({ skill_id: "...", resource: "references/..." })` to read specific reference tables or templates before executing actions via `execute_action` / `execute_batch`.
2. **Use or Author Custom `SKILL.md` Playbooks:**
   - Users can install our 12 starter skills (`npx skills add brajendrak00068/agentic-ai-video-production` or `clawhub install levea-ai-video-editor`) or place their own custom `SKILL.md` in `.claude/skills/`, `.cursor/skills/`, `~/.openclaw/skills/`, `~/.hermes/skills/`, or `~/.config/opencode/skills/`.
   - A custom `SKILL.md` can specify a fixed `brandId`, `captionTemplatePreset`, `style_reference_url`, and either a house-style `autonomous_edit` prompt template (Mode A) or a deterministic `execute_batch` + `render_preview` recipe (Mode B), and can call `load_skill` to compose Levea's built-in craft skills with the user's custom rules.
3. **Upload a user's skill to their Levea account (`save_skill`)** so Levea's own editing agent follows it too:
   - `save_skill({ path })` with the local stdio server (reads the `SKILL.md` folder), or `save_skill({ skill_md, resources })` from any client; saved as `user/<slug>`. Frontmatter `apply: always` applies it to every `autonomous_edit` / `queue_edit` of that user; otherwise pass `skills: ["user/<slug>"]`. `brand_id` / `caption_template` / `style_reference_url` in the frontmatter fill whatever the request leaves unset (the request wins).
   - `search_skills` lists the user's skills first (`mine: true` for only theirs); `load_skill` / `read_skill_resource` take `user/<slug>`; `delete_skill` removes one.

## How to call it well

1. **Send the user's intent verbatim.** Don't pre-decompose on the calling side. "Make 3 vertical TikTok clips with captions, sync to beat, export" is one `autonomous_edit` call — not four.
2. **Treat every call as expensive and long-running.** A single `autonomous_edit` can plan + execute many steps and trigger an auto-export. Minutes, not seconds: a full edit with motion graphics, music, and export can take 10–20 minutes. If the client's wait runs out first (5 min for `autonomous_edit`, 30 for `autonomous_edit_streaming`), the result is `status: "running"` with the `project_id`; the edit keeps running, so follow it with `get_active_task` instead of calling again. For full edits, prefer `queue_edit` + `check_task_status`. **Do not retry on transient errors without backoff**; never re-invoke as a substitute for polling.
3. **Mode B long calls wait for themselves.** `execute_action` / `execute_batch` / `render_preview` on slow steps (FACE_RETOUCH, LIPSYNC_VIDEO, generation, DETECT_* on a long source) keep the call open until the result is ready, up to `LEVEA_REQUEST_TIMEOUT_MS`. If one still answers ⏳ `running`, resend the **identical** call to keep waiting (it is never run twice) or call `check_task_status`. Do not change its params or start other edits on the project meanwhile. For a recipe for a common task (source window, exact length, captions, music + ducking, reframe, export with loudness), use `search_tools({ query })`: it returns the matching `editorialPlaybook.workflows`.
4. **Async / job pattern.** Mutating calls may return a `jobId`. Poll with `check_job_status` (or call with `wait: true` to block until terminal). Never re-invoke `autonomous_edit` to "check progress."
5. **Plan approval for irreversible work.** When the user's intent is destructive or hard to undo, set `requirePlanApproval: true` in `autonomous_edit` params — the editor stops after planning, returns the plan, waits for confirmation. Resume by re-calling with the returned `workingMemory` and `planDecision: "approve"` (an approval prompt such as `"yes"` also works), optionally with an `editedPlan`.
6. **Use `editor_health` for connection diagnostics**, not auth diagnostics — it's unauthenticated. A 200 here just means the host is reachable; a bad `LEVEA_API_KEY` will surface on the first `autonomous_edit` call.

## Response shape

Every tool call returns:

- `content: [{ type: "text", text }]` — a one-line human-readable summary (used for chat display).
- `structuredContent: {...}` — the full structured result. Read **this**, not the text, for state machines / agent loops.
- `isError: true` on failure — combined with `structuredContent.error`.

Fields you'll see on success: `success`, `message`, `videoUrl`, `jobId`, `status`, `data`.

## Auth & config

### 1. Hosted Streamable HTTP MCP (`https://api.livecore.ai/api/v1/misc/mcp`) — OAuth 2.1 (no API key needed)

Remote MCP clients (Cursor, Grok Bot, Claude.ai Connectors, ChatGPT) connect directly to `https://api.livecore.ai/api/v1/misc/mcp` using **MCP OAuth 2.1 with PKCE (`S256`) and Dynamic Client Registration (RFC 7591)**:

- **Advertised OAuth Scope**: `levea`
- **Protected Resource Metadata (RFC 9728)**: `https://api.livecore.ai/.well-known/oauth-protected-resource/api/v1/misc/mcp`
- **Authorization Server Metadata (RFC 8414)**: `https://api.livecore.ai/.well-known/oauth-authorization-server`
- **Dynamic Client Registration (RFC 7591)**: `https://api.livecore.ai/api/v1/misc/oauth/register`

With OAuth 2.1 (`scope="levea"`), no API key or `LEVEA_API_KEY` variable is needed to list tools or run video edits.

### 2. Local stdio MCP (`npx -y levea-mcp-server`) — Bearer API key

Set via the MCP client's `mcpServers[].env`. Canonical (v0.3.0+):

| Var | Required | Value |
|---|---|---|
| `LEVEA_API_URL` | yes | `https://api.livecore.ai` |
| `LEVEA_API_KEY` | yes | Generate at https://livecore.ai/?openclaw=1&utm_source=openclaw&utm_medium=plugin&utm_campaign=openclaw-ai-video-editor |

Backward compat: the legacy `ADSCENE_API_URL` / `ADSCENE_API_KEY` names are still read as a silent fallback; use `LEVEA_*`.

Optional: `LEVEA_REQUEST_TIMEOUT_MS` / `LEVEA_STREAM_TIMEOUT_MS` (how long a call waits before returning `running`), `LEVEA_TELEMETRY=off` (turns off the anonymous usage ping: event name, client version, whether a key is set).

The client never accepts a *full path* in `LEVEA_API_URL` — set only the host. The path `/api/v1/misc/openclaw/v1/execute` is appended automatically. Do not point at `/api/v1/misc/editor/` (different route, different auth model).

## Errors — how to react

| Signal | What it means | What to do |
|---|---|---|
| `isError: true` + 401/403 in message | Bad/expired `LEVEA_API_KEY` | Surface to user; tell them to regenerate at livecore.ai. **Do not retry.** |
| `isError: true` + "is required" | Env var missing | Surface; do not retry. |
| `isError: true` + 5xx / network | Transient backend | Retry **once** with backoff. Then surface. |
| `success: true`, `jobId` present | Async work running | Poll `check_job_status` — don't re-invoke `autonomous_edit`. |
| `success: true`, `videoUrl` present | Export landed | Show the URL to the user. Read `verificationReport.status`: only `verified` means the result passed its checks on the rendered frames; mention `qualityNotes`. |
| `status: "running"` (`type: "still_running"`) | The client stopped waiting; the edit is still running | Call `get_active_task` with the returned `project_id`; never re-invoke the edit. |
| `status: "awaiting_approval"` | Plan proposed (`requirePlanApproval: true`) | Show the plan; when the user agrees, call again with the returned `workingMemory` and `planDecision: "approve"`. |

## Cost-shaping recommendations

- The editor auto-exports after most mutating calls. If your user is mid-iteration, mention this so they don't get surprise renders.
- Batch related edits into one `autonomous_edit` brief instead of many sequential calls — the inner planner is far cheaper than N round-trips.
- For pure inspection ("what's in this scene?", "what does the transcript say?"), phrase it as a read-only intent inside `autonomous_edit` — the planner takes a non-mutating path and won't trigger auto-export.

## Safety boundary

Low-level operations (shell, ffmpeg flags, raw timeline JSON, filesystem) are **deliberately not exposed**. The backend allowlists canonical actions server-side; the MCP surface offers one high-level edit tool, four typed single-action edits that run through the same allowlisted operations, plus management and diagnostics. Trust this boundary; do not try to construct paths around it.

## Source

- Repo: https://github.com/brajendrak00068/agentic-ai-video-production
- npm: https://www.npmjs.com/package/levea-mcp-server
- MCP Registry: `io.github.brajendrak00068/levea-mcp-server`
