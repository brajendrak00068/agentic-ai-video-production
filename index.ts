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

  const params: Record<string, any> = { prompt };
  if (request.video_url) params.video_url = request.video_url;
  if (Array.isArray(request.assets) && request.assets.length > 0) {
    params.assets = request.assets;
  }

  try {
    const response = await axios.post(
      openClawExecuteUrl(),
      {
        tool: 'autonomous_edit',
        params,
        projectId: request.project_id || `openclaw_${Date.now()}`,
        ...(request.scene !== undefined ? { scene: request.scene } : {}),
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
