import { buildEditBody, editInputSchema } from './contract/editContract';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { definePluginEntry } from 'openclaw/plugin-sdk/core';

/**
 * Levea Agentic Video Editor — OpenClaw plugin.
 *
 * Editing remains a single high-level tool. Queue and polling tools expose the
 * durable backend state needed to operate that edit safely; they do not bypass
 * the backend planner or expose low-level scene mutation.
 */

export interface EditorRequest {
  prompt: string;
  video_url?: string;
  assets?: any[];
  project_id?: string;
  scene?: any;
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
  platforms?: string[];
  autoExport?: boolean;
}

export interface EditorResponse extends Record<string, any> {
  success: boolean;
  message: string;
  partial?: boolean;
  projectId?: string;
  project_id?: string;
  projectRevision?: number;
  requestId?: string;
  clientRequestId?: string;
  videoUrl?: string;
  jobId?: number | string;
  taskId?: number | string;
  status?: string;
}

interface OperationContext {
  toolCallId?: string;
  signal?: AbortSignal;
}

interface NormalizeOptions {
  label: string;
  requireMessage?: boolean;
  requireVerification?: boolean;
  fallbackProjectId?: string;
  acceptActiveContract?: boolean;
}

/** How long one call waits (LEVEA_REQUEST_TIMEOUT_MS; default 10 min). */
const REQUEST_TIMEOUT_MS = (() => {
  const n = Number(process.env.LEVEA_REQUEST_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 600_000;
})();
const TERMINAL_JOB_STATES = new Set([
  'completed', 'complete', 'succeeded', 'success',
  'failed', 'failure', 'error', 'errored',
  'cancelled', 'canceled', 'timeout', 'timed_out', 'not_found',
]);
const FAILED_JOB_STATES = new Set([
  'failed', 'failure', 'error', 'errored',
  'cancelled', 'canceled', 'timeout', 'timed_out', 'not_found',
]);
const PENDING_TOOL_STATES = new Set([
  'pending', 'waiting', 'queued', 'processing', 'rendering', 'planning',
  'executing', 'dispatch', 'running', 'verifying', 'awaiting_approval', 'awaiting_input',
]);

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function sanitizeRequestId(value: unknown): string | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  const normalized = raw
    .replace(/[^A-Za-z0-9._:@/-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  return normalized || undefined;
}

const DEFAULT_LEVEA_API_URL = 'https://api.livecore.ai';
const PLUGIN_VERSION = '1.2.11';

let runtimePluginConfig: { apiUrl?: string; apiKey?: string } = {};

function extractConfigString(val: unknown): string | undefined {
  if (typeof val === 'string') return val.trim() || undefined;
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return firstString(obj.value, obj.key, obj.apiKey, obj.token, obj.secret);
  }
  return undefined;
}

function normalizeHostUrl(rawInput: string): string {
  let raw = rawInput.trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_LEVEA_API_URL;
  // Auto-heal common user mistake: setting https://livecore.ai or https://www.livecore.ai (the web UI host)
  // instead of https://api.livecore.ai (the backend API host).
  if (raw === 'https://livecore.ai' || raw === 'https://www.livecore.ai' || raw === 'http://livecore.ai' || raw === 'http://www.livecore.ai') {
    return DEFAULT_LEVEA_API_URL;
  }
  if (raw.startsWith('https://livecore.ai/')) {
    raw = DEFAULT_LEVEA_API_URL + raw.slice('https://livecore.ai'.length);
  } else if (raw.startsWith('https://www.livecore.ai/')) {
    raw = DEFAULT_LEVEA_API_URL + raw.slice('https://www.livecore.ai'.length);
  }
  return raw;
}

function openClawV1Root(): string {
  const configured = firstString(
    process.env.LEVEA_API_URL,
    process.env.ADSCENE_API_URL,
    runtimePluginConfig.apiUrl,
  );
  const raw = normalizeHostUrl(configured || DEFAULT_LEVEA_API_URL);
  if (raw.endsWith('/api/v1/misc/openclaw/v1/execute')) {
    return raw.slice(0, -'/execute'.length);
  }
  if (raw.endsWith('/api/v1/misc/openclaw/v1')) return raw;
  if (raw.endsWith('/api/v1/misc/openclaw')) return `${raw}/v1`;
  if (raw.endsWith('/api/v1/misc')) return `${raw}/openclaw/v1`;
  return `${raw}/api/v1/misc/openclaw/v1`;
}

function openClawUrl(path: string): string {
  return `${openClawV1Root()}${path.startsWith('/') ? path : `/${path}`}`;
}

function resolveOptionalApiKey(): string | undefined {
  return firstString(
    process.env.LEVEA_API_KEY,
    process.env.ADSCENE_API_KEY,
    runtimePluginConfig.apiKey,
  );
}

/** Telemetry is on unless LEVEA_TELEMETRY is off / false / 0. */
function telemetryEnabled(): boolean {
  const v = String(process.env.LEVEA_TELEMETRY ?? '').trim().toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0' || v === 'no');
}

// Sends only an event name, the plugin name and version, and whether a key is
// set: no prompts, media, keys, or project data. Disable with LEVEA_TELEMETRY=off.
function sendFunnelTelemetry(event: string, hasApiKey: boolean): void {
  if (process.env.VITEST || process.env.NODE_ENV === 'test' || !telemetryEnabled()) return;
  try {
    const root = openClawV1Root().replace(/\/openclaw\/v1$/, '/openclaw-keys/telemetry');
    void axios.post(
      root,
      { event, client: 'openclaw-plugin', version: PLUGIN_VERSION, hasApiKey },
      { timeout: 3000, validateStatus: () => true },
    ).catch(() => {});
  } catch {
    // Non-blocking telemetry
  }
}

function apiKey(): string {
  const key = resolveOptionalApiKey();
  if (!key) {
    sendFunnelTelemetry('auth_missing_local', false);
    throw new Error(
      'LEVEA_API_KEY is required. Generate a free API key in 1 click at https://livecore.ai/?openclaw=1&utm_source=openclaw-plugin&utm_medium=missing-key&utm_campaign=openclaw-ai-video-editor and set LEVEA_API_KEY in your environment or OpenClaw plugin config.'
    );
  }
  return key;
}

function requestHeaders(context: OperationContext): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
    'X-Levea-Client': `openclaw-plugin/${PLUGIN_VERSION}`,
  };
  const requestId = sanitizeRequestId(context.toolCallId);
  if (requestId) {
    headers['Idempotency-Key'] = requestId;
    headers['X-Request-Id'] = requestId;
  }
  return headers;
}

function contractFailure(
  message: string,
  payload: unknown,
  httpStatus?: number,
  extra: Record<string, unknown> = {},
): EditorResponse {
  return {
    ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
    ...extra,
    success: false,
    message,
    code: 'BACKEND_CONTRACT_ERROR',
    contractError: true,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    backendPayload: payload,
  };
}

/** Validate rather than infer the backend outcome from HTTP 200. */
export function normalizeBackendResponse(
  httpStatus: number,
  payload: unknown,
  options: NormalizeOptions,
): EditorResponse {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return contractFailure(
      `${options.label} returned a malformed non-object response (HTTP ${httpStatus}).`,
      payload,
      httpStatus,
      options.fallbackProjectId
        ? { projectId: options.fallbackProjectId, project_id: options.fallbackProjectId }
        : {},
    );
  }

  const data = payload as Record<string, any>;
  const fallbackProjectId = firstString(options.fallbackProjectId);
  const projectId = firstString(data.projectId, data.project_id, fallbackProjectId);
  const projectFields = projectId ? { projectId, project_id: projectId } : {};
  const upstreamMessage = firstString(data.message, data.reply, data.error);

  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      ...data,
      ...projectFields,
      success: false,
      message: upstreamMessage || `${options.label} failed with HTTP ${httpStatus}.`,
      httpStatus,
    };
  }

  // The active-task endpoint's established contract uses an explicit `active`
  // boolean rather than success. Treat only that typed boolean as authoritative;
  // a generic object with no outcome signal remains a contract failure.
  const hasActiveContract = options.acceptActiveContract && typeof data.active === 'boolean';
  if (typeof data.success !== 'boolean' && !hasActiveContract) {
    return contractFailure(
      `${options.label} returned HTTP ${httpStatus} without an explicit success outcome.`,
      payload,
      httpStatus,
      projectFields,
    );
  }

  const explicitSuccess = hasActiveContract ? true : data.success === true;
  if (explicitSuccess && data.partial === true) {
    return contractFailure(
      `${options.label} returned contradictory success and partial outcomes.`,
      payload,
      httpStatus,
      projectFields,
    );
  }

  if (explicitSuccess && options.requireVerification && data.verificationPassed !== true) {
    return contractFailure(
      `${options.label} returned success without authoritative verification.`,
      payload,
      httpStatus,
      projectFields,
    );
  }

  let message = upstreamMessage;
  if (!message && options.requireMessage) {
    return contractFailure(
      `${options.label} returned success without a human-readable outcome.`,
      payload,
      httpStatus,
      projectFields,
    );
  }
  if (!message) {
    if (hasActiveContract) {
      message = data.active
        ? `${options.label}: active task ${String(data.taskId ?? '')} is ${String(data.status || 'running')}.`
        : `${options.label}: no active task.`;
    } else {
      message = `${options.label}: ${String(data.status || (explicitSuccess ? 'accepted' : 'failed'))}.`;
    }
  }

  // The backend sets videoUrl only when the export finished before the response
  // was assembled; otherwise the same URL arrives as export_url / exportUrl.
  const videoUrl = firstString(data.videoUrl, data.exportUrl, data.export_url, data.downloadUrl);
  return {
    ...data,
    ...projectFields,
    ...(videoUrl && videoUrl.startsWith('http') ? { videoUrl } : {}),
    success: explicitSuccess,
    message,
    httpStatus,
  };
}

async function callBackend(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  context: OperationContext,
  options: NormalizeOptions,
): Promise<EditorResponse> {
  // A wall-clock limit: the backend keeps a long edit's response alive with
  // keep-alive bytes, so axios's own (idle) timeout never fires. The host's
  // cancel signal still aborts the call.
  const controller = new AbortController();
  let timedOut = false;
  const wall = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
  const onHostAbort = () => controller.abort();
  if (context.signal) {
    if (context.signal.aborted) controller.abort();
    else context.signal.addEventListener('abort', onHostAbort, { once: true });
  }
  try {
    const response = await axios.request({
      method,
      url: openClawUrl(path),
      ...(body !== undefined ? { data: body } : {}),
      headers: requestHeaders(context),
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      signal: controller.signal,
    });
    const result = normalizeBackendResponse(response.status, response.data, options);
    const clientRequestId = sanitizeRequestId(context.toolCallId);
    return clientRequestId && !result.clientRequestId
      ? { ...result, clientRequestId }
      : result;
  } catch (error: any) {
    if (timedOut) return stillRunning(options.fallbackProjectId, context.toolCallId);
    return handleError(error, options.fallbackProjectId, context.toolCallId);
  } finally {
    clearTimeout(wall);
    context.signal?.removeEventListener('abort', onHostAbort);
  }
}

/**
 * The plugin stopped waiting, but the edit keeps running on Levea: a full edit
 * with motion graphics and an export can take 10-20 minutes.
 */
function stillRunning(projectId: string | undefined, toolCallId?: string): EditorResponse {
  const clientRequestId = sanitizeRequestId(toolCallId);
  return {
    success: false,
    status: 'running',
    code: 'STILL_RUNNING',
    message: `The edit is still running on Levea after ${Math.round(REQUEST_TIMEOUT_MS / 60_000)} min (full edits with motion graphics and export can take 10-20 minutes). `
      + `Call get_active_task with project_id "${projectId || ''}" to follow it; it returns the result when the edit completes. Do not start the edit again.`,
    ...(projectId ? { projectId, project_id: projectId } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
  };
}


export async function handleEditorOperation(
  request: EditorRequest,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const prompt = firstString(request?.prompt);
  if (!prompt) {
    return { success: false, message: 'Missing required parameter: prompt.', code: 'MISSING_PROMPT' };
  }

  // A first call without project_id gets one here, before the request, so an
  // edit that outlives the wait can still be found (get_active_task).
  const projectId = firstString(request.project_id) || `openclaw_${randomUUID()}`;
  // Every field comes from the edit contract (contract/edit-contract.json).
  const body = buildEditBody({ ...request, prompt, project_id: projectId }, 'all');

  return callBackend('POST', '/execute', body, context, {
    label: 'autonomous_edit',
    requireMessage: true,
    requireVerification: true,
    fallbackProjectId: projectId,
  });
}

export async function handleQueueEditOperation(
  request: EditorRequest,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const prompt = firstString(request?.prompt);
  const projectId = firstString(request?.project_id);
  if (!prompt) return { success: false, message: 'Missing required parameter: prompt.', code: 'MISSING_PROMPT' };
  if (!projectId) {
    return {
      success: false,
      message: 'queue_edit requires a stable project_id so the queued edit cannot attach to a shared default project.',
      code: 'MISSING_PROJECT_ID',
    };
  }

  return callBackend('POST', '/queue-edit', buildEditBody({ ...request, prompt, project_id: projectId }, 'queue'), context, {
    label: 'queue_edit',
    requireMessage: true,
    fallbackProjectId: projectId,
  });
}

async function pollOperation(
  path: string,
  label: string,
  context: OperationContext,
  options: { fallbackProjectId?: string; acceptActiveContract?: boolean } = {},
): Promise<EditorResponse> {
  const result = await callBackend('GET', path, undefined, context, {
    label,
    fallbackProjectId: options.fallbackProjectId,
    acceptActiveContract: options.acceptActiveContract,
  });
  const status = String(result.status || '').toLowerCase();
  if (result.success === true && FAILED_JOB_STATES.has(status)) {
    return {
      ...result,
      success: false,
      message: firstString(result.error, result.message) || `${label}: ${status}.`,
    };
  }
  return result;
}

export async function handleJobStatusOperation(
  jobId: string,
  wait = false,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const id = firstString(jobId);
  if (!id) return { success: false, message: 'Missing required parameter: job_id.', code: 'MISSING_JOB_ID' };
  const path = `/jobs/${encodeURIComponent(id)}`;
  let result = await pollOperation(path, `job ${id}`, context);
  if (!wait) return result;

  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (result.success && !TERMINAL_JOB_STATES.has(String(result.status || '').toLowerCase())) {
    if (Date.now() >= deadline) {
      return { ...result, success: false, message: `Timed out waiting for job ${id}.`, code: 'POLL_TIMEOUT' };
    }
    try {
      await waitForDelay(4_000, context.signal);
    } catch {
      return { ...result, success: false, message: `Polling job ${id} was cancelled.`, code: 'POLL_CANCELLED' };
    }
    result = await pollOperation(path, `job ${id}`, context);
  }
  return result;
}

export function handleTaskStatusOperation(
  taskId: string,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const id = firstString(taskId);
  if (!id) return Promise.resolve({ success: false, message: 'Missing required parameter: task_id.', code: 'MISSING_TASK_ID' });
  return pollOperation(`/task-status/${encodeURIComponent(id)}`, `task ${id}`, context);
}

export function handleActiveTaskOperation(
  projectIdValue: string,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const projectId = firstString(projectIdValue);
  if (!projectId) {
    return Promise.resolve({ success: false, message: 'Missing required parameter: project_id.', code: 'MISSING_PROJECT_ID' });
  }
  return pollOperation(
    `/projects/${encodeURIComponent(projectId)}/active-task`,
    `active task for ${projectId}`,
    context,
    { fallbackProjectId: projectId, acceptActiveContract: true },
  );
}

function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error('aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function handleError(error: any, projectIdValue?: string, toolCallIdValue?: string): EditorResponse {
  const status = Number(error?.response?.status || 0) || undefined;
  const payload = error?.response?.data;
  const projectId = firstString(projectIdValue);
  const clientRequestId = sanitizeRequestId(toolCallIdValue);
  const common = {
    ...(projectId ? { projectId, project_id: projectId } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
  };
  if (payload && status) {
    const normalized = normalizeBackendResponse(status, payload, {
      label: 'OpenClaw request',
      fallbackProjectId: projectId,
    });
    return { ...normalized, ...common };
  }
  if (status === 401 || status === 403) {
    return { ...common, success: false, message: 'Authentication failed. Check LEVEA_API_KEY or create a new key at https://livecore.ai/?openclaw=1&utm_source=openclaw-plugin&utm_medium=auth-failed&utm_campaign=openclaw-ai-video-editor .', code: 'AUTH_FAILED', httpStatus: status };
  }
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return { ...common, success: false, message: 'The editor request timed out; its final state is unknown. Poll by the returned project or task identifier before retrying.', code: 'TIMEOUT', status: 'unknown' };
  }
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
    return { ...common, success: false, message: 'Cannot reach the editor backend.', code: 'BACKEND_UNREACHABLE' };
  }
  return { ...common, success: false, message: firstString(error?.message) || 'Unknown editor transport error.', code: error?.code || 'TRANSPORT_ERROR' };
}

const DIRECT_RESULT_TEXT_KEYS = [
  'actions',
  'readTools',
  'catalogs',
  'editorialPlaybook',
  'inputSchema',
  'parameters',
  'skills',
  'content',
  'resource',
  'liveLayers',
  'actionsExecuted',
  'deliverableWarnings',
  'uploadUrl',
  'fileUrl',
] as const;

function displayMessage(result: EditorResponse): string {
  const parts = [result.message];
  if (result.projectId) parts.push(`project: ${result.projectId}`);
  if (result.videoUrl) parts.push(`video: ${result.videoUrl}`);
  if (result.taskId !== undefined) parts.push(`task: ${String(result.taskId)}`);
  if (result.jobId !== undefined) parts.push(`job: ${String(result.jobId)}`);
  if (result.status) parts.push(`status: ${result.status}`);
  const structuredExtra: Record<string, unknown> = {};
  for (const key of DIRECT_RESULT_TEXT_KEYS) {
    if ((result as any)[key] !== undefined) {
      structuredExtra[key] = (result as any)[key];
    }
  }
  if (Object.keys(structuredExtra).length > 0) {
    try {
      const json = JSON.stringify(structuredExtra, null, 2);
      parts.push(json.length > 50_000 ? `${json.slice(0, 50_000)}\n… (truncated)` : json);
    } catch {
      // ignore serialization failure
    }
  }
  return parts.join('\n');
}

function isFailedResult(result: EditorResponse): boolean {
  const status = String(result.status || '').toLowerCase();
  if (result.partial !== true && PENDING_TOOL_STATES.has(status)) return false;
  return result.success !== true
    || result.partial === true
    || FAILED_JOB_STATES.has(status);
}

export function toOpenClawToolResult(result: EditorResponse) {
  const failed = isFailedResult(result);
  const backendStatus = firstString(result.status);
  const normalizedStatus = failed
    ? (result.partial === true ? 'partial' : 'error')
    : (backendStatus && PENDING_TOOL_STATES.has(backendStatus.toLowerCase())
      ? 'pending'
      : (backendStatus || 'completed'));
  const details = backendStatus && backendStatus !== normalizedStatus
    ? { ...result, backendStatus, status: normalizedStatus }
    : { ...result, status: normalizedStatus };
  const mcpBlocks = Array.isArray((result as any)?.mcpContent) ? (result as any).mcpContent : [];
  const imageBlocks = mcpBlocks
    .filter((blk: any) => blk && blk.type === 'image' && typeof blk.data === 'string' && blk.data.length > 0)
    .map((blk: any) => ({
      type: 'image' as const,
      data: blk.data,
      mimeType: typeof blk.mimeType === 'string' ? blk.mimeType : 'image/jpeg',
    }));
  return {
    content: [{ type: 'text' as const, text: displayMessage(result) }, ...imageBlocks],
    // OpenClaw's AgentToolResult contract calls the structured payload
    // `details` (MCP calls the analogous field `structuredContent`). Preserve
    // the entire backend object; clients must not reconstruct state from text.
    // OpenClaw derives tool failure from details.status (its AgentToolResult
    // does not expose MCP's isError field). Preserve a changed upstream status
    // as backendStatus so normalization never destroys transport evidence.
    details,
  };
}

export async function handleUniversalToolOperation(
  toolName: string,
  params: Record<string, any> = {},
  context: OperationContext = {},
): Promise<EditorResponse> {
  if (toolName === 'asset_upload_url') {
    const fileName = firstString(params?.fileName, params?.filename);
    if (!fileName) {
      return { success: false, message: 'Missing required parameter: fileName.', code: 'MISSING_FILE_NAME' };
    }
    return callBackend(
      'POST',
      '/assets/upload-url',
      {
        fileName,
        ...(params?.contentType ? { contentType: String(params.contentType) } : {}),
        ...(params?.projectId || params?.project_id ? { projectId: String(params.projectId || params.project_id) } : {}),
      },
      context,
      { label: 'asset_upload_url', requireMessage: false, requireVerification: false },
    );
  }
  const projectId = firstString(params?.project_id, params?.projectId);
  const body: Record<string, any> = {
    tool: toolName,
    params,
    ...(projectId ? { projectId, project_id: projectId } : {}),
    ...(params?.scene !== undefined ? { scene: params.scene } : {}),
  };
  const res = await callBackend('POST', '/execute', body, context, {
    label: toolName,
    requireMessage: false,
    requireVerification: false,
    fallbackProjectId: projectId,
  });
  if (!params?.include_scene && res && typeof res === 'object') {
    const { scene: _omittedScene, ...rest } = res as Record<string, any>;
    return rest as EditorResponse;
  }
  return res;
}

// Tool input schemas come from the edit contract (contract/edit-contract.json).
const TOOL_PARAMETERS = { ...editInputSchema('all'), additionalProperties: false };

const QUEUE_PARAMETERS = {
  ...editInputSchema('queue'),
  // A queued edit must attach to a known project, never a shared default.
  required: ['prompt', 'project_id'],
  additionalProperties: false,
};

const JOB_STATUS_PARAMETERS = {
  type: 'object',
  properties: {
    job_id: { type: 'string', minLength: 1, description: 'Export or async job id.' },
    wait: { type: 'boolean', description: 'Poll until a terminal status or timeout.' },
  },
  required: ['job_id'],
  additionalProperties: false,
} as const;

const TASK_STATUS_PARAMETERS = {
  type: 'object',
  properties: { task_id: { type: 'string', minLength: 1, description: 'Numeric task id returned by queue_edit.' } },
  required: ['task_id'],
  additionalProperties: false,
} as const;

const ACTIVE_TASK_PARAMETERS = {
  type: 'object',
  properties: { project_id: { type: 'string', minLength: 1, description: 'Stable project identifier.' } },
  required: ['project_id'],
  additionalProperties: false,
} as const;

/** OpenClaw plugin registration (2026.5.x contract). */
export default definePluginEntry({
  id: 'openclaw-ai-video-editor',
  name: 'OpenClaw AI Video Editor',
  description:
    'Agentic video editing through one high-level edit tool plus durable queue and polling state.',
  register(api) {
    // This plugin's own config (configSchema: apiUrl, apiKey). api.config is the
    // whole OpenClaw config in current SDKs, so it is read only as a legacy
    // fallback when it carries the plugin's own keys.
    const legacyCfg = (api as any)?.config;
    const rawCfg = (api as any)?.pluginConfig
      || (typeof (api as any)?.getConfig === 'function' ? (api as any).getConfig() : null)
      || (legacyCfg && (legacyCfg.apiKey !== undefined || legacyCfg.apiUrl !== undefined) ? legacyCfg : null)
      || {};
    const cfgUrl = extractConfigString(rawCfg?.apiUrl);
    const cfgKey = extractConfigString(rawCfg?.apiKey);
    if (cfgUrl || cfgKey) {
      runtimePluginConfig = {
        ...(cfgUrl ? { apiUrl: cfgUrl } : {}),
        ...(cfgKey ? { apiKey: cfgKey } : {}),
      };
    }
    sendFunnelTelemetry('plugin_boot', Boolean(resolveOptionalApiKey()));

    api.registerTool({
      name: 'ai-video-editor',
      label: 'AI Video Editor',
      description:
        'Run a natural-language video edit. Read the complete structured details: success is true only after authoritative verification, while partial/pending/failure remain explicit.',
      parameters: TOOL_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleEditorOperation(params as EditorRequest, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'queue_edit',
      label: 'Queue Video Edit',
      description: 'Queue a long-running edit against a required stable project_id; poll the returned taskId.',
      parameters: QUEUE_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleQueueEditOperation(params as EditorRequest, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'check_job_status',
      label: 'Check Video Job',
      description: 'Read an export/async job. wait=true polls until a terminal state.',
      parameters: JOB_STATUS_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleJobStatusOperation(String(params?.job_id || ''), params?.wait === true, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'check_task_status',
      label: 'Check Queued Edit',
      description: 'Read a queued edit task by the taskId returned from queue_edit.',
      parameters: TASK_STATUS_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleTaskStatusOperation(String(params?.task_id || ''), { toolCallId, signal })),
    });

    api.registerTool({
      name: 'get_active_task',
      label: 'Get Active Project Edit',
      description: 'Reconnect to the currently running edit for a stable project_id.',
      parameters: ACTIVE_TASK_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleActiveTaskOperation(String(params?.project_id || ''), { toolCallId, signal })),
    });

    api.registerTool({
      name: 'search_tools',
      label: 'Search Canonical Editor Tools',
      description: 'Search all 189+ canonical video editing actions, 13 read/inspection tools, AND canonical preset catalogs (captions, vfx, transitions, color_presets, title_cards, fonts, blend_modes, properties, animatable) by keyword, category, or catalog filter, and retrieve the 5-phase NLE editorialPlaybook.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional search keyword (e.g. "karaoke", "hormozi", "lens_blur", "whip_pan", "teal_orange", "chromakey").' },
          catalog: {
            type: 'string',
            enum: ['all', 'actions', 'captions', 'vfx', 'transitions', 'color_presets', 'title_cards', 'fonts', 'blend_modes', 'properties', 'animatable'],
            description: 'Optional catalog filter: "captions" (280+ caption templates), "vfx" (328+ GPU effects), "transitions" (170+ transitions), "color_presets" (LUTs), "title_cards", "fonts", "blend_modes", "properties", "animatable", "actions", or "all" (default).',
          },
          category: { type: 'string', description: 'Optional domain/category filter.' },
          limit: { type: 'number', description: 'Max actions to return.' },
        },
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('search_tools', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'get_action_schema',
      label: 'Get Canonical Action Schema',
      description: 'Fetch the full JSON inputSchema and parameter constraints for any canonical editor action or read tool.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', minLength: 1, description: 'Canonical action name or read tool name.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('get_action_schema', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'execute_action',
      label: 'Execute Canonical Editor Action',
      description: 'Execute any single canonical editor action (all 189+ actions) or read tool directly on a project scene without autonomous_edit.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', minLength: 1, description: 'Canonical action name or read tool name.' },
          action_params: { type: 'object', description: 'Parameters for the canonical action.' },
          project_id: { type: 'string', description: 'Stable project identifier.' },
          video_url: { type: 'string', description: 'Optional source video URL to seed a new project.' },
          assets: { type: 'array', items: { type: 'object' }, description: 'Optional media assets to seed a new project.' },
          scene: { type: 'object', description: 'Optional inline scene.' },
          include_scene: { type: 'boolean', description: 'If true, include the full raw scene JSON in the response.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('execute_action', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'execute_batch',
      label: 'Execute Canonical Action Batch',
      description: 'Execute an ordered array of canonical actions in one atomic round-trip with automatic safe-zone repair, timeline reconciliation, layout de-stacking, and project commit.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string' },
                params: { type: 'object' },
              },
              required: ['action'],
            },
          },
          project_id: { type: 'string', description: 'Stable project identifier.' },
          video_url: { type: 'string', description: 'Optional source video URL to seed a new project.' },
          assets: { type: 'array', items: { type: 'object' }, description: 'Optional media assets to seed a new project.' },
          scene: { type: 'object', description: 'Optional inline scene.' },
          include_scene: { type: 'boolean', description: 'If true, include the full raw scene JSON in the response.' },
        },
        required: ['actions'],
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('execute_batch', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'render_preview',
      label: 'Render GPU Preview Screenshots',
      description: 'Render real GPU-composited JPEG screenshots of the live project timeline at specified timestamps (and optional 0..1 region crop) and return image blocks for visual inspection before EXPORT_VIDEO.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Stable project identifier.' },
          timestamps: { type: 'array', items: { type: 'number' }, description: 'Timeline timestamps in seconds.' },
          region: { type: 'object', description: 'Optional normalized zoom region { x, y, width, height } in 0..1.' },
          scene: { type: 'object', description: 'Optional inline scene.' },
        },
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('RENDER_PREVIEW', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'search_skills',
      label: 'Search Production Craft Skills',
      description: 'Search Levea production craft skills (SKILL.md playbooks across editing, color grading, captions, audio mixing, motion graphics, VFX, documentary, podcast, and social shorts) by keyword or category.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keyword (e.g. "color", "caption", "podcast", "montage", "motion").' },
          category: { type: 'string', description: 'Optional category filter.' },
          limit: { type: 'number', description: 'Max skills to return (default 20).' },
        },
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('search_skills', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'load_skill',
      label: 'Load Production Craft Skill',
      description: 'Load the full craft playbook (SKILL.md) and bundled resource list for one or more skill IDs returned by search_skills.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill ID to load (e.g. "color-grading-finishing", "caption-typography").' },
          skill_ids: { type: 'array', items: { type: 'string' }, description: 'Optional array of skill IDs to load.' },
        },
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('load_skill', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'read_skill_resource',
      label: 'Read Skill Reference Resource',
      description: 'Read a bundled reference or template file (e.g. "references/..." or "templates/...") belonging to a production skill.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill ID that owns the resource.' },
          resource: { type: 'string', minLength: 1, description: 'Relative path of the resource inside the skill.' },
        },
        required: ['resource'],
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('read_skill_resource', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'asset_upload_url',
      label: 'Get Asset Upload URL',
      description: 'Generate a presigned PUT upload URL to upload a local video, audio, or image file to Levea cloud storage, then pass the returned fileUrl as video_url or assets.',
      parameters: {
        type: 'object',
        properties: {
          fileName: { type: 'string', minLength: 1, description: 'File name (e.g. "clip.mp4").' },
          contentType: { type: 'string', description: 'Optional MIME type (e.g. "video/mp4").' },
          projectId: { type: 'string', description: 'Optional project identifier.' },
        },
        required: ['fileName'],
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('asset_upload_url', params, { toolCallId, signal })),
    });
  },
});
