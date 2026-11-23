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
const PLUGIN_NAME = 'openclaw-ai-video-editor';
const KEY_URL = 'https://livecore.ai/?openclaw=1&utm_source=openclaw-plugin&utm_medium=missing-key&utm_campaign=openclaw-ai-video-editor';

/**
 * The version in package.json. index.ts (loaded from source by the host) sits
 * next to it; the built dist/index.js sits one level below it.
 */
const PLUGIN_VERSION: string = (() => {
  for (const rel of ['./package.json', '../package.json']) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require(rel) as { name?: string; version?: string };
      if (pkg?.name === PLUGIN_NAME && typeof pkg.version === 'string') return pkg.version;
    } catch {
      // try the next location
    }
  }
  return 'unknown';
})();

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
  // Explicit plugin config (what the user entered for this plugin) wins over env.
  const configured = firstString(
    runtimePluginConfig.apiUrl,
    process.env.LEVEA_API_URL,
    process.env.ADSCENE_API_URL,
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
  // Explicit plugin config wins; the env vars are the fallback.
  return firstString(
    runtimePluginConfig.apiKey,
    process.env.LEVEA_API_KEY,
    process.env.ADSCENE_API_KEY,
  );
}

/** Telemetry is on unless LEVEA_TELEMETRY is off / false / 0. */
function telemetryEnabled(): boolean {
  const v = String(process.env.LEVEA_TELEMETRY ?? '').trim().toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0' || v === 'no');
}

// Sends only an event name, the plugin name and version, and whether a key is
// set: no prompts, media, keys, or project data. Disable with LEVEA_TELEMETRY=off.
// Each event is sent at most once per process, never once per tool call.
const sentTelemetryEvents = new Set<string>();
function sendFunnelTelemetry(event: string, hasApiKey: boolean): void {
  if (process.env.VITEST || process.env.NODE_ENV === 'test' || !telemetryEnabled()) return;
  if (sentTelemetryEvents.has(event)) return;
  sentTelemetryEvents.add(event);
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
      'No Levea API key found. Checked, in order: this plugin\'s OpenClaw config '
      + `(plugins.entries.${PLUGIN_NAME}.config.apiKey: not set), then the environment `
      + '(LEVEA_API_KEY: not set; legacy ADSCENE_API_KEY: not set). '
      + `Generate a free API key at ${KEY_URL} and set it as the plugin's apiKey config `
      + '(preferred) or as LEVEA_API_KEY in the environment of the OpenClaw gateway process.'
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

/** How long one status read may take (the server holds a ?wait=true long-poll ~25 s). */
const STATUS_READ_LIMIT_MS = 60_000;
/** Longest Retry-After the plugin honours before retrying (seconds). */
const MAX_RETRY_AFTER_SEC = 65;

type RawOutcome =
  | { ok: true; status: number; data: any; headers: Record<string, unknown> }
  | { ok: false; error: any; timedOut: boolean; cancelled: boolean };

interface RequestOptions {
  query?: Record<string, string>;
  /** Wall-clock limit for this one request (default REQUEST_TIMEOUT_MS). */
  limitMs?: number;
}

/** One HTTP request, no normalization and no retry. */
async function requestOnce(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  context: OperationContext,
  opts: RequestOptions = {},
): Promise<RawOutcome> {
  // A wall-clock limit: the backend keeps a long edit's response alive with
  // keep-alive bytes, so axios's own (idle) timeout never fires. The host's
  // cancel signal still aborts the call.
  const limitMs = Math.max(1_000, opts.limitMs ?? REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  let timedOut = false;
  const wall = setTimeout(() => { timedOut = true; controller.abort(); }, limitMs);
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
      ...(opts.query ? { params: opts.query } : {}),
      headers: requestHeaders(context),
      timeout: limitMs,
      validateStatus: () => true,
      signal: controller.signal,
    });
    return { ok: true, status: response.status, data: response.data, headers: (response.headers || {}) as Record<string, unknown> };
  } catch (error: any) {
    return { ok: false, error, timedOut, cancelled: Boolean(context.signal?.aborted) && !timedOut };
  } finally {
    clearTimeout(wall);
    context.signal?.removeEventListener('abort', onHostAbort);
  }
}

/** 429, 5xx, or a network failure (not a host cancel): worth another try. */
function isTransientOutcome(outcome: RawOutcome): boolean {
  if (outcome.ok) return outcome.status === 429 || outcome.status >= 500;
  if (outcome.cancelled) return false;
  // A missing key is a configuration error, never transient.
  return !/api key/i.test(String(outcome.error?.message || ''));
}

/** Delay before retry `attempt` (0-based): the server's Retry-After when given, else exponential backoff. */
function retryDelayMs(outcome: RawOutcome, attempt: number): number {
  if (outcome.ok) {
    const bodyWait = Number(outcome.data?.retryAfter ?? outcome.data?.retryAfterSec);
    const headerWait = Number(outcome.headers?.['retry-after']);
    const wait = Number.isFinite(bodyWait) && bodyWait >= 0 ? bodyWait : headerWait;
    if (Number.isFinite(wait) && wait >= 0) {
      return Math.min(MAX_RETRY_AFTER_SEC, Math.max(1, Math.ceil(wait))) * 1000 + Math.floor(Math.random() * 500);
    }
  }
  return Math.min(30_000, 2_000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

function withClientRequestId(result: EditorResponse, context: OperationContext): EditorResponse {
  const clientRequestId = sanitizeRequestId(context.toolCallId);
  return clientRequestId && !result.clientRequestId ? { ...result, clientRequestId } : result;
}

/** Turn a raw outcome into the plugin's result shape. */
function finishOutcome(
  method: 'GET' | 'POST',
  outcome: RawOutcome,
  context: OperationContext,
  options: NormalizeOptions,
): EditorResponse {
  if (outcome.ok) {
    return withClientRequestId(normalizeBackendResponse(outcome.status, outcome.data, options), context);
  }
  if (outcome.cancelled) return cancelledResult(options.label, options.fallbackProjectId, context.toolCallId);
  if (outcome.timedOut && method === 'POST') return stillRunning(options.fallbackProjectId, context.toolCallId);
  if (outcome.timedOut) {
    return withClientRequestId({
      success: false,
      status: 'unknown',
      code: 'TIMEOUT',
      message: `${options.label}: the status read timed out; nothing was changed. Try the same call again.`,
      ...(options.fallbackProjectId ? { projectId: options.fallbackProjectId, project_id: options.fallbackProjectId } : {}),
    }, context);
  }
  return handleError(outcome.error, options.fallbackProjectId, context.toolCallId);
}

/**
 * One backend call. Read-only GETs are retried once on 429 / 5xx / network
 * errors; a POST is never retried automatically (it may already have run).
 * `transient` tells polling loops the failure is worth another poll.
 */
async function callBackendDetailed(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  context: OperationContext,
  options: NormalizeOptions,
  opts: RequestOptions & { retryOnce?: boolean } = {},
): Promise<{ result: EditorResponse; transient: boolean; outcome: RawOutcome }> {
  let outcome = await requestOnce(method, path, body, context, opts);
  if (method === 'GET' && opts.retryOnce !== false && isTransientOutcome(outcome) && !context.signal?.aborted) {
    try {
      await waitForDelay(retryDelayMs(outcome, 0), context.signal);
      outcome = await requestOnce(method, path, body, context, opts);
    } catch {
      return { result: cancelledResult(options.label, options.fallbackProjectId, context.toolCallId), transient: false, outcome };
    }
  }
  return { result: finishOutcome(method, outcome, context, options), transient: isTransientOutcome(outcome), outcome };
}

async function callBackend(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  context: OperationContext,
  options: NormalizeOptions,
  opts: RequestOptions & { retryOnce?: boolean } = {},
): Promise<EditorResponse> {
  return (await callBackendDetailed(method, path, body, context, options, opts)).result;
}

/**
 * The host cancelled the tool call. The request may already have reached
 * Levea, so the edit can still be running (or applied) there.
 */
function cancelledResult(label: string, projectId: string | undefined, toolCallId?: string, taskId?: string): EditorResponse {
  const clientRequestId = sanitizeRequestId(toolCallId);
  const how = [
    taskId ? `check_task_status { task_id: "${taskId}" }` : '',
    projectId ? `get_active_task { project_id: "${projectId}" }` : '',
  ].filter(Boolean).join(' or ');
  return {
    success: false,
    status: 'cancelled',
    code: 'CANCELLED',
    message: `Cancelled by the host before ${label} answered. The request may already have reached Levea, so the edit may still be running (or already applied) there. `
      + (how ? `Check with ${how} before starting it again.` : 'Check the project before starting it again.'),
    ...(projectId ? { projectId, project_id: projectId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(clientRequestId ? { clientRequestId } : {}),
  };
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
      + `Call get_active_task with project_id "${projectId || ''}" to see whether it is still running and which task it is; `
      + 'check_task_status with that taskId returns its result (and video URL) once it completes. Do not start the edit again.',
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
    label: 'ai-video-editor',
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

function failedStateAsFailure(result: EditorResponse, label: string): EditorResponse {
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

async function pollOperation(
  path: string,
  label: string,
  context: OperationContext,
  options: { fallbackProjectId?: string; acceptActiveContract?: boolean; query?: Record<string, string> } = {},
): Promise<EditorResponse> {
  const result = await callBackend('GET', path, undefined, context, {
    label,
    fallbackProjectId: options.fallbackProjectId,
    acceptActiveContract: options.acceptActiveContract,
  }, { query: options.query, limitMs: STATUS_READ_LIMIT_MS });
  return failedStateAsFailure(result, label);
}

/**
 * Poll a job until a terminal state, the deadline, or a host cancel. 429 / 5xx
 * / network errors only back off and poll again (a single 502 never ends the
 * wait); a non-transient refusal (401, 404 …) is final.
 */
async function pollJobUntil(
  jobId: string,
  deadline: number,
  context: OperationContext,
): Promise<EditorResponse> {
  const path = `/jobs/${encodeURIComponent(jobId)}`;
  const label = `job ${jobId}`;
  let last: EditorResponse | undefined;
  let transientStreak = 0;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const polled = await callBackendDetailed('GET', path, undefined, context, { label }, {
      retryOnce: false,
      limitMs: Math.min(STATUS_READ_LIMIT_MS, remaining),
    });
    if (polled.result.code === 'CANCELLED') return { ...(last || {}), ...polled.result, jobId };
    let delay = 4_000;
    if (polled.transient) {
      // Keep the last good read; only note the transient failure.
      delay = retryDelayMs(polled.outcome, transientStreak++);
      last = last ? { ...last, lastPollError: polled.result.message } : polled.result;
    } else {
      transientStreak = 0;
      last = failedStateAsFailure(polled.result, label);
      const status = String(last.status || '').toLowerCase();
      if (TERMINAL_JOB_STATES.has(status)) return last;
      if (last.success !== true) return last;
    }
    if (Date.now() + delay >= deadline) break;
    try {
      await waitForDelay(delay, context.signal);
    } catch {
      return cancelledResult(label, firstString(last?.projectId), context.toolCallId);
    }
  }
  const waitedMin = Math.max(1, Math.round(REQUEST_TIMEOUT_MS / 60_000));
  return {
    ...(last || { status: 'unknown' }),
    jobId,
    success: false,
    code: 'POLL_TIMEOUT',
    message: `Job ${jobId} is still ${String(last?.status || 'running')} after waiting up to ${waitedMin} min; it keeps running on Levea. `
      + `Call check_job_status { job_id: "${jobId}", wait: true } again to keep waiting.`,
  };
}

export async function handleJobStatusOperation(
  jobId: string,
  wait = false,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const id = firstString(jobId);
  if (!id) return { success: false, message: 'Missing required parameter: job_id.', code: 'MISSING_JOB_ID' };
  if (!wait) return pollOperation(`/jobs/${encodeURIComponent(id)}`, `job ${id}`, context);
  return pollJobUntil(id, Date.now() + REQUEST_TIMEOUT_MS, context);
}

/**
 * Read a task. `?wait=true` asks the server to hold the read (~25 s) until the
 * task changes or finishes — a running direct call ("dc_…") answers with its
 * full result as soon as it completes. Returns the state at that point.
 */
export function handleTaskStatusOperation(
  taskId: string,
  context: OperationContext = {},
): Promise<EditorResponse> {
  const id = firstString(taskId);
  if (!id) return Promise.resolve({ success: false, message: 'Missing required parameter: task_id.', code: 'MISSING_TASK_ID' });
  return pollOperation(`/task-status/${encodeURIComponent(id)}`, `task ${id}`, context, { query: { wait: 'true' } });
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
  const fullDetails = backendStatus && backendStatus !== normalizedStatus
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
  // Frames attached as image blocks are not repeated as base64 in details:
  // 8 frames of base64 (~400 KB) would flood the model's context.
  const details = imageBlocks.length > 0 ? withoutAttachedImages(fullDetails) : fullDetails;
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
  const callParams = normalizeDirectParams(params);
  const body: Record<string, any> = {
    tool: toolName,
    params: callParams,
    ...(projectId ? { projectId, project_id: projectId } : {}),
    ...(callParams?.scene !== undefined ? { scene: callParams.scene } : {}),
  };
  const normalizeOptions: NormalizeOptions = {
    label: toolName,
    requireMessage: false,
    requireVerification: false,
    fallbackProjectId: projectId,
  };
  // One deadline for the whole call: the POST, waiting for a long call, and
  // waiting for an export job it queued.
  const callStart = Date.now();
  const deadline = callStart + REQUEST_TIMEOUT_MS;
  // Never retried automatically: the POST may already have run.
  const first = await requestOnce('POST', '/execute', body, context);
  if (!first.ok) return finishOutcome('POST', first, context, normalizeOptions);

  let httpStatus = first.status;
  let data: any = first.data;
  let waitedSec: number | undefined;
  // A long call (FACE_RETOUCH, generation, EXPORT_VIDEO …) answers HTTP 202
  // { status: "running", taskId: "dc_…" } and keeps running on Levea. Wait for
  // it here so one tool call returns the call's own full response.
  const runningId = runningTaskId(data);
  if (runningId) {
    const waited = await waitForDirectCall(runningId, data, deadline, context);
    waitedSec = waited.waitedSec;
    if (waited.outcome === 'cancelled') {
      return cancelledResult(toolName, projectId, context.toolCallId, runningId);
    }
    if (waited.outcome === 'running') {
      return directStillRunning(toolName, runningId, waited.data, waited.waitedSec, projectId, context);
    }
    data = waited.data;
    httpStatus = 200;
  }

  let res = withClientRequestId(normalizeBackendResponse(httpStatus, data, normalizeOptions), context);
  if (!callParams?.include_scene && res && typeof res === 'object') {
    const { scene: _omittedScene, ...rest } = res as Record<string, any>;
    res = rest as EditorResponse;
  }
  if (waitedSec !== undefined) res.waitedSec = waitedSec;

  // An export still rendering when the call answered: wait for its job within
  // this call's own deadline and add the job's outcome to the reply. The
  // reply's own fields (polish, deliverableWarnings, verificationReport,
  // stepReceipts) are kept; the job never replaces them.
  if (res.success === true && exportStillRendering(res)) {
    const left = deadline - Date.now() - EXPORT_WAIT_MARGIN_MS;
    if (left > 0 && !context.signal?.aborted) {
      const job = await pollJobUntil(String(res.jobId), Date.now() + left, context);
      res = { ...res, ...withExportJob(res, job) };
    } else {
      res = { ...res, exportHint: exportHint(res.jobId) };
      res.message = `${res.message} ${res.exportHint}`;
    }
  }
  return res;
}

/** Leave `allow_partial` as the backend expects it: true / false / "until_failure". */
function normalizeDirectParams(params: Record<string, any>): Record<string, any> {
  if (!params || typeof params !== 'object') return params;
  const v = params.allow_partial;
  if (v === 'true' || v === 'false') return { ...params, allow_partial: v === 'true' };
  return params;
}

/** Time left unspent at the end of a call's deadline when it waits for an export job. */
const EXPORT_WAIT_MARGIN_MS = 10_000;
const EXPORT_JOB_PENDING: ReadonlySet<string> = new Set(['running', 'queued', 'processing', 'pending', 'rendering']);
const JOB_REPORT_FIELDS = ['polish', 'deliverableWarnings', 'exportCallSteps', 'verificationReport', 'deliverySampledDecode'] as const;

function isPlainObject(v: unknown): v is Record<string, any> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The task id of a direct call the backend answered "still running" (HTTP 202),
 * else undefined. Only the direct call's own 202 names one: it carries the call
 * id (`callId`, the same id as taskId) or pollWith.task_id. An export still
 * rendering also answers status "running" with its job id; following that would
 * replace the whole reply with the export row.
 */
function runningTaskId(d: any): string | undefined {
  if (!isPlainObject(d) || d.status !== 'running') return undefined;
  const id = d.taskId ?? d.task_id;
  if (typeof id !== 'string' || !id.trim()) return undefined;
  const callId = typeof d.callId === 'string' ? d.callId.trim() : '';
  const pollWith = isPlainObject(d.pollWith) ? d.pollWith : null;
  const pollId = typeof pollWith?.task_id === 'string' ? pollWith.task_id.trim() : '';
  return (callId && callId === id.trim()) || (pollId && pollId === id.trim()) ? id.trim() : undefined;
}

/**
 * Long-poll a running direct call (GET /task-status/:id?wait=true, held ~25 s
 * server-side) until it finishes, the deadline passes, or the host cancels.
 * 429 / 5xx / network errors back off and poll again; a 4xx hands back the
 * 202 body as it was (still running).
 */
async function waitForDirectCall(
  taskId: string,
  first: Record<string, any>,
  deadline: number,
  context: OperationContext,
): Promise<{ outcome: 'done' | 'running' | 'cancelled'; data: Record<string, any>; waitedSec: number }> {
  const t0 = Date.now();
  let data = first;
  let transientStreak = 0;
  const end = (outcome: 'done' | 'running' | 'cancelled', d: Record<string, any>) =>
    ({ outcome, data: d, waitedSec: Math.round((Date.now() - t0) / 1000) });
  const pause = async (ms: number): Promise<boolean> => {
    if (Date.now() + ms >= deadline) return false;
    try { await waitForDelay(ms, context.signal); return true; } catch { return false; }
  };
  while (Date.now() < deadline) {
    if (context.signal?.aborted) return end('cancelled', data);
    const pollStart = Date.now();
    const st = await requestOnce('GET', `/task-status/${encodeURIComponent(taskId)}`, undefined, context, {
      query: { wait: 'true' },
      limitMs: Math.min(STATUS_READ_LIMIT_MS, deadline - Date.now()),
    });
    if (!st.ok && st.cancelled) return end('cancelled', data);
    if (isTransientOutcome(st)) {
      if (!(await pause(retryDelayMs(st, transientStreak++)))) break;
      continue;
    }
    if (!st.ok) break;
    transientStreak = 0;
    if (st.status >= 400) break; // unknown to this key / refused: hand back the 202 as it was
    const s = (isPlainObject(st.data) ? st.data : {}) as Record<string, any>;
    if (s.status && s.status !== 'running') {
      // The call's own full response once finished. Anything else (a job's
      // clip list) is never spread over the reply: it stays under `result`.
      if (isPlainObject(s.result)) {
        const result = s.result;
        return end('done', {
          ...result,
          ...(typeof result.success !== 'boolean' ? { success: s.status === 'completed' } : {}),
          ...(s.failureCode && !result.failureCode ? { failureCode: s.failureCode } : {}),
        });
      }
      return end('done', {
        success: s.status === 'completed',
        status: s.status,
        taskId,
        ...(s.result !== undefined && s.result !== null ? { result: s.result } : {}),
        ...(s.failureCode ? { failureCode: s.failureCode } : {}),
        ...(s.error ? { error: s.error } : {}),
        message: firstString(s.message, s.error) || `${taskId}: ${String(s.status)}.`,
      });
    }
    // Still running: keep the live progress so a deadline answer says where it is.
    const { result: _r, frames: _f, mcpContent: _m, ...live } = s;
    data = { ...data, ...live, status: 'running', success: false, taskId };
    // The server long-polls ~25 s; if it answered at once (older server), back off.
    if (Date.now() - pollStart < 3_000) {
      if (!(await pause(Math.min(15, Math.max(3, Number(data.retryAfterSec) || 5)) * 1000))) break;
    }
  }
  return end(context.signal?.aborted ? 'cancelled' : 'running', data);
}

function directStillRunning(
  toolName: string,
  taskId: string,
  live: Record<string, any>,
  waitedSec: number,
  projectId: string | undefined,
  context: OperationContext,
): EditorResponse {
  const { result: _r, frames: _f, mcpContent: _m, scene: _s, ...rest } = live;
  const pd = isPlainObject(rest.progressDetail) ? rest.progressDetail : undefined;
  const where = pd && pd.stepsTotal
    ? ` Step ${Math.min(pd.stepsTotal, (pd.stepsDone ?? 0) + 1)} of ${pd.stepsTotal}${pd.currentAction ? ` (${pd.currentAction})` : ''}.`
    : '';
  return withClientRequestId({
    ...rest,
    ...(projectId ? { projectId, project_id: projectId } : {}),
    success: false,
    status: 'running',
    code: 'STILL_RUNNING',
    taskId,
    waitedSec,
    message: `${toolName} is still running on Levea after waiting ${waitedSec} s; nothing is lost and it is never run twice.${where} `
      + `Call check_task_status { task_id: "${taskId}" } to keep waiting for its result (or resend the identical call). Do not change the params while it runs.`,
  }, context);
}

function exportHint(jobId: unknown): string {
  return `The export is still rendering; check_job_status { job_id: "${String(jobId)}", wait: true } returns the video.`;
}

/** A direct reply whose EXPORT_VIDEO step queued a job still rendering (jobId, a pending status, no video yet). */
function exportStillRendering(r: Record<string, any>): boolean {
  if (r.jobId === undefined || r.jobId === null || String(r.jobId).trim() === '') return false;
  if (typeof r.videoUrl === 'string' && r.videoUrl) return false;
  if (!EXPORT_JOB_PENDING.has(String(r.status ?? '').toLowerCase())) return false;
  const receipts = Array.isArray(r.stepReceipts) ? r.stepReceipts as Array<{ action?: unknown }> : [];
  return r.action === 'EXPORT_VIDEO' || receipts.some((s) => s?.action === 'EXPORT_VIDEO');
}

/**
 * The fields a finished (or still running) export job adds to the direct reply
 * that queued it. The job's report fields fill in only where the reply has
 * none of its own.
 */
function withExportJob(reply: Record<string, any>, job: EditorResponse): Record<string, any> {
  const record: Record<string, any> = { ...job };
  const report: Record<string, any> = {};
  for (const k of JOB_REPORT_FIELDS) {
    if (record[k] !== undefined) report[k] = record[k];
    delete record[k];
  }
  const status = String(job.status || '').toLowerCase();
  const finished = ['completed', 'complete', 'succeeded', 'success'].includes(status);
  // A wait that ran out or was cancelled leaves the export rendering on Levea.
  const waitEnded = job.code === 'POLL_TIMEOUT' || job.code === 'CANCELLED';
  const failed = !waitEnded && job.success === false && !EXPORT_JOB_PENDING.has(status);
  const pending = !finished && !failed;
  const out: Record<string, any> = {
    status: failed && !FAILED_JOB_STATES.has(status)
      ? 'failed'
      : (waitEnded || !job.status ? reply.status : job.status),
    exportJob: record,
    ...(job.videoUrl ? { videoUrl: job.videoUrl } : {}),
    ...(failed ? { exportError: firstString(job.error, job.message) || 'export failed' } : {}),
    ...(reply.polish === undefined && report.polish !== undefined ? { polish: report.polish } : {}),
    ...(reply.deliverableWarnings === undefined && report.deliverableWarnings !== undefined ? { deliverableWarnings: report.deliverableWarnings } : {}),
    ...(reply.verificationReport === undefined && report.verificationReport !== undefined ? { verificationReport: report.verificationReport } : {}),
    ...(reply.stepReceipts === undefined && report.exportCallSteps !== undefined ? { exportCallSteps: report.exportCallSteps } : {}),
    ...(report.deliverySampledDecode !== undefined ? { deliverySampledDecode: report.deliverySampledDecode } : {}),
  };
  if (pending) {
    out.exportHint = exportHint(reply.jobId);
    out.message = `${reply.message} ${out.exportHint}`;
  } else if (failed) {
    out.message = `${reply.message} Export failed: ${out.exportError}`;
  } else if (job.videoUrl) {
    out.message = `${reply.message} Export finished.`;
  }
  return out;
}

/** Keys that carry frame image data already attached as image content blocks. */
const IMAGE_DATA_KEYS: ReadonlySet<string> = new Set(['base64', 'dataUrl', 'frameImages', 'mcpContent']);

/** Drop base64 frame data from the structured details once the frames are attached as image blocks. */
function withoutAttachedImages(value: unknown, depth = 0): unknown {
  if (depth > 4 || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((x) => withoutAttachedImages(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(value as Record<string, unknown>)) {
    if (IMAGE_DATA_KEYS.has(k)) {
      if (k === 'base64') out.image = 'attached as an image content block';
      continue;
    }
    out[k] = withoutAttachedImages(x, depth + 1);
  }
  return out;
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
  properties: {
    task_id: {
      type: 'string',
      minLength: 1,
      description: 'Task id: the taskId returned by queue_edit (numeric, sent as a string), or a "dc_…" id from a direct call (execute_action / execute_batch / render_preview) that answered status "running".',
    },
  },
  required: ['task_id'],
  additionalProperties: false,
} as const;

/** Options shared by execute_action and execute_batch (passed through to the backend). */
const DIRECT_CALL_OPTION_PROPERTIES = {
  idempotency_key: { type: 'string', description: 'Optional: your own id for this logical call. Resending with the same key returns the first answer instead of applying the edit twice (a resend of a call that answered "running" is deduplicated even without one).' },
  rerun: { type: 'boolean', description: 'true runs an identical call again on purpose instead of returning the earlier answer.' },
  dry_run: { type: 'boolean', description: 'true: check every step\'s parameters against its schema (unknown names, enum values, types, ranges) and return valid / problems / corrected_params; nothing runs or is committed. Send the same call without dry_run to run it.' },
  allow_unknown_params: { type: 'boolean', description: 'true runs the call even with parameters an action does not take (they are ignored and listed). Default false: any parameter problem refuses the call with INVALID_PARAMS before anything runs.' },
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
      description: 'Read an export/async job by job_id. wait=true polls until the job finishes or fails (up to the plugin request timeout; rate limits and temporary server errors are retried, not reported as failure).',
      parameters: JOB_STATUS_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleJobStatusOperation(String(params?.job_id || ''), params?.wait === true, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'check_task_status',
      label: 'Check Queued Edit',
      description: 'Read a task: a queued edit (taskId from queue_edit) or a direct call that answered status "running" (taskId "dc_…" from execute_action / execute_batch / render_preview). The server holds the read up to ~25 s for a change; a finished "dc_…" call returns that call\'s full response under result. If the status is still running, call again. Separate from job_id (exports: check_job_status).',
      parameters: TASK_STATUS_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleTaskStatusOperation(String(params?.task_id || ''), { toolCallId, signal })),
    });

    api.registerTool({
      name: 'get_active_task',
      label: 'Get Active Project Edit',
      description: 'Return the currently running edit task for a project_id, if any (one read; it does not wait). Use the returned taskId with check_task_status for the result; once no task is active the edit has finished.',
      parameters: ACTIVE_TASK_PARAMETERS,
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleActiveTaskOperation(String(params?.project_id || ''), { toolCallId, signal })),
    });

    api.registerTool({
      name: 'search_tools',
      label: 'Search Canonical Editor Tools',
      description: 'Search every directly callable editing action, the read/inspection tools, AND preset catalogs (captions, vfx, transitions, color_presets, title_cards, fonts, blend_modes, properties, animatable) by keyword, category, or catalog filter. With a query, matching actions come back with their parameter specs. Also returns the 5-phase NLE editorialPlaybook.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional search keyword (e.g. "karaoke", "hormozi", "lens_blur", "whip_pan", "teal_orange", "chromakey").' },
          catalog: {
            type: 'string',
            enum: ['all', 'actions', 'captions', 'vfx', 'transitions', 'color_presets', 'title_cards', 'fonts', 'blend_modes', 'properties', 'animatable'],
            description: 'Optional catalog filter: "captions" (caption templates), "vfx" (GPU effects), "transitions", "color_presets" (LUTs), "title_cards", "fonts", "blend_modes", "properties", "animatable", "actions", or "all" (default).',
          },
          category: { type: 'string', description: 'Optional domain/category filter.' },
          limit: { type: 'number', description: 'Max actions to return (default: all matches; preset catalogs default to 50).' },
          include_schemas: { type: 'boolean', description: 'Force parameter specs on (true) or off (false). Default: on when 25 or fewer actions match.' },
          offset: { type: 'number', description: 'Page through a long result: pass the nextOffset a previous answer returned.' },
          detail: { type: 'string', enum: ['summary', 'full'], description: '"summary" (default): one-line descriptions. "full": full action descriptions (pages sooner).' },
        },
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) =>
        toOpenClawToolResult(await handleUniversalToolOperation('search_tools', params, { toolCallId, signal })),
    });

    api.registerTool({
      name: 'get_action_schema',
      label: 'Get Canonical Action Schema',
      description: 'Fetch the full JSON inputSchema and parameter constraints for one canonical editor action or read tool (action), or several in one call (actions). Pass action or actions.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', minLength: 1, description: 'Canonical action name or read tool name.' },
          actions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Several action names at once (up to 40) — one round trip instead of many. They share one answer budget: small schemas come whole, larger ones summarised (listed in `compacted`; schemaDetail.paramsOmitted names the rest).',
          },
          params: {
            type: ['array', 'object'],
            items: { type: 'string' },
            additionalProperties: { type: 'array', items: { type: 'string' } },
            description: 'Only these parameters, in full (nested schemas, every enum value): ["name", ...], or { "ACTION": ["name", ...] } per action with actions: [...]. Use it for the parameters a summarised schema lists in schemaDetail.paramsOmitted.',
          },
          detail: { type: 'string', enum: ['summary', 'full'], description: '"summary" (default): a very large schema is compacted. "full": the whole schema as stored (some are hundreds of KB).' },
        },
        additionalProperties: false,
      },
      execute: async (toolCallId: string, params: any, signal?: AbortSignal) => {
        const hasAction = typeof params?.action === 'string' && params.action.trim() !== '';
        const hasActions = Array.isArray(params?.actions) && params.actions.length > 0;
        if (!hasAction && !hasActions) {
          return toOpenClawToolResult({ success: false, message: 'Pass action (one name) or actions (several names).', code: 'MISSING_ACTION' });
        }
        return toOpenClawToolResult(await handleUniversalToolOperation('get_action_schema', params, { toolCallId, signal }));
      },
    });

    api.registerTool({
      name: 'execute_action',
      label: 'Execute Canonical Editor Action',
      description: 'Execute any single canonical editor action or read tool directly on a project scene, without the ai-video-editor tool\'s planner. Long calls (FACE_RETOUCH, generation, EXPORT_VIDEO) wait for their own result, including a queued export job, up to the plugin request timeout; if still running, the result names a taskId for check_task_status. dry_run: true checks params without running. For several edits use execute_batch.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', minLength: 1, description: 'Canonical action name or read tool name.' },
          action_params: { type: 'object', description: 'Parameters for the canonical action (see get_action_schema).' },
          project_id: { type: 'string', description: 'Stable project identifier.' },
          video_url: { type: 'string', description: 'Optional source video URL to seed a new project.' },
          assets: { type: 'array', items: { type: 'object' }, description: 'Optional media assets to seed a new project.' },
          scene: { type: 'object', description: 'Optional inline scene.' },
          include_scene: { type: 'boolean', description: 'If true, include the full raw scene JSON in the response.' },
          ...DIRECT_CALL_OPTION_PROPERTIES,
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
      description: 'Execute an ordered array of canonical actions and/or read tools (up to 25 steps) in one atomic round-trip with automatic safe-zone repair, timeline reconciliation, layout de-stacking, and project commit. The whole batch is validated first: unknown actions, unconfirmed destructive actions (need confirm_destructive: true) and invalid params (INVALID_PARAMS) reject it before anything runs. Atomic unless allow_partial. Long batches wait for their own result (and a queued export job) up to the plugin request timeout; if still running, the result names a taskId for check_task_status.',
      parameters: {
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
          project_id: { type: 'string', description: 'Stable project identifier.' },
          video_url: { type: 'string', description: 'Optional source video URL to seed a new project.' },
          assets: { type: 'array', items: { type: 'object' }, description: 'Optional media assets to seed a new project.' },
          scene: { type: 'object', description: 'Optional inline scene.' },
          include_scene: { type: 'boolean', description: 'If true, include the full raw scene JSON in the response.' },
          ...DIRECT_CALL_OPTION_PROPERTIES,
          allow_partial: {
            type: ['boolean', 'string'],
            enum: [true, false, 'until_failure'],
            description: 'false (default): atomic. true: commit every step that succeeded. "until_failure": commit the steps before the first failure.',
          },
          confirm_destructive: { type: 'boolean', description: 'Required true for destructive actions (CLEAR, DELETE_LAYER on many layers, …).' },
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
