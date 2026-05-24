import axios from 'axios';
import { definePluginEntry } from 'openclaw/plugin-sdk/core';

/**
 * Levea Agentic Video Editor — OpenClaw plugin.
 *
 * Thin adapter: every edit goes through the backend's `autonomous_edit` so the
 * agent owns planning, execution, verification, and export. We deliberately do
 * NOT re-expose the deterministic tool allowlist here — clients (and the
 * OpenClaw host) call a single tool with a natural-language prompt and the
 * backend agent figures out the rest. Same surface as the MCP server and the
 * Hermes wrapper — one tool, one contract.
 */

interface EditorRequest {
  prompt: string;
  video_url?: string;
  assets?: any[];
  project_id?: string;
  scene?: any;
  // Typed pass-through params honored by the backend's autonomous_edit route.
  // See openclaw.routes.ts handler — these are read off req.body (top-level wins
  // over params) and forwarded to AutonomousEditRunner.
  requirePlanApproval?: boolean;
  workingMemory?: Record<string, any>;
  attachedImages?: string[];
  flaggedIssues?: string[];
  captionTemplatePreset?: string;
  captionTemplateMode?: string;
  core_only?: boolean;
  brandId?: string;
  projectBrandId?: string;
  editedPlan?: Record<string, any>;
}

interface EditorResponse {
  success: boolean;
  message: string;
  data?: any;
  videoUrl?: string;
  jobId?: number | string;
  status?: string;
}

function openClawExecuteUrl(): string {
  // LEVEA_API_URL canonical; ADSCENE_API_URL kept as silent backward-compat fallback.
  const raw = String(
    process.env.LEVEA_API_URL || process.env.ADSCENE_API_URL || ''
  ).replace(/\/+$/, '');
  if (!raw) throw new Error('LEVEA_API_URL is required');
  if (raw.endsWith('/api/v1/misc/openclaw/v1/execute')) return raw;
  if (raw.endsWith('/api/v1/misc/openclaw')) return `${raw}/v1/execute`;
  if (raw.endsWith('/api/v1/misc')) return `${raw}/openclaw/v1/execute`;
  return `${raw}/api/v1/misc/openclaw/v1/execute`;
}

export async function handleEditorOperation(
  request: EditorRequest
): Promise<EditorResponse> {
  const prompt = String(request?.prompt || '').trim();
  if (!prompt) {
    return { success: false, message: '❌ Missing required parameter: prompt' };
  }

  // Pass-through every typed param the backend honors. Previously this handler
  // stripped everything except prompt/video_url/assets, which silently dropped
  // requirePlanApproval / workingMemory / captionTemplatePreset / brandId /
  // attachedImages / flaggedIssues / core_only / projectBrandId / editedPlan
  // before they could reach the backend. The backend's openclaw.routes.ts
  // reads each of these and forwards them to AutonomousEditRunner.
  const params: Record<string, any> = { prompt };
  if (request.video_url) params.video_url = request.video_url;
  if (Array.isArray(request.assets) && request.assets.length > 0) {
    params.assets = request.assets;
  }
  const topLevel: Record<string, any> = {};
  if (request.requirePlanApproval !== undefined) topLevel.requirePlanApproval = request.requirePlanApproval;
  if (request.workingMemory !== undefined) topLevel.workingMemory = request.workingMemory;
  if (Array.isArray(request.attachedImages) && request.attachedImages.length > 0) topLevel.attachedImages = request.attachedImages;
  if (Array.isArray(request.flaggedIssues) && request.flaggedIssues.length > 0) topLevel.flaggedIssues = request.flaggedIssues;
  if (request.captionTemplatePreset) topLevel.captionTemplatePreset = request.captionTemplatePreset;
  if (request.captionTemplateMode) topLevel.captionTemplateMode = request.captionTemplateMode;
  if (request.core_only !== undefined) topLevel.core_only = request.core_only;
  if (request.brandId) topLevel.brandId = request.brandId;
  if (request.projectBrandId) topLevel.projectBrandId = request.projectBrandId;
  if (request.editedPlan !== undefined) topLevel.editedPlan = request.editedPlan;

  try {
    const response = await axios.post(
      openClawExecuteUrl(),
      {
        tool: 'autonomous_edit',
        params,
        projectId: request.project_id || `openclaw_${Date.now()}`,
        ...(request.scene !== undefined ? { scene: request.scene } : {}),
        ...topLevel,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.LEVEA_API_KEY || process.env.ADSCENE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 600_000, // 10 minutes — autonomous_edit can include sync export
      }
    );

    const { success, data, message, videoUrl, jobId, status } = response.data || {};
    return {
      success: success !== false,
      message: formatMessage(message, videoUrl, jobId),
      data,
      videoUrl,
      jobId,
      status,
    };
  } catch (error: any) {
    return handleError(error);
  }
}

function formatMessage(message?: string, videoUrl?: string, jobId?: number | string): string {
  const parts: string[] = [];
  if (message) parts.push(message);
  if (videoUrl) parts.push(`📹 ${videoUrl}`);
  if (jobId !== undefined) parts.push(`🆔 job ${jobId}`);
  return parts.length > 0 ? parts.join('\n') : '✅ Done';
}

function handleError(error: any): EditorResponse {
  const status = error.response?.status;
  if (status === 401 || status === 403) {
    return { success: false, message: '❌ Authentication failed. Check LEVEA_API_KEY at https://studio.livecore.ai/.' };
  }
  if (status === 400) {
    return { success: false, message: `❌ ${error.response?.data?.message || error.response?.data?.error || 'Invalid request'}` };
  }
  if (status === 429) {
    return { success: false, message: '⏱️ Rate limit exceeded. Please try again shortly.' };
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return { success: false, message: '⏱️ Timeout. The edit may be running — check back via the project.' };
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return { success: false, message: '🌐 Cannot reach the editor backend.' };
  }
  return { success: false, message: `❌ ${error.message || 'Unknown error'}` };
}

const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description:
        'Natural-language description of the desired video edit. E.g. "Generate 3 viral clips with bold captions and vertical 9:16 reframe", "Add captions saying GET READY", "Remove silences over 0.5s", "Export to MP4". The backend agent plans and executes; you do not need to call individual tools.',
    },
    video_url: {
      type: 'string',
      description: 'Optional source video URL. Auto-seeded as the starting layer when no scene is provided.',
    },
    assets: {
      type: 'array',
      description:
        'Optional asset descriptors. Each item: { id?, type: "video"|"image"|"audio", url|src, mimeType?, duration? }. Used to seed the scene when none is provided.',
      items: { type: 'object' },
    },
    project_id: {
      type: 'string',
      description: 'Optional project identifier for tracking / continuity.',
    },
    scene: {
      type: 'object',
      description:
        'Optional existing scene/timeline state to continue editing. Advanced — usually omitted; the backend rehydrates from project_id or seeds from video_url/assets.',
    },
    requirePlanApproval: {
      type: 'boolean',
      description:
        'If true, the agent stops after planning and returns { status: "awaiting_approval", workingMemory, plan } without mutating. Resume with the returned workingMemory + an approval prompt ("yes", "approve", "do it"). Use for irreversible work the user wants to gate.',
    },
    workingMemory: {
      type: 'object',
      description:
        'Durable working-memory snapshot returned by a prior call (typically one that returned status="awaiting_approval"). Re-sending it resumes that run from where it paused.',
    },
    attachedImages: {
      type: 'array',
      description:
        'Optional base64-encoded reference images / screenshots the agent should consider while planning (e.g. style references, screenshots of issues).',
      items: { type: 'string' },
    },
    flaggedIssues: {
      type: 'array',
      description:
        'Optional list of specific user-flagged problems to fix in this run (e.g. ["caption #3 is misspelled", "audio cuts out at 0:42"]). Surfaces to the planner alongside the prompt.',
      items: { type: 'string' },
    },
    captionTemplatePreset: {
      type: 'string',
      description:
        'Optional caption template slug to apply when generating/styling captions. One of the 41 builtin templates (e.g. "hormozi", "mrbeast", "viral-pop", "minimal-pro", "karaoke", "neon-pop", "typewriter", "pop-wave", "subtitle-bar", "creator-box"). See SKILL.md for the full list, or pass a user-saved template id.',
    },
    captionTemplateMode: {
      type: 'string',
      description:
        'How to apply captionTemplatePreset. "add" = generate fresh, "recreate" = wipe + regenerate, "style" = restyle existing captions, "translate" = translate to a target language (use with the language hint in prompt), "clear" = remove captions, "remove_fillers" = strip filler words.',
      enum: ['add', 'recreate', 'style', 'translate', 'clear', 'remove_fillers'],
    },
    core_only: {
      type: 'boolean',
      description:
        'If true, the response carries only the rendering-essential scene fields (no debug / verifier / workflow metadata). Useful for low-bandwidth integrations.',
    },
    brandId: {
      type: 'string',
      description:
        'Optional brand-profile id to apply for this call (palette, fonts, logo, voice, gradeBias). Overrides the project default brand if any. Look up brand ids via the list_brand_kits tool.',
    },
    projectBrandId: {
      type: 'string',
      description:
        'Optional default brand for the project. Persists on the project for future calls; brandId overrides per-call.',
    },
    editedPlan: {
      type: 'object',
      description:
        'Optional pre-edited plan object returned by a prior awaiting_approval response. Use to resume after the user manually adjusted steps.',
    },
  },
  required: ['prompt'],
} as const;

/**
 * OpenClaw plugin registration (2026.5.x contract).
 */
export default definePluginEntry({
  id: 'openclaw-ai-video-editor',
  name: 'OpenClaw AI Video Editor',
  description:
    'Agentic AI video editor — natural-language video edits end-to-end via a single `autonomous_edit` tool: viral clips, captions, vertical reframe, chroma key, AI background removal, audio cleanup, motion tracking, B-roll, voiceover, music, and MP4 / multi-platform export.',
  register(api) {
    api.registerTool({
      name: 'ai-video-editor',
      label: 'AI Video Editor',
      description:
        'Run a natural-language video edit end-to-end. The backend agent plans, executes, verifies, and exports. Anything from a one-liner ("make this TikTok-ready", "generate 3 viral clips", "add captions") to a multi-paragraph creative brief works. Returns the final mp4 URL synchronously when an export is queued.',
      parameters: TOOL_PARAMETERS,
      execute: async (_toolCallId: string, params: any) => {
        const result = await handleEditorOperation(params as EditorRequest);
        return {
          content: [{ type: 'text' as const, text: result.message }],
          details: result,
        };
      },
    });
  },
});
