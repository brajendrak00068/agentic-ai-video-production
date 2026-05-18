#!/usr/bin/env node
/**
 * Levea AI Video Editor — MCP server.
 *
 * Exposes the autonomous video editor to any MCP client (Claude Desktop,
 * Claude Code, Cursor, Cline, OpenClaw, Hermes, …) over stdio.
 *
 * Architecture: this server is a thin, stable adapter. All tools map onto the
 * backend contract `POST /api/v1/misc/openclaw/v1/execute`. No editing logic,
 * no shell, no filesystem, no raw renderer access lives here — those stay
 * behind the backend, which allowlists tools server-side.
 *
 * Config (env, set via the MCP client's `mcpServers` entry):
 *   LEVEA_API_URL   e.g. https://api.livecore.ai   (required)
 *   LEVEA_API_KEY   from https://studio.livecore.ai/ (required)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import {
  execute,
  getJobStatus,
  waitForJob,
  health,
  type ExecuteResult,
} from './client';

const PKG_VERSION = '0.4.0';

// The MCP server is intentionally a thin adapter: every edit goes through
// `autonomous_edit` so the backend agent owns planning, execution, verification,
// and export. We expose two read-only diagnostics (`editor_health`,
// `check_job_status`) and nothing else — no deterministic-tool wrappers, no
// editor_execute escape hatch — to keep the tool surface from forking and to
// stop MCP clients from second-guessing the agent.
const TOOLS: Tool[] = [
  {
    name: 'autonomous_edit',
    description:
      'PRIMARY (AND ONLY) EDIT TOOL. Run a natural-language video edit end-to-end. The backend agent plans, executes, verifies, and exports. Accepts anything from a one-liner ("make this TikTok-ready", "generate 3 viral clips", "add captions", "remove silences", "reframe to 9:16", "color grade like Netflix", "export to MP4") to a multi-paragraph creative brief. Returns the final mp4 URL synchronously when an export is queued.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Natural-language description of the desired edit or creative brief.',
        },
        project_id: {
          type: 'string',
          description: 'Optional project id for tracking / continuity.',
        },
        video_url: {
          type: 'string',
          description:
            'Optional source video URL. Auto-seeded as the starting layer when no scene is provided.',
        },
        assets: {
          type: 'array',
          description:
            'Optional asset descriptors. Each item: { id?, type: "video"|"image"|"audio", url|src, mimeType?, duration? }. Used to seed the scene when none is provided.',
          items: { type: 'object' },
        },
        scene: {
          type: 'object',
          description:
            'Optional existing scene/timeline state to continue editing (advanced; usually omitted).',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'check_job_status',
    description:
      'Check the status/progress of an async job (e.g. an export) by job id. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job id to poll.' },
        wait: {
          type: 'boolean',
          description: 'If true, block until the job reaches a terminal state.',
        },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'editor_health',
    description:
      'Diagnostic: check connectivity to the configured backend (LEVEA_API_URL). Read-only, unauthenticated.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function summarize(r: ExecuteResult): string {
  const head = r.success ? '✅' : '❌';
  const lines = [`${head} ${r.message || (r.success ? 'Done' : 'Failed')}`];
  if (r.videoUrl) lines.push(`📹 ${r.videoUrl}`);
  if (r.jobId !== undefined) lines.push(`🆔 job ${r.jobId}`);
  if (r.status) lines.push(`status: ${r.status}`);
  return lines.join('\n');
}

function ok(text: string, structured: unknown) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: structured as Record<string, unknown>,
  };
}
function fail(text: string, structured?: unknown) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: (structured as Record<string, unknown>) ?? { error: text },
    isError: true,
  };
}

async function dispatch(name: string, a: Record<string, unknown>) {
  switch (name) {
    case 'autonomous_edit': {
      const prompt = str(a.prompt);
      if (!prompt) return fail('❌ `prompt` is required for autonomous_edit.');
      const params: Record<string, unknown> = { prompt };
      if (a.video_url) params.video_url = a.video_url;
      if (Array.isArray(a.assets) && a.assets.length > 0) params.assets = a.assets;
      const r = await execute({
        tool: 'autonomous_edit',
        params,
        project_id: str(a.project_id),
        scene: a.scene,
      });
      return ok(summarize(r), r);
    }
    case 'check_job_status': {
      const id = str(a.job_id);
      if (!id) return fail('❌ `job_id` is required.');
      const job = a.wait === true ? await waitForJob(id) : await getJobStatus(id);
      return ok(
        `${job.success ? '🔎' : '❌'} job ${job.jobId}: ${job.status} (${job.progress}%) ${job.message}`,
        job
      );
    }
    case 'editor_health': {
      const h = await health();
      return ok(
        `${h.ok ? '✅ backend reachable' : '❌ backend unreachable'}\n${h.detail}`,
        h
      );
    }
    default:
      return fail(
        `❌ Unknown MCP tool: ${name}. This server exposes a single edit tool — call \`autonomous_edit\` with a natural-language prompt (the backend agent plans, executes, and exports).`
      );
  }
}

async function main() {
  const server = new Server(
    { name: 'levea-mcp-server', version: PKG_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments || {}) as Record<string, unknown>;
    try {
      return await dispatch(name, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(`❌ ${msg}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP JSON-RPC channel.
  process.stderr.write(
    `levea-mcp-server ${PKG_VERSION} ready (${TOOLS.length} tools)\n`
  );
}

main().catch((err) => {
  process.stderr.write(
    `levea-mcp-server fatal: ${err instanceof Error ? err.stack : String(err)}\n`
  );
  process.exit(1);
});
