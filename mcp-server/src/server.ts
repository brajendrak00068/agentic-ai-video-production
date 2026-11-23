/**
 * Levea AI Video Editor — MCP server.
 *
 * Exposes the autonomous video editor + its surrounding management APIs
 * (caption templates, brand kits, projects, assets, async queue) to any MCP
 * client (Claude Desktop, Claude Code, Cursor, Cline, OpenClaw, Hermes, …)
 * over stdio (`index.ts`) or a hosted Streamable HTTP endpoint
 * (`createLeveaMcpServer` + `runWithLeveaConfig`).
 *
 * Architectural posture — **one agentic edit tool, a direct canonical suite,
 * management tools**:
 *   - `autonomous_edit` is the editing entry point for anything that needs
 *     judgment. The backend planner owns intent decomposition, action
 *     selection, verification, and export.
 *   - `search_tools` / `get_action_schema` / `execute_action` / `execute_batch`
 *     / `render_preview` let a calling agent drive canonical actions itself.
 *   - `create_shader_effect`, `list_shader_effects`, `apply_shader_effect`,
 *     `delete_shader_effect` run the ShaderFX canonical actions through
 *     execute_action: user-written WGSL filters, transitions and generators.
 *   - All OTHER tools are read-only diagnostics or state-management CRUD
 *     (brand kits, projects, assets, caption templates, skills).
 *
 * Config (env, set via the MCP client's `mcpServers` entry):
 *   LEVEA_API_URL   default https://api.livecore.ai
 *   LEVEA_API_KEY   from https://livecore.ai/ (stdio only; the hosted endpoint uses OAuth)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
  type ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { buildEditBody, editInputSchema } from './editContract';
import {
  importHostFile,
  type HostFile,
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
  type ProgressFn,
} from './client';

export { runWithLeveaConfig, type LeveaClientConfig } from './client';

export const PKG_VERSION: string =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('../package.json') as { version: string }).version;

// ───────────────────────────────────────────────────────────────────────────
// Tool schemas
//
// tools/list is read into every calling model's context, so descriptions say
// what a tool is for and point at search_tools / load_skill for the details
// (no catalog counts: they drift).
// ───────────────────────────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

// Input schemas come from the edit contract (see editContract.ts).
const AUTONOMOUS_EDIT_SCHEMA = editInputSchema('all');
const QUEUE_EDIT_SCHEMA = editInputSchema('queue');

/**
 * autonomous_edit_streaming and queue_edit take autonomous_edit's fields; their
 * copies drop the per-field docs autonomous_edit already carries (fields of
 * their own keep theirs) to keep tools/list small.
 */
function withoutFieldDocs(schema: JsonSchema, keep: ReadonlySet<string> = new Set()): JsonSchema {
  const props = (schema.properties || {}) as Record<string, JsonSchema>;
  const documented = (AUTONOMOUS_EDIT_SCHEMA.properties || {}) as Record<string, JsonSchema>;
  return {
    ...schema,
    properties: Object.fromEntries(Object.entries(props).map(([k, v]) => {
      if (keep.has(k) || !documented[k]) return [k, v];
      const { description: _d, ...rest } = v;
      return [k, rest];
    })),
  };
}

// ShaderFX ABI v3 inputs shared by create_shader_effect and apply_shader_effect.
const SHADER_V3_PROPS: Record<string, JsonSchema> = {
  textures: {
    type: 'array',
    description: '[v3] Up to 4 named textures; read with tex_<name>(uv).',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '[a-z][a-z0-9_]{0,23}' },
        layer_id: { type: 'string', description: 'Layer rendered alone as the texture.' },
        asset_url: { type: 'string', description: 'Public png/jpg/webp ≤ 4096².' },
        space: { type: 'string', enum: ['canvas', 'image'] },
      },
      required: ['name'],
    },
  },
  feedback: { type: 'object', description: '[v3] { enabled, warmup_sec?, clear? }: prev(uv) reads the previous output frame.' },
  data: { type: 'array', items: { type: 'number' }, description: '[v3] Up to 16384 floats for data(i).' },
  data_url: { type: 'string', description: '[v3] URL of a JSON array or CSV, resolved to floats at apply time.' },
  geometry: { type: 'object', description: '[v3] { mode: "quads"|"points", count }: instanced particles drawn by fn instance(i, c).' },
};

// Files attached in the chat. ChatGPT cannot PUT bytes to asset_upload_url, so
// it passes attachments through `openai/fileParams` as { download_url, file_id }
// (Apps SDK: every file object declares all four properties and requires only
// download_url + file_id). The server copies each into Levea storage and seeds
// the project with it (first video → video_url, the rest → assets).
const HOST_FILE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    download_url: { type: 'string' },
    file_id: { type: 'string' },
    mime_type: { type: 'string' },
    file_name: { type: 'string' },
  },
  required: ['download_url', 'file_id'],
  additionalProperties: false,
};
const FILES_PROP: Record<string, JsonSchema> = {
  files: {
    type: 'array',
    items: HOST_FILE_SCHEMA,
    description: 'Video / audio / image files the user attached in this chat (ChatGPT fills this in). They are copied into Levea; the first video seeds the project (unless video_url is set), the rest become assets. Use this instead of asset_upload_url when the user uploaded the file to the chat.',
  },
};
/** Tools that take chat-attached files (`openai/fileParams`). */
const FILE_PARAM_TOOLS = new Set(['autonomous_edit', 'autonomous_edit_streaming', 'queue_edit', 'execute_action', 'execute_batch']);

/** The tool's input schema with the `files` field added. */
function withFiles(schema: Record<string, unknown>): Record<string, unknown> {
  return { ...schema, properties: { ...((schema.properties as Record<string, unknown>) || {}), ...FILES_PROP } };
}

// Fields shared by execute_action and execute_batch.
const DIRECT_COMMON_PROPS: Record<string, JsonSchema> = {
  project_id: { type: 'string', description: 'Project to edit; reuse the id the first call returned.' },
  video_url: { type: 'string', description: 'Source video URL to seed a new project (first call only).' },
  assets: { type: 'array', items: { type: 'object' }, description: 'Media assets to seed a new project (first call only).' },
  new_project: { type: 'boolean', description: 'With video_url / assets and no project_id: always create a new project, even if this source is already being edited in one (otherwise refused with SEED_DUPLICATE_PROJECT).' },
  variant: { type: 'string', description: 'Edit / read a variant (fork_variant id or label) of project_id instead of its main scene.' },
  ...FILES_PROP,
  scene: { type: 'object', description: 'Inline scene (advanced; the server keeps the project scene).' },
  include_scene: { type: 'boolean', description: 'Return the full scene JSON (large).' },
  idempotency_key: { type: 'string', description: 'Your id for this logical call: a resend returns the first answer instead of applying twice.' },
  rerun: { type: 'boolean', description: 'Run an identical call again on purpose.' },
  dry_run: { type: 'boolean', description: 'Only check params (fast); nothing runs.' },
  allow_unknown_params: { type: 'boolean', description: 'Run despite params an action does not take (they are ignored and listed).' },
  reconcile: { type: 'boolean', description: 'Default true: after a change, a structural finishing pass (safe-zone repair, timeline reconcile, layout de-stacking) runs; the response lists each run in finishingApplied and what it changed in structuralChanges. false: the pass does not run (finishingSkipped).' },
};

const TOOL_DEFS: Tool[] = [
  // ── Editing ──────────────────────────────────────────────────────────────
  {
    name: 'autonomous_edit',
    description:
      'PRIMARY EDIT TOOL. Runs a natural-language video edit end-to-end: Levea\'s editing agent plans, edits, checks the rendered frames and exports. Send the user\'s brief verbatim, from one line to a multi-paragraph creative brief. Waits up to 5 min, but a full edit can take 10-20 min: prefer queue_edit for long edits. The first progress notification names the project_id; if the wait ends first the result is status "running" — follow it with get_active_task, never re-send the edit.',
    inputSchema: withFiles(AUTONOMOUS_EDIT_SCHEMA) as Tool['inputSchema'],
  },
  {
    name: 'autonomous_edit_streaming',
    description:
      'autonomous_edit with live progress: same parameters (documented on autonomous_edit), per-step MCP progress notifications, waits up to 30 min. Returns the final result.',
    inputSchema: withFiles(withoutFieldDocs(AUTONOMOUS_EDIT_SCHEMA)) as Tool['inputSchema'],
  },
  {
    name: 'queue_edit',
    description:
      'Preferred for long edits: queues an autonomous edit and returns a taskId at once, so no client timeout applies. Same fields as autonomous_edit (documented there) plus platforms / autoExport. Poll check_task_status { task_id } or get_active_task { project_id }.',
    inputSchema: withFiles(withoutFieldDocs(QUEUE_EDIT_SCHEMA, new Set(['prompt']))) as Tool['inputSchema'],
  },

  // ── ShaderFX — your own GPU effects, transitions and generators ──────────
  // Thin wrappers over execute_action with the matching canonical action
  // (CREATE/LIST/APPLY/DELETE_SHADER_EFFECT). The author contract is in the
  // shaderfx-effects skill.
  {
    name: 'create_shader_effect',
    description:
      'Save a reusable ShaderFX effect: WGSL defining fn fx(c: FxCtx) -> vec4<f32> (straight rgba). Validated before saving; errors come back as [{ line, column, message }] in your source lines. Returns effect_id and the param table. FxCtx, helpers, manifest and v3 (textures, feedback, passes, data, particles) with examples: load_skill shaderfx-effects.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Effect name.' },
        source: { type: 'string', description: 'WGSL with fn fx(c: FxCtx) -> vec4<f32> (no bindings, no @fragment). ≤ 24 KB (v3: 48 KB).' },
        manifest: {
          type: 'object',
          description: '{ kind: "filter"|"transition"|"generator", output: "add"|"normal"|"replace", params: [{ name, type: float|vec2|vec3|color|bool, min?, max?, default }] }; v3 adds passes / textures / feedback / geometry. Leave abi out.',
        },
        description: { type: 'string', description: 'One-line description.' },
        ...SHADER_V3_PROPS,
        is_public: { type: 'boolean', description: 'Share publicly (default false).' },
        overwrite: { type: 'boolean', description: 'Replace your effect with the same name.' },
        project_id: { type: 'string', description: 'Optional project context.' },
      },
      required: ['name', 'source', 'manifest'],
    },
  },
  {
    name: 'list_shader_effects',
    description: 'List the ShaderFX effects in your library (id, name, kind, output, params). Pass an id to apply_shader_effect.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name / description filter.' },
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
      'Put a ShaderFX effect on a project (committed at once): a saved effect_id, or inline source + manifest. "filter": target_layer_id (omit = everything below), window start_time / end_time. "transition": from_layer_id + to_layer_id, overlap duration_sec (default 0.8) on media handles. "generator": paints on its own. params by manifest name; param_keyframes animates them. Check with render_preview. Details: load_skill shaderfx-effects.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project whose committed scene is edited.' },
        effect_id: { type: 'string', description: 'Saved effect id.' },
        source: { type: 'string', description: 'Inline WGSL (with manifest), instead of effect_id.' },
        manifest: { type: 'object', description: 'Inline manifest (with source).' },
        kind: { type: 'string', enum: ['filter', 'transition', 'generator'] },
        target_layer_id: { type: 'string', description: '[filter] Layer whose picture src() reads.' },
        from_layer_id: { type: 'string', description: '[transition] Outgoing clip.' },
        to_layer_id: { type: 'string', description: '[transition] Incoming clip.' },
        params: { type: 'object', description: 'Param values by manifest name, e.g. { "strength": 0.8 }.' },
        ...SHADER_V3_PROPS,
        data_columns: { type: 'array', items: { type: 'string' }, description: '[v3] CSV data_url columns (names or 0-based indexes).' },
        param_keyframes: { type: 'object', description: '{ "<param>": [{ time, value, easing? }, …] } (≥ 2 keyframes each).' },
        start_time: { type: 'number', description: '[filter/generator] Timeline start (s).' },
        end_time: { type: 'number', description: '[filter/generator] Timeline end (s).' },
        duration_sec: { type: 'number', description: '[transition] Overlap length (default 0.8).' },
        easing: { type: 'string', description: '[transition] Easing of progress, e.g. ease_in_out.' },
        output: { type: 'string', enum: ['add', 'normal', 'replace'], description: 'Override the manifest output mode.' },
        intensity: { type: 'number', description: 'c.intensity (default 1).' },
        opacity: { type: 'number', description: 'Layer opacity 0..1.' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'delete_shader_effect',
    description: 'Delete a saved ShaderFX effect. Layers already using it keep their own copy.',
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
    description: 'Poll an export / async job by jobId (numeric). wait: true blocks until it finishes (progress notifications while it renders).',
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
    description: 'Poll a queued edit by taskId (from queue_edit), or a direct call that answered status "running" (taskId "dc_…": waits up to ~25 s; its result is that call\'s full response once finished). Exports use check_job_status.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Task id from queue_edit, or a "dc_…" id.' } },
      required: ['task_id'],
    },
  },
  {
    name: 'get_active_task',
    description: 'The edit currently running on a project, if any. Use it to follow an edit whose call returned status "running" or whose client stopped waiting.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'Project id.' } },
      required: ['project_id'],
    },
  },

  // ── Caption templates ────────────────────────────────────────────────────
  {
    name: 'list_caption_templates',
    description: 'List caption templates (builtin + your saved ones): slugs, names, style summaries.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'apply_caption_template',
    description: 'Apply a caption template to a project directly (without autonomous_edit).',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template slug / id from list_caption_templates.' },
        project_id: { type: 'string', description: 'Project to apply to.' },
        scene: { type: 'object', description: 'Inline scene (alternative to project_id).' },
        mode: { type: 'string', enum: ['add', 'recreate', 'style', 'translate', 'clear', 'remove_fillers'] },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'save_caption_template',
    description: 'Save a new caption template you can re-apply later.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name.' },
        style: { type: 'object', description: 'Style (font, color, position, animation, …).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
      },
      required: ['name', 'style'],
    },
  },
  {
    name: 'save_current_caption_template',
    description: 'Save the caption styling currently on a project as a reusable template.',
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
    description: 'Delete one of your saved caption templates by id.',
    inputSchema: {
      type: 'object',
      properties: { template_id: { type: 'string' } },
      required: ['template_id'],
    },
  },

  // ── Brand kits ───────────────────────────────────────────────────────────
  {
    name: 'list_brand_kits',
    description: 'List your brand profiles (palette, fonts, logo, voice, gradeBias); pass an id as autonomous_edit brandId / projectBrandId.',
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
    description: 'Create a brand profile: name, palette {primary,secondary,accent,neutral,extras[]}, fonts {primary,secondary}, gradeBias, forbiddenColors[], logoAssetUrl, voiceTone, enforcement (soft|hard).',
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
    description: 'Update a brand profile by id (same fields as create_brand_kit).',
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
    description: 'List your projects.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_project',
    description: 'One project\'s record (name, revision, dates) with a short layer index. include_scene: true returns the full scene JSON (several MB); execute_action timeline_view is the compact view of the edit.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        include_scene: { type: 'boolean', description: 'Return the full scene JSON instead of the layer index.' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'create_project',
    description: 'Create a new project, optionally with a brandId.',
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
    description: 'Signed upload URL for a file on the caller\'s own disk. Returns { uploadUrl, fileUrl }: PUT the bytes to uploadUrl, then pass fileUrl as video_url / in assets[]. A file the user attached in a chat (ChatGPT) needs no upload: pass it in `files` on autonomous_edit / queue_edit / execute_batch / execute_action.',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string' },
        fileType: { type: 'string', description: 'video | image | audio (from the extension if omitted).' },
        contentType: { type: 'string', description: 'MIME type, e.g. video/mp4.' },
        projectId: { type: 'string', description: 'Optional project to associate the asset with.' },
      },
      required: ['fileName'],
    },
  },
  {
    name: 'list_assets',
    description: 'List your uploaded assets, optionally by projectId / fileType.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        fileType: { type: 'string', description: 'video | image | audio.' },
      },
      required: [],
    },
  },
  {
    name: 'delete_asset',
    description: 'Delete an asset by file name (the path asset_upload_url returned).',
    inputSchema: {
      type: 'object',
      properties: { fileName: { type: 'string' } },
      required: ['fileName'],
    },
  },
  {
    name: 'transcribe_asset',
    description: 'Transcribe an asset (cached). Default: language, duration, speakers, transcript_id and one page of timed sentence lines. detail "words": paged word timings; "full": the raw record (very large).',
    inputSchema: {
      type: 'object',
      properties: {
        fileName: { type: 'string', description: 'Asset path.' },
        language: { type: 'string', description: 'ASR language hint.' },
        detail: { type: 'string', enum: ['lines', 'words', 'full'] },
        offset: { type: 'integer', minimum: 0, description: 'next_offset from the previous page.' },
        limit: { type: 'integer', minimum: 1, description: 'Max lines / words per page (words: default 500, max 1000).' },
      },
      required: ['fileName'],
    },
  },

  // ── Diagnostics ──────────────────────────────────────────────────────────
  {
    name: 'editor_health',
    description: 'Connectivity check against the Levea API (unauthenticated).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },

  // ── Direct canonical suite (drive the editor yourself) ───────────────────
  {
    name: 'search_tools',
    description:
      'Search the directly callable editing actions, read/inspection tools and preset catalogs (caption templates, GPU VFX, transitions, color LUTs, title cards, fonts, blend modes). With a query, matching actions come back with their parameter specs (required params end in "*"). Also returns the editorialPlaybook (fastest call pattern, NLE order, pro workflow). No query = the whole surface.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword, e.g. "karaoke", "whip_pan", "teal_orange", "chromakey".' },
        catalog: {
          type: 'string',
          enum: ['all', 'actions', 'captions', 'vfx', 'transitions', 'color_presets', 'title_cards', 'fonts', 'blend_modes', 'properties', 'animatable'],
          description: 'Catalog filter (default all).',
        },
        category: { type: 'string', description: 'Domain / category filter.' },
        limit: { type: 'number', description: 'Max results (preset catalogs default to 50).' },
        include_schemas: { type: 'boolean', description: 'Force parameter specs on / off (default on for ≤ 25 matches).' },
        offset: { type: 'number', description: 'nextOffset from a previous page.' },
        detail: { type: 'string', enum: ['summary', 'full'], description: 'summary (default) or full action descriptions.' },
      },
      required: [],
    },
  },
  {
    name: 'get_action_schema',
    description:
      'Full input schema and constraints of canonical actions (e.g. COLOR_GRADE, TRIM_LAYER, GENERATE_CAPTIONS, EXPORT_VIDEO) or read tools (e.g. query_transcript, inspect_layer).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action or read tool name.' },
        actions: { type: 'array', items: { type: 'string' }, description: 'Several names at once (up to 40); large schemas are summarised (see `compacted`, schemaDetail.paramsOmitted).' },
        params: { type: 'array', items: { type: 'string' }, description: 'Only these parameters, in full (nested schemas, every enum value).' },
        params_by_action: {
          type: 'object',
          additionalProperties: { type: 'array', items: { type: 'string' } },
          description: 'Per-action parameter lists with actions: [...], e.g. { "COLOR_GRADE": ["lut"] }.',
        },
        detail: { type: 'string', enum: ['summary', 'full'], description: 'summary (default, ≤ ~10k tokens) or the whole stored schema.' },
      },
      required: [],
    },
  },
  {
    name: 'execute_action',
    description:
      'Run one canonical editor action or read tool (timeline_view, list_layers, inspect_layer, query_transcript, list_sources, shot_timeline, measure_audio, measure_picture, …) on a project. Pass video_url or assets on the first call to seed a project. Params accept references (@last, @primary, @all:<kind>, @end-3 …). Params are checked first (INVALID_PARAMS with suggestions). Several edits: execute_batch.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Canonical action (e.g. TRIM_LAYER, VERTICAL_REFRAME, COLOR_GRADE, GENERATE_CAPTIONS, EXPORT_VIDEO) or read tool name.' },
        action_params: { type: 'object', description: 'The action\'s parameters (search_tools / get_action_schema).' },
        ...DIRECT_COMMON_PROPS,
      },
      required: ['action'],
    },
  },
  {
    name: 'execute_batch',
    description:
      'Run an ordered list of canonical actions and/or read tools (≤ 25 steps) in one round trip. The whole batch is validated before anything runs (unknown actions, bad params → INVALID_PARAMS with suggestions; destructive actions need confirm_destructive: true) and is atomic unless allow_partial: the first failed step stops it and nothing is saved (BATCH_STEP_FAILED). One receipt per step. A structural finishing pass runs after the steps unless reconcile: false (finishingApplied). Without project_id the result is not saved (persisted: false). Results are unverified: check with render_preview before EXPORT_VIDEO. Pro workflow (source_map → PLAN_EDITORIAL_CUT → ASSEMBLE_PICTURE_EDIT → finishing → VERIFY_EDIT → EXPORT_VIDEO), history (UNDO, restore_version, checkpoint, fork_variant): search_tools editorialPlaybook.',
    inputSchema: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'Ordered { action, params } steps.',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              params: { type: 'object' },
            },
            required: ['action'],
          },
        },
        ...DIRECT_COMMON_PROPS,
        allow_partial: {
          anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['until_failure'] }],
          description: 'false (default): the first failed step stops the batch and nothing is saved (failureCode BATCH_STEP_FAILED, failedStepIndex). true: every step runs and the ones that succeeded are saved; the response then has success: false, partial: true and failedSteps. "until_failure": the steps before the first failure are saved and the rest are not run.',
        },
        confirm_destructive: { type: 'boolean', description: 'Required true for destructive actions (CLEAR, bulk DELETE_LAYER, …).' },
      },
      required: ['actions'],
    },
  },
  {
    name: 'render_preview',
    description:
      'Render GPU-composited JPEG frames of the live timeline at given timestamps (optional 0..1 region crop): every layer, caption, title, grade and effect. Returns MCP image blocks to inspect before EXPORT_VIDEO.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project to render.' },
        variant: { type: 'string', description: 'Render a variant (fork_variant id or label) of project_id instead of its main scene.' },
        timestamps: { type: 'array', items: { type: 'number' }, description: 'Timeline seconds, e.g. [1, 5, 12].' },
        region: {
          type: 'object',
          description: 'Zoom region in 0..1 coordinates.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        scene: { type: 'object', description: 'Inline scene (advanced).' },
      },
      required: [],
    },
  },
  {
    name: 'search_skills',
    description:
      'Search Levea craft playbooks (SKILL.md: editing, color, captions, audio mixing, motion graphics, VFX, documentary, podcast, social shorts). Your own saved skills come first (source "user"); mine: true lists only yours.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword, e.g. "color", "podcast", "motion".' },
        mine: { type: 'boolean', description: 'Only your own saved skills.' },
        category: { type: 'string', description: 'Category filter.' },
        limit: { type: 'number', description: 'Max skills (default 20).' },
      },
      required: [],
    },
  },
  {
    name: 'load_skill',
    description: 'Load the full playbook (SKILL.md) and resource list of one or more skills from search_skills.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill id, e.g. "color-grading-finishing".' },
        skill_ids: { type: 'array', items: { type: 'string' }, description: 'Several skill ids.' },
      },
      required: [],
    },
  },
  {
    name: 'read_skill_resource',
    description: 'Read a bundled reference or template file ("references/…", "templates/…") of a skill.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill that owns the resource.' },
        resource: { type: 'string', description: 'Relative path inside the skill.' },
      },
      required: ['resource'],
    },
  },
  {
    name: 'save_skill',
    description:
      'Save (or update) your own SKILL.md playbook as "user/<slug>" so the editor edits your way. search_skills lists it first, load_skill loads it, and autonomous_edit / queue_edit apply it when named in `skills` (or always, with frontmatter apply: always). Frontmatter: name, description, tags, categories, actions, apply, brand_id, caption_template, style_reference_url. Pass skill_md, or with the local npx server a path. Limits: 50 skills, 48k-character playbook, 12 resources.',
    inputSchema: {
      type: 'object',
      properties: {
        skill_md: { type: 'string', description: 'The whole SKILL.md (YAML frontmatter, then markdown).' },
        path: { type: 'string', description: 'Local npx server only: a SKILL.md file or its folder (other text files upload as resources).' },
        resources: { type: 'object', description: 'Bundled text files, { "references/look.md": "…" }.', additionalProperties: { type: 'string' } },
        skill_id: { type: 'string', description: 'Slug to save under (default: frontmatter name).' },
        apply_by_default: { type: 'boolean', description: 'Apply to every autonomous_edit (overrides frontmatter).' },
      },
      required: [],
    },
  },
  {
    name: 'delete_skill',
    description: 'Delete one of your saved skills ("user/<slug>").',
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

/**
 * Strict-client schema hygiene (Gemini, OpenAI strict mode): every free-form
 * object says so (additionalProperties: true) and every array has items.
 * Works on a copy: the contract's field schemas are shared objects.
 */
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'properties' && v && typeof v === 'object') {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, strictSchema(pv)]));
    } else if (k === 'items' || k === 'additionalProperties' || k === 'anyOf') {
      out[k] = strictSchema(v);
    } else {
      out[k] = v;
    }
  }
  if (out.type === 'object' && out.properties === undefined && out.additionalProperties === undefined) out.additionalProperties = true;
  if (out.type === 'array' && out.items === undefined) out.items = {};
  return out;
}

/** A tool as listed over MCP (name, description, inputSchema, title, annotations). */
export interface LeveaTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown };
  annotations?: Record<string, unknown>;
  [k: string]: unknown;
}

export const TOOLS: LeveaTool[] = TOOL_DEFS.map((tool) => {
  const annotations = (TOOL_ANNOTATIONS as Record<string, ToolAnnotations>)[tool.name];
  if (!annotations) throw new Error(`Missing annotations for MCP tool "${tool.name}"`);
  return {
    ...tool,
    inputSchema: strictSchema(tool.inputSchema) as LeveaTool['inputSchema'],
    title: annotations.title,
    annotations,
    ...(FILE_PARAM_TOOLS.has(tool.name) ? { _meta: { 'openai/fileParams': ['files'] } } : {}),
  };
});

/** Registered tool names: anything else is refused (never forwarded to the backend). */
const TOOL_NAMES: ReadonlySet<string> = new Set(TOOLS.map((t) => t.name));

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
  const pid = r.projectId || r.project_id;
  if (pid) lines.push(`project_id: ${pid}`);
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

type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** A result small enough to carry whole in the text block. */
const TEXT_DATA_MAX_CHARS = 6_000;
/** Never repeated in the text block (images ride as image blocks; scenes are MBs; raw is a legacy alias). */
const NOT_IN_TEXT: ReadonlySet<string> = new Set(['base64', 'dataUrl', 'frameImages', 'mcpContent', 'scene', 'raw']);

/** A depth- and length-bounded copy for the text block: ids, statuses, URLs and messages survive; bulk does not. */
function compactForText(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return v.length > 400 ? `${v.slice(0, 400)}… (${v.length} chars)` : v;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    if (depth >= 3) return `[${v.length} items]`;
    const head = v.slice(0, 12).map((x) => compactForText(x, depth + 1));
    return v.length > 12 ? [...head, `… ${v.length - 12} more`] : head;
  }
  if (depth >= 3) return '{…}';
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (NOT_IN_TEXT.has(k)) continue;
    o[k] = compactForText(x, depth + 1);
  }
  return o;
}

/**
 * The content blocks of a tool result: the one-line summary, then the result
 * data as compact JSON for clients that hand the model only text (Claude.ai
 * connectors among them). structuredContent always carries the complete
 * result; the text copy is whole only when small, otherwise a bounded digest
 * (ids, status, URLs, messages, errors) that says where the rest is.
 * workingMemory (needed to approve a plan) is always kept whole.
 */
function resultContent(text: string, structured: unknown): McpContentBlock[] {
  const blocks: McpContentBlock[] = [{ type: 'text', text }];
  if (structured === undefined || structured === null) return blocks;
  const obj = structured as Record<string, any>;
  const mcpBlocks: any[] = Array.isArray(obj?.mcpContent) ? obj.mcpContent : [];
  let json: string | undefined;
  try {
    json = JSON.stringify(structured, (k, v) => (NOT_IN_TEXT.has(k) ? undefined : v));
    if (json !== undefined && json.length > TEXT_DATA_MAX_CHARS) {
      const digest = compactForText(structured, 0) as Record<string, unknown>;
      if (obj && typeof obj === 'object' && obj.workingMemory !== undefined) digest.workingMemory = obj.workingMemory;
      let d = JSON.stringify(digest);
      if (d.length > TEXT_DATA_MAX_CHARS * 2 && obj.workingMemory === undefined) d = `${d.slice(0, TEXT_DATA_MAX_CHARS * 2)}…`;
      json = `${d}\n(digest of a ${json.length}-character result; the complete result is in structuredContent)`;
    }
  } catch (err) {
    json = `(result data could not be serialized as text: ${err instanceof Error ? err.message : String(err)}; it is in structuredContent)`;
  }
  if (json !== undefined) blocks.push({ type: 'text', text: json });
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
  /** One progress line (counter kept per call); undefined when the request has no progressToken. */
  progress?: ProgressFn;
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

/**
 * Chat-attached files (`files`) → the inputs the backend reads: each file is
 * copied into Levea storage; the first video seeds the project as video_url
 * (unless one was given), every other file joins assets[]. `files` itself is
 * never forwarded.
 */
async function resolveHostFiles(a: Record<string, unknown>, ctx: DispatchCtx): Promise<Record<string, unknown>> {
  if (!('files' in a)) return a;
  const { files, ...rest } = a;
  const list = (Array.isArray(files) ? files : files ? [files] : []).filter(
    (f): f is HostFile => !!f && typeof f === 'object' && typeof (f as HostFile).download_url === 'string' && (f as HostFile).download_url.trim() !== '',
  );
  if (list.length === 0) return rest;
  ctx.progress?.(`copying ${list.length} attached file(s) into Levea`);
  const imported = [];
  for (const f of list) imported.push(await importHostFile(f, ctx.signal));
  const out: Record<string, unknown> = { ...rest };
  const assets = Array.isArray(rest.assets) ? [...(rest.assets as unknown[])] : [];
  for (const file of imported) {
    if (file.kind === 'video' && !str(out.video_url)) {
      out.video_url = file.url;
      continue;
    }
    assets.push({ url: file.url, type: file.kind, ...(file.mimeType ? { mimeType: file.mimeType } : {}) });
  }
  if (assets.length > 0) out.assets = assets;
  const notes = imported.filter((f) => f.note).map((f) => `${f.name}: ${f.note}`);
  if (notes.length > 0) ctx.progress?.(notes.join('; '));
  return out;
}

async function dispatch(name: string, input: Record<string, unknown>, ctx: DispatchCtx) {
  const a = FILE_PARAM_TOOLS.has(name) ? await resolveHostFiles(input, ctx) : input;
  switch (name) {
    case 'autonomous_edit': {
      if (!str(a.prompt)) return fail('❌ `prompt` is required for autonomous_edit.');
      const r = await execute(buildEditBody(a, 'all'), ctx.signal, ctx.progress);
      return ok(summarizeExec(r), r);
    }

    case 'autonomous_edit_streaming': {
      if (!str(a.prompt)) return fail('❌ `prompt` is required for autonomous_edit_streaming.');
      let eventCount = 0;
      const t0 = Date.now();
      const r = await executeStreaming(buildEditBody(a, 'all'), (ev) => {
        const dataObj = (typeof ev.data === 'object' ? ev.data : { text: ev.data }) as Record<string, unknown>;
        const typeStr = String(ev.event || dataObj.type || 'event');
        if (typeStr === 'heartbeat') {
          ctx.progress?.(`still working (${Math.round((Date.now() - t0) / 1000)} s elapsed)`);
          return;
        }
        eventCount++;
        const msg =
          (dataObj.message as string | undefined) ||
          (dataObj.phase as string | undefined) ||
          (dataObj.summary as string | undefined) ||
          typeStr;
        ctx.progress?.(`${typeStr}: ${msg}`);
      }, ctx.signal, ctx.progress);
      return ok(summarizeExec(r), { ...r, eventCount });
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
        ctx.progress,
      )) as Record<string, unknown>;
      const head = r.success === false
        ? `❌ ${name} failed: ${r.error || r.message || 'unknown'}`
        : `✅ ${name}: ${r.observation || r.message || 'completed'}`;
      return ok(head, r);
    }

    case 'check_job_status': {
      const id = str(a.job_id);
      if (!id) return fail('❌ `job_id` is required.');
      const job = a.wait === true
        ? await waitForJob(id, { signal: ctx.signal, onProgress: ctx.progress })
        : await getJobStatus(id, ctx.signal);
      return ok(
        `${job.success ? '🔎' : '❌'} job ${job.jobId}: ${job.status} (${job.progress}%) ${job.message}${polishLine(job as unknown as Record<string, unknown>)}`,
        job
      );
    }

    case 'check_task_status': {
      const id = str(a.task_id);
      if (!id) return fail('❌ `task_id` is required.');
      const r = await getTaskStatus(id, id.startsWith('dc_'), ctx.signal);
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
      const r = (await executeDeterministicTool('save_skill', undefined, body, ctx.signal, ctx.progress)) as Record<string, unknown>;
      return ok(directHead('save_skill', r, 'saved'), r);
    }

    case 'search_tools':
    case 'get_action_schema':
    case 'execute_action':
    case 'execute_batch': {
      const pid = str(a.project_id) || str(a.projectId);
      let args = a;
      // get_action_schema: per-action param lists travel to the backend as `params` (its map form).
      if (name === 'get_action_schema' && a.params_by_action && typeof a.params_by_action === 'object') {
        const { params_by_action, ...rest } = a;
        args = { ...rest, params: params_by_action };
      }
      const r = (await executeDeterministicTool(name, pid, args, ctx.signal, ctx.progress)) as Record<string, unknown>;
      return directResult(name, r, 'completed');
    }

    case 'render_preview': {
      const pid = str(a.project_id) || str(a.projectId);
      const r = (await executeDeterministicTool('RENDER_PREVIEW', pid, a, ctx.signal, ctx.progress)) as Record<string, unknown>;
      return directResult('render_preview', r, 'rendered preview frames');
    }

    default: {
      // Registered tools without a case of their own (search_skills, load_skill,
      // read_skill_resource, delete_skill) run as direct tools of the same name.
      // Unregistered names never reach here (refused in the CallTool handler).
      const pid = str(a.project_id) || str(a.projectId);
      const r = (await executeDeterministicTool(name, pid, a, ctx.signal, ctx.progress)) as Record<string, unknown>;
      return directResult(name, r, 'completed');
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
  const receipts: any[] = Array.isArray(r.stepReceipts) ? r.stepReceipts : [];
  const head = (receipts.length > 0 ? stepsReport(name, r, receipts) : (r.success === false
    ? `❌ ${name} failed: ${r.error || r.message || 'unknown'}`
    : `✅ ${name}: ${r.observation || r.message || fallback}`)) + polishLine(r);
  const ignored = Array.isArray(r.ignored_params) ? r.ignored_params : [];
  if (ignored.length === 0) return head;
  const names = ignored.flatMap((g: any) => Array.isArray(g?.ignored_params) ? g.ignored_params : [g])
    .map((i: any) => (i?.didYouMean ? `${i.param} (did you mean ${i.didYouMean}?)` : String(i?.param ?? '')))
    .filter(Boolean);
  return `${head}\n⚠ IGNORED params (no effect): ${names.join(', ')}`;
}

/** First line of an observation, at most `max` characters; `cut` says whether anything was left out. */
function firstLine(text: unknown, max = 300): { line: string; cut: boolean } {
  const s = String(text ?? '').trim();
  const nl = s.indexOf('\n');
  const line = nl >= 0 ? s.slice(0, nl) : s;
  if (line.length > max) return { line: `${line.slice(0, max)}…`, cut: true };
  return { line, cut: nl >= 0 };
}

/**
 * The text of a direct call that ran steps, built from the backend response:
 * the outcome, one ✅ / ❌ line per step receipt with its observation, the
 * steps not run, then the project + revision, whether the edit was saved,
 * each run of the finishing pass, deliverable warnings and the exported
 * video. The full response is in structuredContent (every receipt in full).
 */
function stepsReport(name: string, r: Record<string, any>, receipts: any[]): string {
  const lines: string[] = [];
  if (r.partial === true) {
    lines.push(`⚠️ ${name}: partial — ${Array.isArray(r.failedSteps) ? r.failedSteps.length : 'some'} step(s) failed; the steps that succeeded were applied.`);
  } else if (r.success === false) {
    lines.push(`❌ ${name} failed${r.failureCode ? ` (${r.failureCode})` : ''}: ${firstLine(r.error || r.message || 'unknown').line}`);
  } else {
    lines.push(`✅ ${name}: ${receipts.length} step(s) succeeded.`);
  }
  let anyCut = false;
  for (const s of receipts) {
    const obs = firstLine(s?.observation);
    anyCut = anyCut || obs.cut;
    lines.push(`${s?.success ? '✅' : '❌'} ${String(s?.action ?? 'step')}${s?.failureCode ? ` [${s.failureCode}]` : ''}: ${obs.line}`);
  }
  if (Array.isArray(r.notRun) && r.notRun.length > 0) {
    lines.push(`⏭ not run: ${r.notRun.map((n: any) => `step ${n?.step} ${n?.action}`).join(', ')}`);
  }
  if (anyCut) lines.push('(observations shortened to their first line; full receipts: structuredContent.stepReceipts)');
  // An unsaved call answers with the scratch scene's id, which is no project.
  if (typeof r.projectId === 'string' && r.projectId && r.persisted !== false) {
    lines.push(`project ${r.projectId}${r.projectRevision !== undefined && r.projectRevision !== null ? ` · revision ${r.projectRevision}` : ''}`);
  }
  if (typeof r.persisted === 'boolean') {
    lines.push(`persisted: ${r.persisted}${r.persistWarning ? ` — ${r.persistWarning}` : ''}`);
  } else if (r.committed === false) {
    lines.push('committed: false (nothing was saved)');
  }
  if (Array.isArray(r.finishingApplied)) {
    lines.push(r.finishingApplied.length > 0
      ? `finishing pass: ${r.finishingApplied.map((f: any) => `${f?.pass} (${f?.changed ? 'changed the scene: structuralChanges' : 'no change'})`).join('; ')}`
      : `finishing pass: not run${r.finishingSkipped ? ` (${r.finishingSkipped})` : ''}`);
  }
  for (const w of Array.isArray(r.deliverableWarnings) ? r.deliverableWarnings : []) lines.push(`⚠ ${String(w)}`);
  if (typeof r.videoUrl === 'string' && r.videoUrl) lines.push(`📹 ${r.videoUrl}`);
  if (r.jobId !== undefined && r.jobId !== null) lines.push(`🆔 job ${r.jobId}`);
  return lines.join('\n');
}

/**
 * A direct tool's MCP result. Beyond ok()'s rule, a partial batch (some steps
 * failed, the others saved: success false, type partial_success) is an error
 * here: the agent asked for every step. A call still running is not.
 */
function directResult(name: string, r: Record<string, unknown>, fallback: string) {
  const result = ok(directHead(name, r, fallback), r);
  return r.success === false && r.partial === true && r.status !== 'running' ? { ...result, isError: true } : result;
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
 * Sent in the MCP `initialize` result: what the surface is and how it behaves,
 * so every client (Claude, Cursor, Codex, OpenClaw, Hermes, …) knows before its
 * first call. Facts only — the calling agent decides how to edit.
 */
export const LEVEA_MCP_INSTRUCTIONS = [
  'Levea is a cloud video editor with two modes:',
  '- autonomous_edit (also autonomous_edit_streaming, queue_edit): Levea plans and executes an edit from a natural-language prompt. Calling it again does not report progress: an edit that answers status "running" is polled with get_active_task { project_id } (queue_edit: check_task_status { task_id }).',
  '- Direct tools (execute_action, execute_batch, render_preview, the shader-effect tools): you plan; Levea executes each action exactly as given and reports what happened.',
  'search_tools lists the canonical actions and read tools; get_action_schema returns an action\'s parameter schema (actions: [..] for several).',
  'State lives in a project. A call that sends video_url / assets without project_id creates a project and returns its projectId; pass project_id on every later call. Any other call without project_id is not saved (persisted: false). The server keeps the project\'s scene: calls with project_id do not send scene back (an inline scene is ignored when the project has one).',
  'execute_batch is validated before anything runs (INVALID_PARAMS lists every problem); destructive actions need confirm_destructive: true. It stops at the first failed step and saves nothing (failureCode BATCH_STEP_FAILED, failedStepIndex), unless allow_partial is set.',
  'After a call changes the scene, a structural finishing pass (safe-zone repair, timeline reconcile, layout de-stacking) runs unless reconcile: false; the response lists each run in finishingApplied and what it changed in structuralChanges.',
  'Step params accept references instead of ids: @last, @last:<kind>, @step<N>, @primary, @first:<kind>, @all:<kind>, and times such as @end-3 or @last.end+0.5. Receipts list createdLayerIds.',
  'A call still running on the server answers ⏳ running: an identical resend waits for it and is never applied twice.',
  'EXPORT_VIDEO masters loudness to a delivery target first when the edit has no MASTER_AUDIO (master_audio: false on the step skips it).',
  'render_preview returns GPU-composited frames of the timeline; the measure_* read tools (measure_audio, measure_picture, measure_color) return measurements.',
  'Craft skills (search_skills, load_skill, read_skill_resource) are optional reference material.',
  'The user\'s own skills: save_skill stores a SKILL.md (skill_md, or path with the local server) as "user/<slug>"; search_skills lists them first; autonomous_edit / queue_edit apply one via skills: ["user/<slug>"], or on every edit when its frontmatter says apply: always; load_skill returns it; delete_skill removes it.',
].join('\n');

/** The MCP server createLeveaMcpServer returns (an SDK `Server`; typed structurally so the package's .d.ts needs no SDK install). */
export interface LeveaMcpServer {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

export function createLeveaMcpServer(opts: { localFiles?: boolean } = {}): LeveaMcpServer {
  const server = new Server(
    { name: 'levea-mcp-server', version: PKG_VERSION },
    { capabilities: { tools: {} }, instructions: LEVEA_MCP_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as Tool[] }));

  server.setRequestHandler(CallToolRequestSchema, async (req: any, extra: any) => {
    const name = req.params.name;
    if (typeof name !== 'string' || !TOOL_NAMES.has(name)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown tool "${String(name)}". tools/list has the ${TOOLS.length} Levea tools; run a canonical action with execute_action { action: "${String(name)}" } (search_tools lists them).`,
      );
    }
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
    if (ctx.notifyProgress) {
      // MCP progress must increase on every notification: one counter per call.
      let n = 0;
      const notify = ctx.notifyProgress;
      ctx.progress = (message: string) => { n++; void notify(n, undefined, message).catch(() => undefined); };
    }
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

/** Serve a Levea MCP server over stdin/stdout (the `levea-mcp-server` binary). */
export async function connectStdio(server: LeveaMcpServer): Promise<void> {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  await server.connect(new StdioServerTransport());
}
