import axios from 'axios';
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

const REQUEST_TIMEOUT_MS = 600_000;
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
  'executing', 'dispatch', 'awaiting_approval', 'awaiting_input',
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
const PLUGIN_VERSION = '1.1.9';

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

function sendFunnelTelemetry(event: string, hasApiKey: boolean): void {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
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

  return {
    ...data,
    ...projectFields,
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
  try {
    const response = await axios.request({
      method,
      url: openClawUrl(path),
      ...(body !== undefined ? { data: body } : {}),
      headers: requestHeaders(context),
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const result = normalizeBackendResponse(response.status, response.data, options);
    const clientRequestId = sanitizeRequestId(context.toolCallId);
    return clientRequestId && !result.clientRequestId
      ? { ...result, clientRequestId }
      : result;
  } catch (error: any) {
    return handleError(error, options.fallbackProjectId, context.toolCallId);
  }
}

function copyTypedEditParams(request: EditorRequest): {
  params: Record<string, any>;
  topLevel: Record<string, any>;
} {
  const params: Record<string, any> = { prompt: firstString(request.prompt) };
  if (request.video_url) params.video_url = request.video_url;
  if (Array.isArray(request.assets) && request.assets.length > 0) params.assets = request.assets;

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
  return { params, topLevel };
}

export async function handleEditorOperation(
  request: EditorRequest,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const prompt = firstString(request?.prompt);
  if (!prompt) {
    return { success: false, message: 'Missing required parameter: prompt.', code: 'MISSING_PROMPT' };
  }

  const projectId = firstString(request.project_id);
  const { params, topLevel } = copyTypedEditParams({ ...request, prompt });
  const body: Record<string, any> = {
    tool: 'autonomous_edit',
    params,
    ...(projectId ? { projectId, project_id: projectId } : {}),
    ...(request.scene !== undefined ? { scene: request.scene } : {}),
    ...topLevel,
  };

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

  return callBackend('POST', '/queue-edit', {
    prompt,
    projectId,
    project_id: projectId,
    ...(request.scene !== undefined ? { scene: request.scene } : {}),
    ...(Array.isArray(request.assets) ? { assets: request.assets } : {}),
    ...(Array.isArray(request.platforms) ? { platforms: request.platforms } : {}),
    ...(request.autoExport !== undefined ? { autoExport: request.autoExport } : {}),
  }, context, {
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

function displayMessage(result: EditorResponse): string {
  const parts = [result.message];
  if (result.projectId) parts.push(`project: ${result.projectId}`);
  if (result.videoUrl) parts.push(`video: ${result.videoUrl}`);
  if (result.taskId !== undefined) parts.push(`task: ${String(result.taskId)}`);
  if (result.jobId !== undefined) parts.push(`job: ${String(result.jobId)}`);
  if (result.status) parts.push(`status: ${result.status}`);
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
  return {
    content: [{ type: 'text' as const, text: displayMessage(result) }],
    // OpenClaw's AgentToolResult contract calls the structured payload
    // `details` (MCP calls the analogous field `structuredContent`). Preserve
    // the entire backend object; clients must not reconstruct state from text.
    // OpenClaw derives tool failure from details.status (its AgentToolResult
    // does not expose MCP's isError field). Preserve a changed upstream status
    // as backendStatus so normalization never destroys transport evidence.
    details,
  };
}

const TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      minLength: 1,
      description:
        'Natural-language description of the desired video edit. Send the complete user intent in one prompt; the backend owns decomposition, execution, and verification.',
    },
    video_url: { type: 'string', description: 'Optional source video URL for a new project.' },
    assets: {
      type: 'array',
      description: 'Optional asset descriptors used to seed a new scene.',
      items: { type: 'object' },
    },
    project_id: {
      type: 'string',
      minLength: 1,
      description: 'Stable project identifier. Reuse the projectId returned by the first call for every continuation.',
    },
    scene: { type: 'object', description: 'Optional scene used only to bootstrap a project without a committed scene.' },
    requirePlanApproval: { type: 'boolean', description: 'Pause after planning and return workingMemory for approval.' },
    workingMemory: { type: 'object', description: 'Working memory returned by an awaiting-approval call; resend it to resume.' },
    attachedImages: { type: 'array', items: { type: 'string' }, description: 'Reference images for planning.' },
    flaggedIssues: { type: 'array', items: { type: 'string' }, description: 'Specific issues the editor must repair.' },
    captionTemplatePreset: { type: 'string', description: 'Caption template slug or saved template id.' },
    captionTemplateMode: {
      type: 'string',
      enum: ['add', 'recreate', 'style', 'translate', 'clear', 'remove_fillers'],
      description: 'Caption-template operation mode.',
    },
    core_only: { type: 'boolean', description: 'Return rendering-essential scene fields only.' },
    brandId: { type: 'string', description: 'Per-call brand profile id.' },
    projectBrandId: { type: 'string', description: 'Default brand profile for this project.' },
    editedPlan: { type: 'object', description: 'User-edited plan returned by a prior approval pause.' },
  },
  required: ['prompt'],
  additionalProperties: false,
} as const;

const QUEUE_PARAMETERS = {
  type: 'object',
  properties: {
    prompt: TOOL_PARAMETERS.properties.prompt,
    project_id: TOOL_PARAMETERS.properties.project_id,
    scene: TOOL_PARAMETERS.properties.scene,
    assets: TOOL_PARAMETERS.properties.assets,
    platforms: { type: 'array', items: { type: 'string' }, description: 'Optional export platforms.' },
    autoExport: { type: 'boolean', description: 'Automatically export after the queued edit.' },
  },
  required: ['prompt', 'project_id'],
  additionalProperties: false,
} as const;

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
    const rawCfg = (api as any)?.config || (api as any)?.pluginConfig || (typeof (api as any)?.getConfig === 'function' ? (api as any).getConfig() : null) || {};
    const cfgUrl = extractConfigString(rawCfg?.apiUrl || rawCfg?.LEVEA_API_URL);
    const cfgKey = extractConfigString(rawCfg?.apiKey || rawCfg?.LEVEA_API_KEY);
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
  },
});
