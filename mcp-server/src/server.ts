/**
 * Levea AI Video Editor — MCP server.
 *
 * Exposes the autonomous video editor + its surrounding management APIs
 * (caption templates, brand kits, projects, assets, async queue) to any MCP
 * client (Claude Desktop, Claude Code, Cursor, Cline, OpenClaw, Hermes, …)
 * over stdio (`index.ts`) or a hosted Streamable HTTP endpoint
 * (`createLeveaMcpServer` + `runWithLeveaConfig`).
 *
 * Architectural posture — **one agentic edit tool, four deterministic nudges,
 * many management tools**:
 *   - `autonomous_edit` is the editing entry point for anything that needs
 *     judgment. The backend planner owns intent decomposition, action
 *     selection, verification, and export. We deliberately do NOT expose
 *     per-capability shims (`add_captions`, `generate_viral_clips`, …) because
 *     they fragment the planner's visibility.
 *   - `create_shader_effect`, `list_shader_effects`, `apply_shader_effect`,
 *     `delete_shader_effect` run the ShaderFX (ABI v2) canonical actions through
 *     execute_action: user-written WGSL filters, transitions and generators.
 *   - All OTHER tools are read-only diagnostics or state-management CRUD
 *     (brand kits, projects, assets, caption templates).
 *
 * Config (env, set via the MCP client's `mcpServers` entry):
 *   LEVEA_API_URL   e.g. https://api.livecore.ai   (required)
 *   LEVEA_API_KEY   from https://livecore.ai/ (required)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { buildEditBody, editInputSchema } from './editContract';
import {
  execute,
  executeStreaming,
  getJobStatus,
  waitForJob,
  health,
  listCaptionTemplates,
  saveCaptionTemplate,
  saveCurrentCaptionTemplate,
  applyCaptionTemplate,
  deleteCaptionTemplate,
  queueEdit,
  getTaskStatus,
  getActiveTask,
  listBrandKits,
  getBrandKit,
  createBrandKit,
  updateBrandKit,
  deleteBrandKit,
  listProjects,
  getProject,
  createProject,
  deleteProject,
  assetUploadUrl,
  listAssets,
  deleteAsset,
  transcribeAsset,
  executeDeterministicTool,
  type ExecuteResult,
  type SSEEvent,
} from './client';

export { runWithLeveaConfig, type LeveaClientConfig } from './client';

export const PKG_VERSION: string =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('../package.json') as { version: string }).version;

// ───────────────────────────────────────────────────────────────────────────
// Tool schemas
// ───────────────────────────────────────────────────────────────────────────

// Input schemas come from the edit contract (see editContract.ts).
const AUTONOMOUS_EDIT_SCHEMA = editInputSchema('all');
const QUEUE_EDIT_SCHEMA = editInputSchema('queue');

const TOOL_DEFS: Tool[] = [
  // ── Editing — single tool ────────────────────────────────────────────────
  {
    name: 'autonomous_edit',
    description:
      'PRIMARY EDIT TOOL. Run a natural-language video edit end-to-end. The backend agent plans, executes, verifies, and exports. Accepts anything from a one-liner ("generate 3 viral clips with captions and export") to a multi-paragraph creative brief. Returns the final mp4 URL synchronously when an export is queued. For long renders you may prefer queue_edit + check_job_status.',
    inputSchema: AUTONOMOUS_EDIT_SCHEMA as unknown as Tool['inputSchema'],
  },
  {
    name: 'autonomous_edit_streaming',
    description:
      'Same as autonomous_edit but consumes the SSE event stream from the backend. Returns the final terminal result; per-step events (status, thinking, tool_call, tool_result, background_job_completed) are emitted as MCP progress notifications when the client supports them. Use for long-running briefs where users expect live progress.',
    inputSchema: AUTONOMOUS_EDIT_SCHEMA as unknown as Tool['inputSchema'],
  },
  {
    name: 'queue_edit',
    description:
      'Fire-and-forget async path. Returns immediately with a `taskId`. Use when the edit may exceed the MCP request timeout (long viral-clip generation, multi-format export). Poll with check_task_status or get_active_task.',
    inputSchema: QUEUE_EDIT_SCHEMA as unknown as Tool['inputSchema'],
  },

  // ── ShaderFX (ABI v2) — your own GPU effects, transitions and generators ──
  // Thin wrappers over execute_action with the matching canonical action
  // (CREATE/LIST/APPLY/DELETE_SHADER_EFFECT). The author contract (fx(c: FxCtx),
  // helpers, output modes, params manifest) is in the shaderfx-effects skill.
  {
    name: 'create_shader_effect',
    description:
      'Save a reusable ShaderFX (ABI v2 / v3) effect to your effect library. source is WGSL that defines fn fx(c: FxCtx) -> vec4<f32> returning straight (non-premultiplied) rgba; FxCtx = { uv (0..1 canvas, top-left), px, res (render-target px), time = local_time (seconds since the effect layer started), progress (transition: 0→1 across the overlap; else time / layer length), intensity, frame (v3) }. Predefined helpers: src(uv), backdrop(uv), clip_a(uv), clip_b(uv), param(i), param_color(i), hash2, noise2, fbm, luma, rotate2, plus a named accessor per manifest param (P_strength() …; float → f32, vec2/vec3 → vec2/vec3<f32>, color → vec4<f32>, bool → f32 0/1). The server wraps and validates it (naga) before storing: on failure nothing is saved and errors come back as [{ line, column, message }] in YOUR source lines — fix and resend. Returns effect_id and the param table (name, type, slot, accessor). overwrite: true replaces your effect of the same name. Source ≤ 24 KB (v3: 48 KB); keep loops bounded. v3 (auto when used): textures, feedback, multi-pass, data, geometry (instanced particles / sprites). Full contract + worked examples: load_skill shaderfx-effects.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Effect name (shown in list_shader_effects).' },
        source: { type: 'string', description: 'Author WGSL defining fn fx(c: FxCtx) -> vec4<f32> (plus any helper fns of your own). No bindings, no @fragment.' },
        manifest: {
          type: 'object',
          description: 'Effect manifest: { abi: 2, kind: "filter" | "transition" | "generator", output: "add" | "normal" | "replace", params: [{ name, type: "float" | "vec2" | "vec3" | "color" | "bool", min?, max?, default }] }. Slots: float/bool 1, vec2 2, vec3/color 4 (vec3/color start on a 4-slot boundary); total ≤ 32. kind defaults to filter, output to normal. Leave abi out: the server picks v3 automatically when a v3 field is present (an explicit abi: 3 is rejected). ABI v3 adds passes: [{ name, scale?: 1 | 0.5 | 0.25 }] (≤ 4; source defines fn pass_<name>(c), read with buf_<name>(uv)), textures: [{ name }] (≤ 4; tex_<name>(uv)), feedback: { enabled, warmup_sec?, clear? } (prev(uv)), geometry: { mode: "quads" | "points", count } (source defines fn instance(i, c) -> FxInstance and optional fn shade(p, c)).',
        },
        description: { type: 'string', description: 'Optional one-line description.' },
        textures: {
          type: 'array',
          description: '[ABI v3] Up to 4 named textures: [{ name, layer_id | asset_url, space?: "canvas" | "image" }]. layer_id = that layer rendered alone (canvas space by default); asset_url = a public png/jpg/webp ≤ 4096² (image space by default, e.g. sprite sheets). Read with tex_<name>(uv), tex_size_<name>().',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Texture name, [a-z][a-z0-9_]{0,23}.' },
              layer_id: { type: 'string', description: 'Layer whose picture is the texture.' },
              asset_url: { type: 'string', description: 'Public image URL.' },
              space: { type: 'string', enum: ['canvas', 'image'], description: 'Sampling space (default canvas for layer_id, image for asset_url).' },
            },
            required: ['name'],
          },
        },
        feedback: { type: 'object', description: '[ABI v3] { enabled: true, warmup_sec?: 0..4 (default 1), clear?: [r, g, b, a] }: prev(uv) reads this layer\'s previous output frame (trails, echoes). Previews re-render warmup_sec before the frame. { enabled: false } turns a saved effect\'s feedback off.' },
        data: { type: 'array', items: { type: 'number' }, description: '[ABI v3] Up to 16384 floats for data(i), data_len(), data_vec2(i), data_vec4(i) (charts, per-instance state, lookup tables).' },
        data_url: { type: 'string', description: '[ABI v3] Public http(s) / gs:// URL of a JSON array (or { data: [...] }) or CSV, resolved to floats at apply time (inline data wins).' },
        geometry: { type: 'object', description: '[ABI v3] { mode: "quads" (default) | "points", count: integer 1..65536 }: draw count instanced quads; the source defines fn instance(i: u32, c: FxCtx) -> FxInstance (pos canvas uv, size px, rotation rad, color, uv_rect, alive <= 0 culls) and optionally fn shade(p: FxPixel, c: FxCtx); no fx needed. Default shade: soft round point x color, or the first texture through uv_rect x color.' },
        is_public: { type: 'boolean', description: 'Share the effect publicly (default false).' },
        overwrite: { type: 'boolean', description: 'Replace your existing effect with the same name.' },
        project_id: { type: 'string', description: 'Optional project context.' },
      },
      required: ['name', 'source', 'manifest'],
    },
  },
  {
    name: 'list_shader_effects',
    description: 'List the ShaderFX effects in your library (id, name, description, kind, output, params). Pass an id to apply_shader_effect.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional name / description filter.' },
        include_public: { type: 'boolean', description: 'Also list public effects.' },
        limit: { type: 'number', description: 'Max effects to return.' },
        project_id: { type: 'string', description: 'Optional project context.' },
      },
      required: [],
    },
  },
  {
    name: 'apply_shader_effect',
    description:
      'Put a ShaderFX (ABI v2) effect on a project, committed immediately. Either a saved effect (effect_id) or inline source + manifest (validated first; errors come back with line/column). kind (optional: request, else manifest, else inferred from the layer ids) "filter": target_layer_id = the layer whose picture src() reads (omit = everything composited below); window = start_time/end_time, else the target\'s, else the whole timeline. "transition": from_layer_id (clip A) + to_layer_id (clip B); progress runs 0→1 across their overlap. Clips meeting at a cut get a duration_sec overlap (default 0.8 s) laid on media handles, program length unchanged; SHADER_FX_NO_HANDLES if neither clip has media beyond the cut (overlap them first or shorten duration_sec). "generator": paints on its own. params = values by manifest name; param_keyframes animates them. v3 inputs: textures, feedback, data / data_url, geometry. Then check with render_preview before export.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project whose committed scene is edited.' },
        effect_id: { type: 'string', description: 'Saved effect id (from create_shader_effect / list_shader_effects).' },
        source: { type: 'string', description: 'Inline author WGSL (alternative to effect_id; needs manifest).' },
        manifest: { type: 'object', description: 'Inline manifest (with source); may declare v3 passes / textures / feedback / geometry.' },
        kind: { type: 'string', enum: ['filter', 'transition', 'generator'], description: 'Effect kind; match the manifest kind.' },
        target_layer_id: { type: 'string', description: '[filter] Layer whose picture is src(); omit for the composited backdrop.' },
        from_layer_id: { type: 'string', description: '[transition] Outgoing clip A.' },
        to_layer_id: { type: 'string', description: '[transition] Incoming clip B.' },
        params: { type: 'object', description: 'Param values by manifest name, e.g. { "strength": 0.8, "tint": "#ffcc66", "direction": [1, 0] }. Unknown names are errors; floats clamp to min/max.' },
        textures: {
          type: 'array',
          description: '[ABI v3] Up to 4 named textures: [{ name, layer_id | asset_url, space?: "canvas" | "image" }]. layer_id = that layer rendered alone (canvas space by default); asset_url = a public png/jpg/webp ≤ 4096² (image space by default, e.g. sprite sheets). Read with tex_<name>(uv), tex_size_<name>().',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Texture name, [a-z][a-z0-9_]{0,23}.' },
              layer_id: { type: 'string', description: 'Layer whose picture is the texture.' },
              asset_url: { type: 'string', description: 'Public image URL.' },
              space: { type: 'string', enum: ['canvas', 'image'], description: 'Sampling space (default canvas for layer_id, image for asset_url).' },
            },
            required: ['name'],
          },
        },
        feedback: { type: 'object', description: '[ABI v3] { enabled: true, warmup_sec?: 0..4 (default 1), clear?: [r, g, b, a] }: prev(uv) reads this layer\'s previous output frame (trails, echoes). Previews re-render warmup_sec before the frame. { enabled: false } turns a saved effect\'s feedback off.' },
        data: { type: 'array', items: { type: 'number' }, description: '[ABI v3] Up to 16384 floats for data(i), data_len(), data_vec2(i), data_vec4(i) (charts, per-instance state, lookup tables).' },
        data_url: { type: 'string', description: '[ABI v3] Public http(s) / gs:// URL of a JSON array (or { data: [...] }) or CSV, resolved to floats at apply time (inline data wins).' },
        geometry: { type: 'object', description: '[ABI v3] { mode: "quads" (default) | "points", count: integer 1..65536 }: draw count instanced quads; the source defines fn instance(i: u32, c: FxCtx) -> FxInstance (pos canvas uv, size px, rotation rad, color, uv_rect, alive <= 0 culls) and optionally fn shade(p: FxPixel, c: FxCtx); no fx needed. Default shade: soft round point x color, or the first texture through uv_rect x color.' },
        data_columns: { type: 'array', items: { type: 'string' }, description: '[ABI v3] CSV data_url only: columns to read, as header names or 0-based indexes ("3"), row by row in this order.' },
        param_keyframes: {
          type: 'object',
          description: 'Animate params: { "<param name>": [{ "time": <timeline seconds>, "value": <param type>, "easing"?: "ease_out" }, ...] } with at least 2 keyframes each. vec/color keyframe per component; bool steps.',
        },
        start_time: { type: 'number', description: '[filter/generator] Timeline seconds the effect starts (ignored for transitions).' },
        end_time: { type: 'number', description: '[filter/generator] Timeline seconds the effect ends (ignored for transitions).' },
        duration_sec: { type: 'number', description: '[transition] Overlap length in seconds (default 0.8, at most half the shorter clip).' },
        easing: { type: 'string', description: '[transition] Easing of progress (default linear), e.g. ease_in_out.' },
        output: { type: 'string', enum: ['add', 'normal', 'replace'], description: 'Override the manifest output mode.' },
        intensity: { type: 'number', description: 'c.intensity for the layer (default 1).' },
        opacity: { type: 'number', description: 'Layer opacity 0..1 (default 1).' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'delete_shader_effect',
    description: 'Delete a saved ShaderFX effect from your library. Layers that already use it keep their own copy of the shader.',
    inputSchema: {
      type: 'object',
      properties: {
        effect_id: { type: 'string', description: 'Effect id to delete.' },
        project_id: { type: 'string', description: 'Optional project context.' },
      },
      required: ['effect_id'],
    },
  },

  // ── Job / task polling ───────────────────────────────────────────────────
  {
    name: 'check_job_status',
    description: 'Poll an export / async job by jobId (numeric). Supports wait:true to block until terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id to poll (numeric).' },
        wait: { type: 'boolean', description: 'Block until terminal state.' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'check_task_status',
    description: 'Poll a queued edit task by taskId (returned by queue_edit), or a direct tool call that answered status "running" (taskId "dc_…" from execute_action / execute_batch / render_preview: waits up to ~25 s for it, and its result is that call\'s full response once status is completed / failed). Direct calls already wait for their own result, so you rarely need this. Separate from job_id (exports).',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Task id from queue_edit, or a "dc_…" id from a direct call still running.' } },
      required: ['task_id'],
    },
  },
  {
    name: 'get_active_task',
    description: 'For a given project, return the currently-running edit task (if any). Useful for reconnecting MCP clients.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'Project id.' } },
      required: ['project_id'],
    },
  },

  // ── Caption templates ────────────────────────────────────────────────────
  {
    name: 'list_caption_templates',
    description: 'List the user\'s caption templates (builtin + saved). Returns slugs, display names, and style summaries.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'apply_caption_template',
    description: 'Apply a caption template to a scene synchronously (without going through autonomous_edit).',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template slug / id from list_caption_templates.' },
        project_id: { type: 'string', description: 'Project / scene id to apply to.' },
        scene: { type: 'object', description: 'Inline scene (alternative to project_id).' },
        mode: { type: 'string', enum: ['add', 'recreate', 'style', 'translate', 'clear', 'remove_fillers'] },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'save_caption_template',
    description: 'Save a new caption template definition the user can re-apply later.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name.' },
        style: { type: 'object', description: 'Style payload (font, color, position, animation, etc.).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
      },
      required: ['name', 'style'],
    },
  },
  {
    name: 'save_current_caption_template',
    description: 'Snapshot the caption styling currently applied to a project / scene as a reusable template.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project to snapshot from.' },
        name: { type: 'string', description: 'Template display name.' },
        scene: { type: 'object', description: 'Inline scene (alternative to project_id).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_caption_template',
    description: 'Delete a user-saved caption template by id.',
    inputSchema: {
      type: 'object',
      properties: { template_id: { type: 'string' } },
      required: ['template_id'],
    },
  },

  // ── Brand kits ───────────────────────────────────────────────────────────
  {
    name: 'list_brand_kits',
    description: 'List the user\'s brand profiles (palette, fonts, logo, voice, gradeBias). Returns ids you pass to autonomous_edit\'s brandId / projectBrandId.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_brand_kit',
    description: 'Fetch one brand profile by id.',
    inputSchema: {
      type: 'object',
      properties: { brand_id: { type: 'string' } },
      required: ['brand_id'],
    },
  },
  {
    name: 'create_brand_kit',
    description: 'Create a brand profile. Fields: name, palette {primary,secondary,accent,neutral,extras[]}, fonts {primary,secondary}, gradeBias (warm/cool/neutral/vivid/muted), forbiddenColors[], logoAssetUrl, voiceTone, enforcement (soft|hard).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        palette: { type: 'object' },
        fonts: { type: 'object' },
        gradeBias: { type: 'string', enum: ['warm', 'cool', 'neutral', 'vivid', 'muted'] },
        forbiddenColors: { type: 'array', items: { type: 'string' } },
        logoAssetUrl: { type: 'string' },
        voiceTone: { type: 'string' },
        enforcement: { type: 'string', enum: ['soft', 'hard'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_brand_kit',
    description: 'Update an existing brand profile by id. Body has the same shape as create_brand_kit.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_id: { type: 'string' },
        name: { type: 'string' },
        palette: { type: 'object' },
        fonts: { type: 'object' },
        gradeBias: { type: 'string' },
        forbiddenColors: { type: 'array', items: { type: 'string' } },
        logoAssetUrl: { type: 'string' },
        voiceTone: { type: 'string' },
        enforcement: { type: 'string' },
      },
      required: ['brand_id'],
    },
  },
  {
    name: 'delete_brand_kit',
    description: 'Delete a brand profile.',
    inputSchema: {
      type: 'object',
      properties: { brand_id: { type: 'string' } },
      required: ['brand_id'],
    },
  },

  // ── Projects ─────────────────────────────────────────────────────────────
  {
    name: 'list_projects',
    description: 'List the user\'s projects.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_project',
    description: 'Fetch one project\'s record by id (name, revision, dates) with a short layer index (id, type, role, name, start_time, end_time). The full scene JSON is several MB: pass include_scene: true only if you really need it. To read the edit, execute_action timeline_view is the compact whole-timeline view.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        include_scene: { type: 'boolean', description: 'true returns the full scene JSON (several MB) instead of the layer index.' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project. Optional initial brandId.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        brandId: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
  },

  // ── Assets ───────────────────────────────────────────────────────────────
  {
    name: 'asset_upload_url',
    description: 'Get a signed upload URL for a local file (so users do not have to host video / image / audio elsewhere before passing video_url to autonomous_edit). Body: { fileName, fileType?, contentType?, projectId? }. Returns { uploadUrl, fileUrl }; PUT the file bytes to uploadUrl, then pass fileUrl to autonomous_edit as video_url / in assets[].',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string' },
        fileType: { type: 'string', description: 'video | image | audio (heuristic from extension if omitted).' },
        contentType: { type: 'string', description: 'MIME type, e.g. video/mp4.' },
        projectId: { type: 'string', description: 'Optional project to associate the asset with.' },
      },
      required: ['fileName'],
    },
  },
  {
    name: 'list_assets',
    description: 'List the user\'s uploaded assets. Optional projectId filter.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        fileType: { type: 'string', description: 'Optional filter: video|image|audio.' },
      },
      required: [],
    },
  },
  {
    name: 'delete_asset',
    description: 'Delete an asset by file name (the path returned by asset_upload_url).',
    inputSchema: {
      type: 'object',
      properties: { fileName: { type: 'string' } },
      required: ['fileName'],
    },
  },
  {
    name: 'transcribe_asset',
    description: 'Transcribe an existing asset (cached after the first call). By default returns a compact answer: language, duration_sec, word_count, speakers, transcript_id and one page of sentence lines "[start s–end s] [speaker] text" in source seconds. detail "words" returns words with only text / start / end / speaker, paged with offset / limit; detail "full" returns the raw transcription record (very large).',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'Asset path.' },
        language: { type: 'string', description: 'Optional ASR language hint.' },
        detail: { type: 'string', enum: ['lines', 'words', 'full'], description: 'lines (default): sentence lines with start / end times. words: word-level text / start / end / speaker, paged. full: the raw transcription record (very large; avoid).' },
        offset: { type: 'integer', minimum: 0, description: 'First line (detail lines) or word (detail words) to return: next_offset from the previous page.' },
        limit: { type: 'integer', minimum: 1, description: 'Max lines / words in this page (words: default 500, max 1000). A page is also capped at about 12k tokens.' },
      },
      required: ['fileName'],
    },
  },

  // ── Diagnostics ──────────────────────────────────────────────────────────
  {
    name: 'editor_health',
    description: 'Connectivity diagnostic against LEVEA_API_URL. Unauthenticated.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },

  // ── Direct Canonical Tool Suite (Mode B: Bypass autonomous_edit) ─────────
  {
    name: 'search_tools',
    description:
      'Search every directly callable editing action, the read/inspection tools, AND preset catalogs (216 caption templates, 368 GPU VFX effects, 168 transitions, color LUTs, title cards, fonts, blend modes) by keyword, category, or catalog filter. With a query, matching actions come back WITH their parameter specs (required params end in "*"), so you usually do not need get_action_schema. Also returns the editorialPlaybook (fastest call pattern + NLE order). Call once with no query to see the whole surface.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search keyword (e.g. "karaoke", "hormozi", "lens_blur", "whip_pan", "teal_orange", "chromakey").' },
        catalog: {
          type: 'string',
          enum: ['all', 'actions', 'captions', 'vfx', 'transitions', 'color_presets', 'title_cards', 'fonts', 'blend_modes', 'properties', 'animatable'],
          description: 'Optional catalog filter: "captions" (216 caption templates), "vfx" (368 GPU effects), "transitions" (168 transitions), "color_presets" (LUTs), "title_cards", "fonts", "blend_modes", "properties", "animatable", "actions", or "all" (default).',
        },
        category: { type: 'string', description: 'Optional domain/category filter.' },
        limit: { type: 'number', description: 'Max actions to return (default: all matches; preset catalogs default to 50).' },
        include_schemas: { type: 'boolean', description: 'Force parameter specs on (true) or off (false). Default: on when 25 or fewer actions match.' },
        offset: { type: 'number', description: 'Page through a long result: pass the nextOffset a previous answer returned (answers stay under ~10k tokens).' },
        detail: { type: 'string', enum: ['summary', 'full'], description: '"summary" (default): one-line descriptions. "full": full action descriptions (pages sooner).' },
      },
      required: [],
    },
  },
  {
    name: 'get_action_schema',
    description:
      'Fetch the full JSON inputSchema, parameter constraints, and description for any canonical editor action (e.g. COLOR_GRADE, TRIM_LAYER, GENERATE_CAPTIONS, PLAN_MOTION_GRAPHICS, RENDER_PREVIEW, EXPORT_VIDEO) or read tool (e.g. list_layers, query_transcript, inspect_layer).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Canonical action name or read tool name.' },
        actions: { type: 'array', items: { type: 'string' }, description: 'Several action names at once (up to 40) — one round trip instead of many. They share one answer budget (~10k tokens): small schemas come whole, larger ones summarised (listed in `compacted`; schemaDetail.paramsOmitted names the rest).' },
        params: {
          oneOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
          ],
          description: 'Only these parameters, in full (nested schemas, every enum value): ["name", ...], or { "ACTION": ["name", ...] } per action with actions: [...]. Use it for the parameters a summarised schema lists in schemaDetail.paramsOmitted.',
        },
        detail: { type: 'string', enum: ['summary', 'full'], description: '"summary" (default): a very large schema is compacted to stay under ~10k tokens. "full": the whole schema as stored (CREATE_LAYER / UPDATE_LAYER are 200-380 KB).' },
      },
      required: [],
    },
  },
  {
    name: 'execute_action',
    description:
      'Execute any single canonical editor action (all 195 actions) or read/inspection tool (timeline_view, list_layers, inspect_layer, query_transcript, list_sources, search_shots, shot_timeline, read_source_transcript, measure_audio, measure_picture, measure_color) directly on a project scene without autonomous_edit. Pass video_url or assets on the first call to bootstrap a new project. Params accept references (@last, @primary, @all:<kind>, @end-3 …) so no id lookups are needed. Parameters are checked before anything runs (INVALID_PARAMS lists every problem with suggestions); dry_run: true checks without running. For several edits use execute_batch.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Canonical action name (e.g. REGISTER_REMOTE_ASSET, SET_SOURCE_RANGE, TRIM_LAYER, REMOVE_SILENCES, CONFIGURE_CANVAS, VERTICAL_REFRAME, COLOR_GRADE, APPLY_VFX, TITLE_CARD, PLAN_MOTION_GRAPHICS, GENERATE_CAPTIONS, STYLE_CAPTIONS, CLEAN_AUDIO, GENERATE_VOICEOVER, GENERATE_MUSIC, ADD_SFX, AUTO_DUCK, RENDER_PREVIEW, EXPORT_VIDEO) or read tool name (e.g. list_layers, query_transcript).' },
        action_params: { type: 'object', description: 'Parameters for the canonical action (see get_action_schema).' },
        project_id: { type: 'string', description: 'Project id for state persistence across calls.' },
        video_url: { type: 'string', description: 'Optional source video URL to seed a new project.' },
        assets: { type: 'array', items: { type: 'object' }, description: 'Optional media assets to seed a new project.' },
        scene: { type: 'object', description: 'Optional inline scene.' },
        include_scene: { type: 'boolean', description: 'If true, include the full raw scene JSON in the response (omitted by default in favor of liveLayers).' },
        idempotency_key: { type: 'string', description: 'Optional: your own id for this logical call. Resending with the same key returns the first answer instead of applying the edit twice (a resend of a call that answered "running" is deduplicated even without one).' },
        rerun: { type: 'boolean', description: 'true runs an identical call again on purpose instead of returning the earlier answer.' },
        dry_run: { type: 'boolean', description: 'true: check every step\'s parameters against its schema (unknown names, enum values, types, ranges) in under a second and return valid / problems / corrected_params; nothing runs or is committed. Send the same call without dry_run to run it.' },
        allow_unknown_params: { type: 'boolean', description: 'true runs the call even with parameters an action does not take (they are ignored and listed). Default false: any parameter problem refuses the call with INVALID_PARAMS before anything runs.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'execute_batch',
    description:
      'Execute an ordered array of canonical actions and/or read tools in one round trip without autonomous_edit — the fastest way to edit. Pro path for any edit that picks or reorders content (shorts, highlights, recuts): 1) seed once (video_url / assets; reuse the returned project_id on every later call) and read source_map — the WHOLE source in one reply (timed sentence lines per ~1-min section + measured loudness, pauses, speaker turns, shots), not page one of the transcript; 2) PLAN_EDITORIAL_CUT — a story plan: hook with a specific promise in the first 3 s, setup, a payoff that resolves the hook, ending (optionally HOOK_CANDIDATES to rank rendered openings); 3) ASSEMBLE_PICTURE_EDIT from that plan; 4) finishing batch (reframe, captions, B-roll via bin_search inserts so cutaways show the words being said, music + AUTO_DUCK, SFX, grade) — send it with dry_run: true first, then the same batch without it; 5) VERIFY_EDIT depth "editorial" — a critic that watches and hears the render and returns fixes for hook, payoff, arc, pacing, B-roll fit, captions, mix; apply them; 6) EXPORT_VIDEO (its polish gate fixes safe craft issues and returns a polish report). Surgical tweaks (one caption colour, one trim) skip straight to the batch. History: UNDO / REDO step one version; restore_version { revision } or { label } jumps to a saved version or checkpoint (undoable, no confirmation); name versions with checkpoint { label }; try alternatives with fork_variant / compare_variants / promote_variant (pass variant beside project_id to edit a variant). The whole batch is validated first: an unknown, non-callable or unconfirmed destructive action (destructive ones need confirm_destructive: true), and any parameter an action does not take or a value outside its enum / type / range (INVALID_PARAMS), rejects it before anything runs, listing every problem with did-you-mean suggestions; declared aliases are corrected and reported in corrected_params. Exact names: get_action_schema (several actions in one call). Up to 25 steps; atomic: if a step fails while running nothing is committed (allow_partial: true keeps the steps that succeeded). The response has a receipt per step. After the edits the server runs structural passes only (safe zones, timeline reconciliation) — never creative additions — and commits the scene to project_id. Results are unverified: check them with render_preview. EXPORT_VIDEO as the last step masters loudness automatically if MASTER_AUDIO was not called. Answers stay under ~10k tokens: a long read output in a batch is paged (its receipt names the start / offset that continues) and replyBudget lists anything shortened. query_transcript returns timed sentence lines (detail: "words" for per-word times); timeline_view is compact on a busy timeline (detail: "full" for every field).',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Ordered list of { action, params } steps to execute.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              params: { type: 'object' },
            },
            required: ['action'],
          },
        },
        project_id: { type: 'string', description: 'Project id for state persistence across calls.' },
        video_url: { type: 'string', description: 'Optional source video URL to seed a new project.' },
        assets: { type: 'array', items: { type: 'object' }, description: 'Optional media assets to seed a new project.' },
        scene: { type: 'object', description: 'Optional inline scene.' },
        include_scene: { type: 'boolean', description: 'If true, include the full raw scene JSON in the response (omitted by default in favor of liveLayers).' },
        idempotency_key: { type: 'string', description: 'Optional: your own id for this logical call. Resending with the same key returns the first answer instead of applying the edit twice (a resend of a call that answered "running" is deduplicated even without one).' },
        rerun: { type: 'boolean', description: 'true runs an identical call again on purpose instead of returning the earlier answer.' },
        dry_run: { type: 'boolean', description: 'true: check every step\'s parameters against its schema (unknown names, enum values, types, ranges) in under a second and return valid / problems / corrected_params; nothing runs or is committed. Send the same call without dry_run to run it.' },
        allow_unknown_params: { type: 'boolean', description: 'true runs the call even with parameters an action does not take (they are ignored and listed). Default false: any parameter problem refuses the call with INVALID_PARAMS before anything runs.' },
        allow_partial: { description: 'false (default): atomic. true: commit every step that succeeded. "until_failure": commit the steps before the first failure.' },
        confirm_destructive: { type: 'boolean', description: 'Required true for destructive actions (CLEAR, DELETE_LAYER on many layers, …).' },
      },
      required: ['actions'],
    },
  },
  {
    name: 'render_preview',
    description:
      'Render real GPU-composited JPEG screenshots of the live project timeline at specified timestamps (and optional normalized 0..1 region crop) — the Levea equivalent of ffmpeg frame extraction, showing all video layers, captions, title cards, color grades, masks, and VFX shaders. Returns native MCP image blocks so you can visually inspect the frames before calling EXPORT_VIDEO.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project id to render.' },
        timestamps: {
          type: 'array',
          items: { type: 'number' },
          description: 'Timeline timestamps in seconds to capture (e.g. [1.0, 5.0, 12.0]).',
        },
        region: {
          type: 'object',
          description: 'Optional normalized zoom region { x, y, width, height } in 0..1 coordinates.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        scene: { type: 'object', description: 'Optional inline scene.' },
      },
      required: [],
    },
  },
  {
    name: 'search_skills',
    description:
      'Search Levea production craft skills (SKILL.md playbooks across editing, color grading, captions, audio mixing, motion graphics, VFX, documentary, podcast, and social shorts) by keyword or category. Your own saved skills (save_skill) are listed first with source "user"; mine: true lists only yours.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword (e.g. "color", "caption", "podcast", "montage", "motion").' },
        mine: { type: 'boolean', description: 'Only your own saved skills (save_skill).' },
        category: { type: 'string', description: 'Optional category filter.' },
        limit: { type: 'number', description: 'Max skills to return (default 20).' },
      },
      required: [],
    },
  },
  {
    name: 'load_skill',
    description:
      'Load the full craft playbook (SKILL.md) and bundled resource list for one or more skill IDs returned by search_skills.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill ID to load (e.g. "color-grading-finishing", "caption-typography").' },
        skill_ids: { type: 'array', items: { type: 'string' }, description: 'Optional array of skill IDs to load.' },
      },
      required: [],
    },
  },
  {
    name: 'read_skill_resource',
    description:
      'Read a bundled reference or template file (e.g. "references/..." or "templates/...") belonging to a production skill.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill ID that owns the resource.' },
        resource: { type: 'string', description: 'Relative path of the resource inside the skill.' },
      },
      required: ['resource'],
    },
  },
  {
    name: 'save_skill',
    description:
      'Save (or update) one of your own SKILL.md playbooks on your Levea account, so the editor edits the way you do: your house style, a client\'s rules, how you pace and caption. It is kept as "user/<slug>" and works like a built-in skill: search_skills lists it first, load_skill loads it, and autonomous_edit / queue_edit apply it when named in `skills` — or on every edit when its frontmatter says apply: always. Frontmatter: name, description, tags, categories, actions (canonical action names), apply: always, and the style edits default to where the request sets none: brand_id, caption_template, style_reference_url. Pass skill_md (the text) or, with the local npx server, path (a SKILL.md file or the folder holding it; its text files such as references/*.md are uploaded as resources). Limits: 50 skills, 48k-character playbook, 12 resources / 128k characters.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_md: { type: 'string', description: 'The whole SKILL.md: YAML frontmatter (name, description, …) then the playbook in markdown.' },
        path: { type: 'string', description: 'Local npx server only: path to a SKILL.md file, or to the folder that holds SKILL.md (its other text files are uploaded as resources).' },
        resources: { type: 'object', description: 'Bundled text files, { "references/look.md": "…" }.', additionalProperties: { type: 'string' } },
        skill_id: { type: 'string', description: 'Slug to save under (default: the frontmatter name).' },
        apply_by_default: { type: 'boolean', description: 'Apply this skill to every autonomous_edit you run (overrides frontmatter apply).' },
      },
      required: [],
    },
  },
  {
    name: 'delete_skill',
    description: 'Delete one of your own saved skills ("user/<slug>").',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'The skill to delete ("user/<slug>").' },
      },
      required: ['skill_id'],
    },
  },
];

// Human-readable titles + safety hints for every tool (MCP tool annotations).
// Keyed by tool name; `satisfies` keeps this exhaustive against TOOL_DEFS.
type ToolName =
  | 'autonomous_edit' | 'autonomous_edit_streaming' | 'queue_edit'
  | 'create_shader_effect' | 'list_shader_effects' | 'apply_shader_effect' | 'delete_shader_effect'
  | 'check_job_status' | 'check_task_status' | 'get_active_task'
  | 'list_caption_templates' | 'apply_caption_template' | 'save_caption_template'
  | 'save_current_caption_template' | 'delete_caption_template'
  | 'list_brand_kits' | 'get_brand_kit' | 'create_brand_kit' | 'update_brand_kit' | 'delete_brand_kit'
  | 'list_projects' | 'get_project' | 'create_project' | 'delete_project'
  | 'asset_upload_url' | 'list_assets' | 'delete_asset' | 'transcribe_asset'
  | 'editor_health'
  | 'search_tools' | 'get_action_schema' | 'execute_action' | 'execute_batch' | 'render_preview'
  | 'search_skills' | 'load_skill' | 'read_skill_resource'
  | 'save_skill' | 'delete_skill';

const read = (title: string): ToolAnnotations => ({ title, readOnlyHint: true, openWorldHint: false });
const write = (title: string): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: false, openWorldHint: false });
const destructive = (title: string): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: true, openWorldHint: false });
// Edits fetch whatever public media URL the user passes, so they reach the open web.
const edit = (title: string): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: true, openWorldHint: true });

const TOOL_ANNOTATIONS = {
  // Edits can cut, replace, or remove content in the project, so they are marked destructive.
  autonomous_edit: edit('Edit video'),
  autonomous_edit_streaming: edit('Edit video (live progress)'),
  queue_edit: edit('Queue video edit'),
  // Deterministic edits touch only the project's own scene (no URL fetching).
  create_shader_effect: write('Create shader effect'),
  list_shader_effects: read('List shader effects'),
  apply_shader_effect: write('Apply shader effect'),
  delete_shader_effect: destructive('Delete shader effect'),
  check_job_status: read('Check job status'),
  check_task_status: read('Check task status'),
  get_active_task: read('Get active task'),
  list_caption_templates: read('List caption templates'),
  apply_caption_template: write('Apply caption template'),
  save_caption_template: write('Save caption template'),
  save_current_caption_template: write('Save current captions as template'),
  delete_caption_template: destructive('Delete caption template'),
  list_brand_kits: read('List brand kits'),
  get_brand_kit: read('Get brand kit'),
  create_brand_kit: write('Create brand kit'),
  update_brand_kit: destructive('Update brand kit'),
  delete_brand_kit: destructive('Delete brand kit'),
  list_projects: read('List projects'),
  get_project: read('Get project'),
  create_project: write('Create project'),
  delete_project: destructive('Delete project'),
  asset_upload_url: write('Get asset upload URL'),
  list_assets: read('List assets'),
  delete_asset: destructive('Delete asset'),
  transcribe_asset: write('Transcribe asset'),
  editor_health: read('Check editor health'),
  search_tools: read('Search canonical editor tools'),
  get_action_schema: read('Get canonical action schema'),
  execute_action: edit('Execute canonical editor action'),
  execute_batch: edit('Execute canonical action batch'),
  render_preview: read('Render GPU preview screenshots'),
  search_skills: read('Search production craft skills'),
  load_skill: read('Load production craft skill'),
  read_skill_resource: read('Read skill reference resource'),
  save_skill: write('Save your own skill'),
  delete_skill: destructive('Delete your own skill'),
} satisfies Record<ToolName, ToolAnnotations>;

export const TOOLS: Tool[] = TOOL_DEFS.map((tool) => {
  const annotations = (TOOL_ANNOTATIONS as Record<string, ToolAnnotations>)[tool.name];
  if (!annotations) throw new Error(`Missing annotations for MCP tool "${tool.name}"`);
  return { ...tool, title: annotations.title, annotations };
});

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}


function summarizeExec(r: ExecuteResult): string {
  const head = r.success ? '✅' : r.status === 'running' ? '⏳' : '❌';
  const lines = [`${head} ${r.message || r.reply || (r.success ? 'Done' : 'Failed')}`];
  if (r.videoUrl) lines.push(`📹 ${r.videoUrl}`);
  if (r.jobId !== undefined) lines.push(`🆔 job ${r.jobId}`);
  if (r.status) lines.push(`status: ${r.status}`);
  return lines.join('\n');
}

// Edit outcomes that carry success:false but are not errors: the client is
// expected to continue (approve the plan, answer a question, poll pending work,
// follow an edit that outlived the client's wait).
const NON_ERROR_OUTCOMES: ReadonlySet<string> = new Set(['awaiting_approval', 'awaiting_input', 'partial_success', 'still_running']);

// Every tool result goes through here. A backend failure must set `isError`
// (MCP clients read the flag, not the ❌ in the text).
function isFailure(structured: unknown): boolean {
  if (!structured || typeof structured !== 'object') return false;
  const r = structured as { success?: unknown; type?: unknown; raw?: { type?: unknown } };
  if (r.success !== false) return false;
  const outcome = String(r.type ?? r.raw?.type ?? '');
  return !NON_ERROR_OUTCOMES.has(outcome);
}
// Characters of the structured result carried as text (see resultContent).
const STRUCTURED_TEXT_MAX_CHARS = 60_000;

/**
 * The text blocks a tool result carries: the one-line summary, then the full
 * structured result as JSON. Many clients (Claude.ai connectors among them)
 * hand the model only the text content, so a result whose data lived only in
 * `structuredContent` reached the model as "✅ projects: 9 item(s)" with no
 * ids, no upload URL and no list. The MCP spec asks a tool that returns
 * structured content to also return it serialized in a text block. Bounded:
 * an over-long result says how much was cut and that the full object is in
 * structuredContent.
 */
type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

function resultContent(text: string, structured: unknown): McpContentBlock[] {
  const blocks: McpContentBlock[] = [{ type: 'text', text }];
  if (structured === undefined || structured === null) return blocks;
  const rawObj = (structured as any)?.raw ?? structured;
  const mcpBlocks = Array.isArray(rawObj?.mcpContent) ? rawObj.mcpContent : [];
  let json: string;
  try {
    json = JSON.stringify(structured, (k, v) => {
      if ((k === 'base64' || k === 'dataUrl' || k === 'frameImages' || k === 'mcpContent') && mcpBlocks.length > 0) {
        return '[omitted from text block — attached as MCP image block]';
      }
      return v;
    }, 2);
  } catch (err) {
    blocks.push({ type: 'text', text: `(result data could not be serialized as text: ${err instanceof Error ? err.message : String(err)}; it is in structuredContent)` });
    return blocks;
  }
  if (json !== undefined) {
    if (json.length > STRUCTURED_TEXT_MAX_CHARS) {
      const cut = json.length - STRUCTURED_TEXT_MAX_CHARS;
      json = `${json.slice(0, STRUCTURED_TEXT_MAX_CHARS)}\n… (${cut} more characters cut; the full result is in structuredContent)`;
    }
    blocks.push({ type: 'text', text: json });
  }
  for (const blk of mcpBlocks) {
    if (blk && blk.type === 'image' && typeof blk.data === 'string' && blk.data.length > 0) {
      blocks.push({
        type: 'image',
        data: blk.data,
        mimeType: typeof blk.mimeType === 'string' ? blk.mimeType : 'image/jpeg',
      });
    }
  }
  return blocks;
}

function ok(text: string, structured: unknown) {
  const failed = isFailure(structured);
  const content = resultContent(text, structured);
  return {
    content,
    structuredContent: withoutAttachedImages(structured, content) as Record<string, unknown>,
    ...(failed ? { isError: true } : {}),
  };
}
/**
 * Frames attached as MCP image blocks are not repeated as base64 in
 * structuredContent: clients such as Claude Code hand the model the structured
 * result, and 8 frames of base64 (~400 KB) overflow its output limit, cutting
 * off everything after them. Each frame keeps its metadata and says which image
 * block holds it.
 */
const IMAGE_DATA_KEYS: ReadonlySet<string> = new Set(['base64', 'dataUrl', 'frameImages', 'mcpContent']);
function withoutAttachedImages(structured: unknown, content: McpContentBlock[]): unknown {
  if (!structured || typeof structured !== 'object') return structured;
  if (!content.some((b) => b.type === 'image')) return structured;
  const strip = (v: unknown, depth: number): unknown => {
    if (depth > 4 || !v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => strip(x, depth + 1));
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (IMAGE_DATA_KEYS.has(k)) { if (k === 'base64') o.image = 'attached as an MCP image block'; continue; }
      o[k] = strip(x, depth + 1);
    }
    return o;
  };
  return strip(structured, 0);
}

/** A project record with its multi-MB scene replaced by a layer index (get_project without include_scene). */
function slimProject(r: unknown): unknown {
  const project = (r as { project?: Record<string, unknown> } | null)?.project;
  const scene = project?.scene as { layers?: unknown[]; duration?: unknown; canvas?: unknown; width?: unknown; height?: unknown } | undefined;
  if (!project || !scene || typeof scene !== 'object') return r;
  const layers = Array.isArray(scene.layers) ? scene.layers : [];
  const index = layers.slice(0, 200).map((l: any) => ({
    id: l?.id, type: l?.type, ...(l?.role ? { role: l.role } : {}), ...(l?.name ? { name: l.name } : {}),
    start_time: l?.start_time ?? l?.startTime, end_time: l?.end_time ?? l?.endTime,
  }));
  const { scene: _scene, ...rest } = project;
  return {
    ...(r as Record<string, unknown>),
    project: {
      ...rest,
      sceneSummary: {
        layerCount: layers.length,
        ...(scene.duration !== undefined ? { duration: scene.duration } : {}),
        ...(scene.canvas !== undefined ? { canvas: scene.canvas } : {}),
        layers: index,
        ...(layers.length > index.length ? { layersOmitted: layers.length - index.length } : {}),
        note: 'Full scene omitted (pass include_scene: true). execute_action timeline_view gives the whole edit as compact text.',
      },
    },
  };
}

function fail(text: string, structured?: unknown) {
  const data = (structured as Record<string, unknown>) ?? { error: text };
  return {
    content: resultContent(text, structured),
    structuredContent: data,
    isError: true,
  };
}

function summarizeAny(label: string, data: unknown): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (d.success === false) return `❌ ${label} failed: ${d.error || d.message || 'unknown'}`;
    const count =
      Array.isArray((d as any).items) ? (d as any).items.length :
      Array.isArray((d as any).templates) ? (d as any).templates.length :
      Array.isArray((d as any).brands) ? (d as any).brands.length :
      Array.isArray((d as any).projects) ? (d as any).projects.length :
      Array.isArray((d as any).assets) ? (d as any).assets.length :
      Array.isArray((d as any).data) ? ((d as any).data as unknown[]).length :
      undefined;
    return count !== undefined ? `✅ ${label}: ${count} item(s)` : `✅ ${label}`;
  }
  return `✅ ${label}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Dispatcher
// ───────────────────────────────────────────────────────────────────────────

interface DispatchCtx {
  notifyProgress?: (progress: number, total?: number, message?: string) => Promise<void>;
  /** The host's cancel signal: aborts the upstream request when the client goes away. */
  signal?: AbortSignal;
  /** The local stdio binary only: save_skill may read a SKILL.md from the user's disk (never on the hosted endpoint). */
  localFiles?: boolean;
}

const SKILL_TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'html', 'css', 'js', 'ts', 'svg', 'xml']);
const SKILL_UPLOAD_MAX_FILES = 12;
const SKILL_UPLOAD_MAX_FILE_BYTES = 64_000;

/**
 * A local SKILL.md (a file, or the folder holding SKILL.md) as save_skill's upload: the SKILL.md text and its folder's
 * other text files (recursively, skipping dot-folders and node_modules) as resources keyed by relative path.
 */
async function readLocalSkill(rawPath: string): Promise<{ skill_md: string; resources: Record<string, string> }> {
  const fs = await import('node:fs/promises');
  const pathMod = await import('node:path');
  const os = await import('node:os');
  const expanded = rawPath.startsWith('~/') ? pathMod.join(os.homedir(), rawPath.slice(2)) : rawPath;
  const target = pathMod.resolve(expanded);
  const stat = await fs.stat(target);
  const dir = stat.isDirectory() ? target : pathMod.dirname(target);
  const skillFile = stat.isDirectory() ? pathMod.join(target, 'SKILL.md') : target;
  const skill_md = await fs.readFile(skillFile, 'utf8');
  const resources: Record<string, string> = {};
  if (stat.isDirectory() || pathMod.basename(skillFile).toLowerCase() === 'skill.md') {
    const walk = async (d: string): Promise<void> => {
      for (const entry of await fs.readdir(d, { withFileTypes: true })) {
        if (Object.keys(resources).length >= SKILL_UPLOAD_MAX_FILES) return;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = pathMod.join(d, entry.name);
        if (entry.isDirectory()) { await walk(full); continue; }
        if (full === skillFile) continue;
        const ext = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase() : '';
        if (!SKILL_TEXT_EXTENSIONS.has(ext)) continue;
        const info = await fs.stat(full);
        if (info.size > SKILL_UPLOAD_MAX_FILE_BYTES) continue;
        resources[pathMod.relative(dir, full).split(pathMod.sep).join('/')] = await fs.readFile(full, 'utf8');
      }
    };
    await walk(dir);
  }
  return { skill_md, resources };
}

/** ShaderFX MCP tools → the canonical action each one runs through execute_action. */
const SHADER_FX_ACTIONS = {
  create_shader_effect: 'CREATE_SHADER_EFFECT',
  list_shader_effects: 'LIST_SHADER_EFFECTS',
  apply_shader_effect: 'APPLY_SHADER_EFFECT',
  delete_shader_effect: 'DELETE_SHADER_EFFECT',
} as const;

/** Events kept on a streaming result (the last ones, heartbeats excluded). */
const MAX_STREAM_EVENTS = 50;

async function dispatch(name: string, a: Record<string, unknown>, ctx: DispatchCtx) {
  switch (name) {
    case 'autonomous_edit': {
      if (!str(a.prompt)) return fail('❌ `prompt` is required for autonomous_edit.');
      const r = await execute(buildEditBody(a, 'all'), ctx.signal);
      return ok(summarizeExec(r), r);
    }

    case 'autonomous_edit_streaming': {
      if (!str(a.prompt)) return fail('❌ `prompt` is required for autonomous_edit_streaming.');
      const events: SSEEvent[] = [];
      let stepN = 0;
      const r = await executeStreaming(buildEditBody(a, 'all'), (ev) => {
        const dataObj = (typeof ev.data === 'object' ? ev.data : { raw: ev.data }) as Record<string, unknown>;
        const typeStr = String(ev.event || dataObj.type || 'event');
        if (typeStr !== 'heartbeat') {
          events.push(ev);
          if (events.length > MAX_STREAM_EVENTS) events.shift();
        }
        // Emit progress notifications to the MCP client (when supported).
        const msg =
          (dataObj.message as string | undefined) ||
          (dataObj.phase as string | undefined) ||
          (dataObj.summary as string | undefined) ||
          typeStr;
        if (ctx.notifyProgress && typeStr !== 'heartbeat') {
          stepN++;
          // Fire-and-forget; ignore failures (e.g. client doesn't honor notifications).
          ctx.notifyProgress(stepN, undefined, `${typeStr}: ${msg}`).catch(() => undefined);
        }
      }, ctx.signal);
      return ok(summarizeExec(r), { ...r, events });
    }

    case 'queue_edit': {
      if (!str(a.prompt)) return fail('❌ `prompt` is required for queue_edit.');
      const r = await queueEdit(buildEditBody(a, 'queue'));
      return ok(summarizeAny('queue_edit', r), r);
    }

    case 'create_shader_effect':
    case 'list_shader_effects':
    case 'apply_shader_effect':
    case 'delete_shader_effect': {
      const action = SHADER_FX_ACTIONS[name];
      const pid = str(a.project_id) || str(a.projectId);
      if (name === 'apply_shader_effect' && !pid) return fail('❌ `project_id` is required for apply_shader_effect (it edits a project\'s committed scene).');
      const { project_id: _p, projectId: _q, ...actionParams } = a;
      const r = (await executeDeterministicTool(
        'execute_action',
        pid,
        { action, action_params: actionParams, ...(pid ? { project_id: pid } : {}) },
        ctx.signal,
      )) as Record<string, unknown>;
      const head = r.success === false
        ? `❌ ${name} failed: ${r.error || r.message || 'unknown'}`
        : `✅ ${name}: ${r.observation || r.message || 'completed'}`;
      return ok(head, r);
    }

    case 'check_job_status': {
      const id = str(a.job_id);
      if (!id) return fail('❌ `job_id` is required.');
      const job = a.wait === true ? await waitForJob(id) : await getJobStatus(id);
      return ok(
        `${job.success ? '🔎' : '❌'} job ${job.jobId}: ${job.status} (${job.progress}%) ${job.message}${polishLine(job as unknown as Record<string, unknown>)}`,
        job
      );
    }

    case 'check_task_status': {
      const id = str(a.task_id);
      if (!id) return fail('❌ `task_id` is required.');
      const r = await getTaskStatus(id, id.startsWith('dc_'));
      return ok(summarizeAny(`task ${id}`, r), r);
    }

    case 'get_active_task': {
      const pid = str(a.project_id);
      if (!pid) return fail('❌ `project_id` is required.');
      const r = await getActiveTask(pid);
      return ok(summarizeAny(`active task for ${pid}`, r), r);
    }

    // Caption templates
    case 'list_caption_templates': {
      const r = await listCaptionTemplates();
      return ok(summarizeAny('caption_templates', r), r);
    }
    case 'apply_caption_template': {
      const tid = str(a.template_id);
      if (!tid) return fail('❌ `template_id` is required.');
      const r = await applyCaptionTemplate({
        templateSlug: tid,
        templateId: tid,
        projectId: str(a.project_id),
        scene: a.scene,
        mode: str(a.mode),
      });
      return ok(summarizeAny(`apply ${tid}`, r), r);
    }
    case 'save_caption_template': {
      const nm = str(a.name);
      if (!nm) return fail('❌ `name` is required.');
      if (!a.style) return fail('❌ `style` is required.');
      const r = await saveCaptionTemplate({ name: nm, style: a.style, tags: a.tags });
      return ok(summarizeAny('save_caption_template', r), r);
    }
    case 'save_current_caption_template': {
      const nm = str(a.name);
      if (!nm) return fail('❌ `name` is required.');
      const r = await saveCurrentCaptionTemplate({ name: nm, projectId: str(a.project_id), scene: a.scene });
      return ok(summarizeAny('save_current_caption_template', r), r);
    }
    case 'delete_caption_template': {
      const tid = str(a.template_id);
      if (!tid) return fail('❌ `template_id` is required.');
      const r = await deleteCaptionTemplate(tid);
      return ok(summarizeAny(`delete ${tid}`, r), r);
    }

    // Brand kits
    case 'list_brand_kits': {
      const r = await listBrandKits();
      return ok(summarizeAny('brand_kits', r), r);
    }
    case 'get_brand_kit': {
      const id = str(a.brand_id);
      if (!id) return fail('❌ `brand_id` is required.');
      const r = await getBrandKit(id);
      return ok(summarizeAny(`brand ${id}`, r), r);
    }
    case 'create_brand_kit': {
      const nm = str(a.name);
      if (!nm) return fail('❌ `name` is required.');
      const r = await createBrandKit({
        name: nm,
        palette: a.palette,
        fonts: a.fonts,
        gradeBias: str(a.gradeBias),
        forbiddenColors: a.forbiddenColors,
        logoAssetUrl: str(a.logoAssetUrl),
        voiceTone: str(a.voiceTone),
        enforcement: str(a.enforcement),
      });
      return ok(summarizeAny('create_brand_kit', r), r);
    }
    case 'update_brand_kit': {
      const id = str(a.brand_id);
      if (!id) return fail('❌ `brand_id` is required.');
      const body: Record<string, unknown> = {};
      for (const k of ['name', 'palette', 'fonts', 'gradeBias', 'forbiddenColors', 'logoAssetUrl', 'voiceTone', 'enforcement']) {
        if (a[k] !== undefined) body[k] = a[k];
      }
      const r = await updateBrandKit(id, body);
      return ok(summarizeAny(`update brand ${id}`, r), r);
    }
    case 'delete_brand_kit': {
      const id = str(a.brand_id);
      if (!id) return fail('❌ `brand_id` is required.');
      const r = await deleteBrandKit(id);
      return ok(summarizeAny(`delete brand ${id}`, r), r);
    }

    // Projects
    case 'list_projects': {
      const r = await listProjects();
      return ok(summarizeAny('projects', r), r);
    }
    case 'get_project': {
      const id = str(a.project_id);
      if (!id) return fail('❌ `project_id` is required.');
      const r = await getProject(id);
      const slim = a.include_scene === true ? r : slimProject(r);
      return ok(summarizeAny(`project ${id}`, slim), slim);
    }
    case 'create_project': {
      const nm = str(a.name);
      if (!nm) return fail('❌ `name` is required.');
      const r = await createProject({ name: nm, brandId: str(a.brandId), description: str(a.description) });
      return ok(summarizeAny('create_project', r), r);
    }
    case 'delete_project': {
      const id = str(a.project_id);
      if (!id) return fail('❌ `project_id` is required.');
      const r = await deleteProject(id);
      return ok(summarizeAny(`delete project ${id}`, r), r);
    }

    // Assets
    case 'asset_upload_url': {
      const fn = str(a.fileName);
      if (!fn) return fail('❌ `fileName` is required.');
      const r = await assetUploadUrl({
        fileName: fn,
        fileType: str(a.fileType),
        contentType: str(a.contentType),
        projectId: str(a.projectId),
      });
      return ok(summarizeAny('asset_upload_url', r), r);
    }
    case 'list_assets': {
      const query: Record<string, string> = {};
      if (a.projectId) query.projectId = String(a.projectId);
      if (a.fileType) query.fileType = String(a.fileType);
      const r = await listAssets(Object.keys(query).length > 0 ? query : undefined);
      return ok(summarizeAny('assets', r), r);
    }
    case 'delete_asset': {
      const fn = str(a.fileName);
      if (!fn) return fail('❌ `fileName` is required.');
      const r = await deleteAsset(fn);
      return ok(summarizeAny(`delete asset ${fn}`, r), r);
    }
    case 'transcribe_asset': {
      const fn = str(a.fileName);
      if (!fn) return fail('❌ `fileName` is required.');
      const r = await transcribeAsset({
        fileName: fn,
        language: str(a.language),
        detail: str(a.detail),
        offset: typeof a.offset === 'number' ? a.offset : undefined,
        limit: typeof a.limit === 'number' ? a.limit : undefined,
      });
      return ok(summarizeAny(`transcribe ${fn}`, r), r);
    }

    case 'editor_health': {
      const h = await health();
      return ok(`${h.ok ? '✅ backend reachable' : '❌ backend unreachable'}\n${h.detail}`, h);
    }

    case 'save_skill': {
      let body: Record<string, unknown> = { ...a };
      const localPath = str(a.path);
      if (localPath) {
        if (!ctx.localFiles) {
          return fail('❌ `path` works with the local server (npx levea-mcp-server), which can read your disk. Here, send the SKILL.md text as `skill_md` (and bundled files as `resources`).');
        }
        try {
          const local = await readLocalSkill(localPath);
          const given = (a.resources && typeof a.resources === 'object') ? a.resources as Record<string, unknown> : {};
          body = { ...a, skill_md: local.skill_md, resources: { ...local.resources, ...given } };
          delete body.path;
        } catch (err) {
          return fail(`❌ Could not read ${localPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!str(body.skill_md)) return fail('❌ `skill_md` (the SKILL.md text) or `path` is required.');
      const r = (await executeDeterministicTool('save_skill', undefined, body, ctx.signal)) as Record<string, unknown>;
      return ok(directHead('save_skill', r, 'saved'), r);
    }

    case 'search_tools':
    case 'get_action_schema':
    case 'execute_action':
    case 'execute_batch': {
      const pid = str(a.project_id) || str(a.projectId);
      const r = (await executeDeterministicTool(name, pid, a, ctx.signal)) as Record<string, unknown>;
      return ok(directHead(name, r, 'completed'), r);
    }

    case 'render_preview': {
      const pid = str(a.project_id) || str(a.projectId);
      const r = (await executeDeterministicTool('RENDER_PREVIEW', pid, a, ctx.signal)) as Record<string, unknown>;
      return ok(directHead('render_preview', r, 'rendered preview frames'), r);
    }

    default: {
      // Allow calling any of the 195 canonical actions or 28 read tools directly by name.
      const pid = str(a.project_id) || str(a.projectId);
      const r = (await executeDeterministicTool(name, pid, a, ctx.signal)) as Record<string, unknown>;
      return ok(directHead(name, r, 'completed'), r);
    }
  }
}

/**
 * The export polish gate's outcome as one summary line (its fixes and what it
 * left, each with the call that fixes it, are in structuredContent.polish),
 * so a client that shows only the text still sees that the gate ran.
 */
function polishLine(r: Record<string, unknown>): string {
  const p = r.polish as { status?: unknown; grade?: unknown; fixed?: unknown; remaining?: unknown; summary?: unknown } | undefined;
  if (!p || typeof p !== 'object') return '';
  const fixed = Array.isArray(p.fixed) ? p.fixed.length : 0;
  const remaining = Array.isArray(p.remaining) ? p.remaining.length : 0;
  const grade = typeof p.grade === 'string' ? `, grade ${p.grade}` : '';
  return `\n🧹 polish ${String(p.status ?? 'ran')}${grade}: ${fixed} fixed, ${remaining} left (see polish.fixed / polish.remaining)`;
}

/**
 * The one-line summary of a direct tool result: a call the backend is still
 * running (HTTP 202, status "running") is not a failure — it names the task to
 * poll; params the action did not take (ignored_params) are called out.
 */
function directHead(name: string, r: Record<string, unknown>, fallback: string): string {
  const taskId = typeof r.taskId === 'string' ? r.taskId : (typeof r.task_id === 'string' ? r.task_id : undefined);
  // An export job still rendering after the wait: poll the job, not the call.
  if (typeof r.exportHint === 'string') return `⏳ ${name}: ${r.exportHint}${polishLine(r)}`;
  if (r.status === 'running' && taskId) {
    const waited = typeof r.waitedSec === 'number' ? ` (waited ${r.waitedSec} s for it)` : '';
    const pd = r.progressDetail as { stepsDone?: number; stepsTotal?: number; currentAction?: string } | undefined;
    const where = pd && pd.stepsTotal ? ` Step ${Math.min(pd.stepsTotal, (pd.stepsDone ?? 0) + 1)} of ${pd.stepsTotal}${pd.currentAction ? ` (${pd.currentAction})` : ''}.` : '';
    return `⏳ ${name} is still running on Levea${waited}; nothing lost, never run twice.${where} To keep waiting, resend the identical call (it waits again and returns the full result when done) or call check_task_status { task_id: "${taskId}" }. Do not change the params while it runs.`;
  }
  const head = (r.success === false
    ? `❌ ${name} failed: ${r.error || r.message || 'unknown'}`
    : `✅ ${name}: ${r.observation || r.message || fallback}`) + polishLine(r);
  const ignored = Array.isArray(r.ignored_params) ? r.ignored_params : [];
  if (ignored.length === 0) return head;
  const names = ignored.flatMap((g: any) => Array.isArray(g?.ignored_params) ? g.ignored_params : [g])
    .map((i: any) => (i?.didYouMean ? `${i.param} (did you mean ${i.didYouMean}?)` : String(i?.param ?? '')))
    .filter(Boolean);
  return `${head}\n⚠ IGNORED params (no effect): ${names.join(', ')}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Server bootstrap
// ───────────────────────────────────────────────────────────────────────────

/**
 * Build an MCP server exposing the Levea tool surface. Transport-agnostic:
 * the stdio binary connects it to stdin/stdout; a hosted endpoint connects a
 * fresh instance per HTTP request inside `runWithLeveaConfig`.
 */
/**
 * Sent in the MCP `initialize` result so every client (Claude, Cursor, Codex,
 * OpenClaw, Hermes, …) sees how to use the surface before its first call,
 * instead of discovering it only if it happens to call search_tools.
 */
export const LEVEA_MCP_INSTRUCTIONS = [
  'Levea is a cloud video editor. Two ways to use it:',
  'A) Broad creative goal ("make 3 vertical clips with captions and music"): send the user\'s brief verbatim to autonomous_edit (or queue_edit + check_task_status for long edits). Never re-call it to check progress; on status "running" poll get_active_task.',
  'B) You drive the edit yourself (surgical changes, your own plan): use the direct tools. Fastest pattern, 3-4 calls total:',
  '  1. execute_batch of read tools (timeline_view = the whole edit as one short text block; query_transcript, list_sources, shot_timeline) — pass video_url or assets on this first call to seed a new project; keep the returned project_id and pass it on every later call. Do not send the scene back; the server keeps it.',
  '  2. ONE execute_batch with every edit in NLE order: structure & cuts (SET_SOURCE_RANGE, TRIM_LAYER, SPLIT_LAYER, REMOVE_SILENCES, CONFIGURE_CANVAS, VERTICAL_REFRAME — follows faces, or subject: "the product" to follow an object) before visuals (COLOR_GRADE, APPLY_VFX, TITLE_CARD, GENERATE_CAPTIONS, STYLE_CAPTIONS) before audio (CLEAN_AUDIO, GENERATE_MUSIC, ADD_SFX, AUTO_DUCK, MASTER_AUDIO).',
  '  3. render_preview at 2-4 timestamps and look at the frames; fix what you see with one more batch.',
  '  4. execute_action EXPORT_VIDEO → videoUrl, or a jobId to poll with check_job_status.',
  'Unsure of an action\'s params? search_tools with a query returns matching actions with param specs; get_action_schema takes actions: [..] for several at once. A batch (max 25 steps) is checked before anything runs and is atomic (allow_partial: true to keep successful steps); destructive actions need confirm_destructive: true. The server adds no creative content of its own on this path, and masters loudness at export if you skipped MASTER_AUDIO.',
  'Long direct calls (FACE_RETOUCH, LIPSYNC_VIDEO, generation, DETECT_* on a long source, export) wait for their own result, up to this server\'s request timeout. If one still answers ⏳ running, resend the identical call to keep waiting (it is never run twice; changed params start a new call) — do not loop on other tools meanwhile.',
  'Verify before export: render_preview frames for picture (titles, captions, faces, framing); inspect_layer for keyframes / effects / audio routing that timeline_view only lists; measure_audio for loudness and ducking.',
  'No id lookups between steps: params accept references — @last (layer the latest step created; also across calls), @last:<kind>, @step<N>, @primary (main video), @first:<kind>, @all:<kind> (bulk, in layer_ids) and times @end-3, @mid, @last.end+0.5. Kinds: video, audio, text, caption, title, broll, music, sfx or any role. Receipts list createdLayerIds.',
  'Bulk in one step: TRIM_LAYER { layer_id: "@primary", keep_ranges: [{start,end}] } keeps only those spans and stitches; UPDATE_LAYER { layer_ids: "@all:title", ... }; STYLE_CAPTIONS restyles every caption.',
  'Custom GPU shaders (WGSL fn fx(c: FxCtx); v3: textures, feedback, passes, data, particles): create_shader_effect then apply_shader_effect; contract + examples: load_skill shaderfx-effects.',
  'Craft playbooks: search_skills / load_skill. Brand kits and caption templates: list_brand_kits, list_caption_templates.',
  'The user\'s own style: save_skill uploads their SKILL.md (skill_md, or path with the local server) as "user/<slug>"; search_skills lists theirs first; autonomous_edit / queue_edit apply it via skills: ["user/<slug>"], or on every edit when it says apply: always. In your own loop, load_skill it and follow it.',
].join('\n');

export function createLeveaMcpServer(opts: { localFiles?: boolean } = {}): Server {
  const server = new Server(
    { name: 'levea-mcp-server', version: PKG_VERSION },
    { capabilities: { tools: {} }, instructions: LEVEA_MCP_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req: any, extra: any) => {
    const name = req.params.name;
    const args = (req.params.arguments || {}) as Record<string, unknown>;
    const progressToken = req.params._meta?.progressToken;
    const ctx: DispatchCtx = {
      // Sent on this request's own channel: the hosted endpoint is stateless and
      // has no standalone stream, so an unrelated notification would be dropped.
      notifyProgress: progressToken
        ? async (progress, total, message) => {
            const notification = { method: 'notifications/progress' as const, params: { progressToken, progress, total, message } };
            try {
              if (typeof extra?.sendNotification === 'function') await extra.sendNotification(notification);
              else await server.notification(notification, { relatedRequestId: extra?.requestId });
            } catch (_e) { /* swallow */ }
          }
        : undefined,
      signal: extra?.signal,
      ...(opts.localFiles ? { localFiles: true } : {}),
    };
    try {
      return await dispatch(name, args, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`❌ ${msg}`);
    }
  });

  return server;
}

export { handleLeveaMcpHttpRequest } from './http';
