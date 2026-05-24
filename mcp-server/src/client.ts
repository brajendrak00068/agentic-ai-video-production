import axios, { AxiosError, AxiosInstance } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * Thin HTTP client for the Levea editor backend.
 *
 * Pass-through only. All endpoints live under `/api/v1/misc/openclaw/v1/*`
 * (API-key auth). The MCP tool surface here mirrors what the route exposes.
 */

export interface ExecuteArgs {
  tool?: string;
  params?: Record<string, unknown>;
  project_id?: string;
  scene?: unknown;
  // Top-level typed params honored by the backend's autonomous_edit route.
  requirePlanApproval?: boolean;
  workingMemory?: Record<string, unknown>;
  attachedImages?: string[];
  flaggedIssues?: string[];
  captionTemplatePreset?: string;
  captionTemplateMode?: string;
  core_only?: boolean;
  brandId?: string;
  projectBrandId?: string;
  editedPlan?: Record<string, unknown>;
}

export interface ExecuteResult {
  success: boolean;
  message?: string;
  data?: unknown;
  videoUrl?: string;
  jobId?: number | string;
  status?: string;
  workingMemory?: Record<string, unknown>;
  reply?: string;
  raw?: unknown;
}

export interface JobStatus {
  success: boolean;
  jobId: string;
  status: string;
  progress: number;
  message: string;
  result?: unknown;
  videoUrl?: string;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SSEEvent {
  event?: string;
  data: Record<string, unknown> | string;
}

const DEFAULT_TIMEOUT_MS = 300_000;

function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

function baseRoot(): string {
  // LEVEA_API_URL is canonical; ADSCENE_API_URL kept as silent backward-compat fallback.
  const raw = trimTrailingSlashes(
    String(process.env.LEVEA_API_URL || process.env.ADSCENE_API_URL || '')
  );
  if (!raw) {
    throw new Error(
      'LEVEA_API_URL is required (e.g. https://api.livecore.ai). ' +
        'Set it in the MCP client env / mcpServers config.'
    );
  }
  if (raw.endsWith('/api/v1/misc/openclaw/v1/execute')) {
    return raw.slice(0, -'/v1/execute'.length);
  }
  if (raw.endsWith('/api/v1/misc/openclaw')) return raw;
  if (raw.endsWith('/api/v1/misc')) return `${raw}/openclaw`;
  return `${raw}/api/v1/misc/openclaw`;
}

function v1(path: string): string {
  return `${baseRoot()}/v1${path.startsWith('/') ? path : `/${path}`}`;
}

function apiKey(): string {
  const key = process.env.LEVEA_API_KEY || process.env.ADSCENE_API_KEY;
  if (!key) {
    throw new Error(
      'LEVEA_API_KEY is required. Generate one at https://studio.livecore.ai/ ' +
        'and set it in the MCP client env / mcpServers config.'
    );
  }
  return key;
}

function http2(): AxiosInstance {
  return axios.create({
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
    },
    timeout: DEFAULT_TIMEOUT_MS,
    validateStatus: (s) => s < 500,
  });
}

function describeError(err: unknown, label: string): never {
  const e = err as AxiosError<{ message?: string; error?: string }>;
  const upstream = e.response?.data?.error || e.response?.data?.message || e.message;
  const code = e.response?.status;
  if (code === 401 || code === 403) {
    throw new Error(
      `${label} failed: authentication rejected (HTTP ${code}). ` +
        `Check LEVEA_API_KEY — generate a fresh key at https://studio.livecore.ai/.`
    );
  }
  throw new Error(`${label} failed${code ? ` (HTTP ${code})` : ''}: ${upstream}`);
}

function buildExecuteBody(args: ExecuteArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    tool: args.tool || 'autonomous_edit',
    params: args.params || {},
    projectId: args.project_id || `mcp_${Date.now()}`,
  };
  if (args.scene !== undefined) body.scene = args.scene;
  // Top-level typed pass-through (backend reads these directly).
  if (args.requirePlanApproval !== undefined) body.requirePlanApproval = args.requirePlanApproval;
  if (args.workingMemory !== undefined) body.workingMemory = args.workingMemory;
  if (Array.isArray(args.attachedImages) && args.attachedImages.length > 0) body.attachedImages = args.attachedImages;
  if (Array.isArray(args.flaggedIssues) && args.flaggedIssues.length > 0) body.flaggedIssues = args.flaggedIssues;
  if (args.captionTemplatePreset) body.captionTemplatePreset = args.captionTemplatePreset;
  if (args.captionTemplateMode) body.captionTemplateMode = args.captionTemplateMode;
  if (args.core_only !== undefined) body.core_only = args.core_only;
  if (args.brandId) body.brandId = args.brandId;
  if (args.projectBrandId) body.projectBrandId = args.projectBrandId;
  if (args.editedPlan !== undefined) body.editedPlan = args.editedPlan;
  return body;
}

function flattenResult(d: Record<string, unknown>): ExecuteResult {
  return {
    success: d.success !== false,
    message: (d.message as string | undefined) ?? (d.reply as string | undefined),
    data: d.data,
    videoUrl: d.videoUrl as string | undefined,
    jobId: d.jobId as string | number | undefined,
    status: d.status as string | undefined,
    workingMemory: d.workingMemory as Record<string, unknown> | undefined,
    reply: d.reply as string | undefined,
    raw: d,
  };
}

/** Execute autonomous_edit (or any allowed tool) — single JSON response. */
export async function execute(args: ExecuteArgs): Promise<ExecuteResult> {
  const body = buildExecuteBody(args);
  try {
    const res = await http2().post(v1('/execute'), body);
    const d = (res.data || {}) as Record<string, unknown>;
    if (res.status >= 400) {
      const msg = (d.error as string) || (d.message as string) || `HTTP ${res.status}`;
      return { success: false, message: msg, status: 'error', raw: d };
    }
    return flattenResult(d);
  } catch (err) {
    return describeError(err, `execute(${args.tool || 'autonomous_edit'})`);
  }
}

/**
 * Execute with SSE streaming. onEvent is called for every event the backend
 * emits (status, mode_select, thinking, tool_call, tool_result,
 * background_job_completed, workflow_completed, success/partial_success, error,
 * heartbeat). Returns the final terminal payload as ExecuteResult once the
 * stream closes.
 */
export async function executeStreaming(
  args: ExecuteArgs,
  onEvent: (ev: SSEEvent) => void
): Promise<ExecuteResult> {
  const body = JSON.stringify(buildExecuteBody(args));
  const url = new URL(v1('/execute'));
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  return new Promise<ExecuteResult>((resolve, reject) => {
    const req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error(`Streaming auth rejected (HTTP ${res.statusCode}). Check LEVEA_API_KEY.`));
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Streaming HTTP ${res.statusCode}`));
          return;
        }
        let buffer = '';
        let final: ExecuteResult | null = null;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          // SSE messages are delimited by blank lines.
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const parsed = parseSSEMessage(raw);
            if (parsed) {
              try { onEvent(parsed); } catch (_e) { /* ignore consumer errors */ }
              const ev = String(parsed.event || (typeof parsed.data === 'object' && (parsed.data as any)?.type) || '');
              if (ev === 'success' || ev === 'partial_success' || ev === 'error') {
                const d = (typeof parsed.data === 'object' ? parsed.data : { reply: parsed.data }) as Record<string, unknown>;
                final = flattenResult(d);
              }
            }
          }
        });
        res.on('end', () => {
          if (final) resolve(final);
          else resolve({ success: false, message: 'Stream ended without a terminal event', status: 'incomplete' });
        });
        res.on('error', (e) => reject(e));
      }
    );
    req.on('error', (e) => reject(e));
    req.setTimeout(600_000, () => req.destroy(new Error('Streaming timed out after 10m')));
    req.write(body);
    req.end();
  });
}

function parseSSEMessage(raw: string): SSEEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1).trimStart();
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0 && !event) return null;
  const joined = dataLines.join('\n');
  let data: Record<string, unknown> | string = joined;
  if (joined.startsWith('{') || joined.startsWith('[')) {
    try { data = JSON.parse(joined); } catch (_e) { /* keep raw string */ }
  }
  return { event, data };
}

/** Poll one async job. */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  try {
    const res = await http2().get(v1(`/jobs/${encodeURIComponent(jobId)}`));
    const d = (res.data || {}) as Record<string, unknown>;
    if (res.status === 404) {
      return { success: false, jobId, status: 'not_found', progress: 0, message: 'Job not found' };
    }
    return {
      success: d.success !== false,
      jobId: (d.jobId as string) || jobId,
      status: (d.status as string) || 'unknown',
      progress: (d.progress as number) || 0,
      message: (d.message as string) || '',
      result: d.result,
      videoUrl: d.videoUrl as string | undefined,
      error: (d.error as string | null) ?? null,
      createdAt: d.createdAt as string | undefined,
      updatedAt: d.updatedAt as string | undefined,
    };
  } catch (err) {
    return describeError(err, `getJobStatus(${jobId})`);
  }
}

/** Block until a job reaches a terminal state or the deadline passes. */
export async function waitForJob(
  jobId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {}
): Promise<JobStatus> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const pollMs = opts.pollMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set([
    'completed', 'complete', 'succeeded', 'success',
    'failed', 'error', 'cancelled', 'canceled', 'not_found',
  ]);
  let last = await getJobStatus(jobId);
  while (!terminal.has(last.status.toLowerCase())) {
    if (Date.now() > deadline) {
      return { ...last, message: `${last.message} (poll timed out)` };
    }
    await new Promise((r) => setTimeout(r, pollMs));
    last = await getJobStatus(jobId);
  }
  return last;
}

/** Unauthenticated health probe. */
export async function health(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await axios.get(v1('/health'), { timeout: 15_000 });
    const status = (res.data as { status?: string })?.status;
    return { ok: status === 'healthy', detail: JSON.stringify(res.data) };
  } catch (err) {
    const e = err as AxiosError;
    return { ok: false, detail: e.message };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Caption templates  (already exposed under /openclaw/v1/caption-templates)
// ───────────────────────────────────────────────────────────────────────────

export async function listCaptionTemplates(): Promise<unknown> {
  try {
    const res = await http2().get(v1('/caption-templates'));
    return res.data;
  } catch (err) {
    return describeError(err, 'listCaptionTemplates');
  }
}

export async function saveCaptionTemplate(template: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/caption-templates'), template);
    return res.data;
  } catch (err) {
    return describeError(err, 'saveCaptionTemplate');
  }
}

export async function saveCurrentCaptionTemplate(body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/caption-templates/save-current'), body);
    return res.data;
  } catch (err) {
    return describeError(err, 'saveCurrentCaptionTemplate');
  }
}

export async function applyCaptionTemplate(body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/caption-templates/apply'), body);
    return res.data;
  } catch (err) {
    return describeError(err, 'applyCaptionTemplate');
  }
}

export async function deleteCaptionTemplate(templateId: string): Promise<unknown> {
  try {
    const res = await http2().delete(v1(`/caption-templates/${encodeURIComponent(templateId)}`));
    return res.data;
  } catch (err) {
    return describeError(err, `deleteCaptionTemplate(${templateId})`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Queue / task status  (already exposed)
// ───────────────────────────────────────────────────────────────────────────

export async function queueEdit(body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/queue-edit'), body);
    return res.data;
  } catch (err) {
    return describeError(err, 'queueEdit');
  }
}

export async function getTaskStatus(taskId: string): Promise<unknown> {
  try {
    const res = await http2().get(v1(`/task-status/${encodeURIComponent(taskId)}`));
    return res.data;
  } catch (err) {
    return describeError(err, `getTaskStatus(${taskId})`);
  }
}

export async function getActiveTask(projectId: string): Promise<unknown> {
  try {
    const res = await http2().get(v1(`/projects/${encodeURIComponent(projectId)}/active-task`));
    return res.data;
  } catch (err) {
    return describeError(err, `getActiveTask(${projectId})`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Brand kits  (requires backend to expose /openclaw/v1/brands/*)
// ───────────────────────────────────────────────────────────────────────────

export async function listBrandKits(): Promise<unknown> {
  try {
    const res = await http2().get(v1('/brands'));
    return res.data;
  } catch (err) {
    return describeError(err, 'listBrandKits');
  }
}

export async function getBrandKit(id: string): Promise<unknown> {
  try {
    const res = await http2().get(v1(`/brands/${encodeURIComponent(id)}`));
    return res.data;
  } catch (err) {
    return describeError(err, `getBrandKit(${id})`);
  }
}

export async function createBrandKit(brand: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/brands'), brand);
    return res.data;
  } catch (err) {
    return describeError(err, 'createBrandKit');
  }
}

export async function updateBrandKit(id: string, brand: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().put(v1(`/brands/${encodeURIComponent(id)}`), brand);
    return res.data;
  } catch (err) {
    return describeError(err, `updateBrandKit(${id})`);
  }
}

export async function deleteBrandKit(id: string): Promise<unknown> {
  try {
    const res = await http2().delete(v1(`/brands/${encodeURIComponent(id)}`));
    return res.data;
  } catch (err) {
    return describeError(err, `deleteBrandKit(${id})`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Projects  (requires backend to expose /openclaw/v1/projects/*)
// ───────────────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<unknown> {
  try {
    const res = await http2().get(v1('/projects'));
    return res.data;
  } catch (err) {
    return describeError(err, 'listProjects');
  }
}

export async function getProject(id: string): Promise<unknown> {
  try {
    const res = await http2().get(v1(`/projects/${encodeURIComponent(id)}`));
    return res.data;
  } catch (err) {
    return describeError(err, `getProject(${id})`);
  }
}

export async function createProject(project: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/projects'), project);
    return res.data;
  } catch (err) {
    return describeError(err, 'createProject');
  }
}

export async function deleteProject(id: string): Promise<unknown> {
  try {
    const res = await http2().delete(v1(`/projects/${encodeURIComponent(id)}`));
    return res.data;
  } catch (err) {
    return describeError(err, `deleteProject(${id})`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Assets  (requires backend to expose /openclaw/v1/assets/*)
// ───────────────────────────────────────────────────────────────────────────

export async function assetUploadUrl(body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/assets/upload-url'), body);
    return res.data;
  } catch (err) {
    return describeError(err, 'assetUploadUrl');
  }
}

export async function listAssets(query?: Record<string, string>): Promise<unknown> {
  try {
    const res = await http2().get(v1('/assets/list'), { params: query });
    return res.data;
  } catch (err) {
    return describeError(err, 'listAssets');
  }
}

export async function deleteAsset(fileName: string): Promise<unknown> {
  try {
    const res = await http2().delete(v1(`/assets/${encodeURIComponent(fileName)}`));
    return res.data;
  } catch (err) {
    return describeError(err, `deleteAsset(${fileName})`);
  }
}

export async function transcribeAsset(body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await http2().post(v1('/assets/transcribe'), body);
    return res.data;
  } catch (err) {
    return describeError(err, 'transcribeAsset');
  }
}
