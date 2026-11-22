import axios, { AxiosError, AxiosInstance } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/**
 * Thin HTTP client for the Levea editor backend.
 *
 * Pass-through only. All endpoints live under `/api/v1/misc/openclaw/v1/*`
 * (API-key auth). The MCP tool surface here mirrors what the route exposes.
 */

/** Backend edit request body, built from the edit contract (editContract.buildEditBody). */
export type EditRequestBody = Record<string, unknown>;

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
  /** A direct EXPORT_VIDEO's own report, kept on its export job (polish gate, deliverable warnings, its steps, verification report). */
  polish?: unknown;
  deliverableWarnings?: unknown[];
  exportCallSteps?: unknown[];
  verificationReport?: unknown;
  deliverySampledDecode?: unknown;
}

/** The report fields a job poll carries for a direct export (backend: TaskResultResolver.directExportReplyFields). */
const JOB_REPORT_FIELDS = ['polish', 'deliverableWarnings', 'exportCallSteps', 'verificationReport', 'deliverySampledDecode'] as const;

function jobReportFields(d: Record<string, unknown>): Partial<JobStatus> {
  const out: Record<string, unknown> = {};
  for (const k of JOB_REPORT_FIELDS) if (d[k] !== undefined && d[k] !== null) out[k] = d[k];
  return out as Partial<JobStatus>;
}

export interface SSEEvent {
  event?: string;
  data: Record<string, unknown> | string;
}

function envMs(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
/** How long a plain request waits (LEVEA_REQUEST_TIMEOUT_MS; default 5 min). */
const DEFAULT_TIMEOUT_MS = envMs('LEVEA_REQUEST_TIMEOUT_MS', 300_000);
/** The SSE variant reports progress while it waits, so it can wait longer than a plain request. */
const STREAM_TIMEOUT_MS = envMs('LEVEA_STREAM_TIMEOUT_MS', 1_800_000);
const DEFAULT_LEVEA_API_URL = 'https://api.livecore.ai';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MCP_CLIENT_VERSION: string = (require('../package.json') as { version: string }).version;

/**
 * Per-request backend config for hosted (multi-tenant) MCP transports.
 *
 * The stdio binary serves exactly one user, so it reads LEVEA_API_URL /
 * LEVEA_API_KEY from the process env. A hosted HTTP transport serves many
 * users from one process, so each request runs inside `runWithLeveaConfig`
 * with the caller's own key. Inside a scoped request the process env is never
 * consulted for the key — a hosted server must not fall back to a shared key.
 */
export interface LeveaClientConfig {
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
  /** Free-form label sent as X-Levea-Client, e.g. "levea-mcp-hosted". */
  clientLabel?: string | undefined;
}

const requestConfig = new AsyncLocalStorage<LeveaClientConfig>();

export function runWithLeveaConfig<T>(config: LeveaClientConfig, fn: () => T): T {
  return requestConfig.run(config, fn);
}

function clientHeader(): string {
  const label = requestConfig.getStore()?.clientLabel || 'levea-mcp-server';
  return `${label}/${MCP_CLIENT_VERSION}`;
}

function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

function normalizeHostUrl(rawInput: string): string {
  let raw = trimTrailingSlashes(rawInput.trim());
  if (!raw) return DEFAULT_LEVEA_API_URL;
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

function baseRoot(): string {
  // LEVEA_API_URL is canonical; ADSCENE_API_URL kept as silent backward-compat fallback.
  // Defaults to https://api.livecore.ai when omitted so users only need LEVEA_API_KEY.
  const scoped = requestConfig.getStore();
  const raw = normalizeHostUrl(
    String(
      scoped
        ? scoped.apiUrl || DEFAULT_LEVEA_API_URL
        : process.env.LEVEA_API_URL || process.env.ADSCENE_API_URL || DEFAULT_LEVEA_API_URL
    )
  );
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

/** Telemetry is on unless LEVEA_TELEMETRY is off / false / 0. */
function telemetryEnabled(): boolean {
  const v = String(process.env.LEVEA_TELEMETRY ?? '').trim().toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0' || v === 'no');
}

// Sends only an event name, this client's name and version, and whether a key is
// set: no prompts, media, keys, or project data. Disable with LEVEA_TELEMETRY=off.
function sendMcpFunnelTelemetry(event: string, hasApiKey: boolean): void {
  if (process.env.VITEST || process.env.NODE_ENV === 'test' || !telemetryEnabled()) return;
  try {
    const telemetryUrl = `${baseRoot()}-keys/telemetry`;
    void axios.post(
      telemetryUrl,
      { event, client: 'levea-mcp-server', version: MCP_CLIENT_VERSION, hasApiKey },
      { timeout: 3000, validateStatus: () => true },
    ).catch(() => {});
  } catch {
    // Non-blocking telemetry
  }
}

function apiKey(): string {
  const scoped = requestConfig.getStore();
  if (scoped) {
    if (!scoped.apiKey) {
      throw new Error(
        'A Levea API key is required. Generate a free API key in 1 click at https://livecore.ai/?openclaw=1&utm_source=levea-mcp-hosted&utm_medium=missing-key&utm_campaign=levea-mcp-server ' +
          'and send it as `Authorization: Bearer <key>` (or the `apiKey` connection setting) when connecting to the hosted MCP endpoint.'
      );
    }
    return scoped.apiKey;
  }
  const key = process.env.LEVEA_API_KEY || process.env.ADSCENE_API_KEY;
  if (!key) {
    sendMcpFunnelTelemetry('auth_missing_local', false);
    throw new Error(
      'LEVEA_API_KEY is required. Generate a free API key in 1 click at https://livecore.ai/?openclaw=1&utm_source=levea-mcp-server&utm_medium=missing-key&utm_campaign=levea-mcp-server ' +
        'and set LEVEA_API_KEY in your MCP client env / mcpServers config.'
    );
  }
  return key;
}

function http2(): AxiosInstance {
  return axios.create({
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'X-Levea-Client': clientHeader(),
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
        `Check LEVEA_API_KEY — generate a fresh key at https://livecore.ai/?openclaw=1&utm_source=levea-mcp-server&utm_medium=auth-failed&utm_campaign=levea-mcp-server .`
    );
  }
  throw new Error(`${label} failed${code ? ` (HTTP ${code})` : ''}: ${upstream}`);
}

function withProjectId(body: EditRequestBody): EditRequestBody {
  if (body.projectId) return body;
  const projectId = `mcp_${randomUUID()}`;
  return { ...body, projectId, project_id: projectId };
}

/**
 * The exported video's URL. The backend sets videoUrl only when the export
 * finished before the response was assembled; otherwise the same URL arrives
 * as export_url / exportUrl / downloadUrl.
 */
function exportedVideoUrl(d: Record<string, unknown>): string | undefined {
  for (const k of ['videoUrl', 'exportUrl', 'export_url', 'downloadUrl']) {
    const v = d[k];
    if (typeof v === 'string' && v.startsWith('http')) return v;
  }
  return undefined;
}

function flattenResult(d: Record<string, unknown>): ExecuteResult {
  return {
    success: d.success !== false,
    message: (d.message as string | undefined) ?? (d.reply as string | undefined),
    data: d.data,
    videoUrl: exportedVideoUrl(d),
    jobId: d.jobId as string | number | undefined,
    status: d.status as string | undefined,
    workingMemory: d.workingMemory as Record<string, unknown> | undefined,
    reply: d.reply as string | undefined,
    raw: d,
  };
}

/**
 * The client stopped waiting, but the edit keeps running on Levea: a full edit
 * with motion graphics and an export can take 10-20 minutes, longer than an MCP
 * request should block. Not an error: the caller polls the project's active task.
 */
function stillRunning(body: EditRequestBody, waitedMs: number): ExecuteResult {
  const projectId = String(body.projectId || body.project_id || '');
  const minutes = Math.round(waitedMs / 60_000);
  return {
    success: false,
    status: 'running',
    message:
      `The edit is still running on Levea after ${minutes} min (full edits with motion graphics and export can take 10-20 minutes). ` +
      `Call get_active_task with project_id "${projectId}" to follow it; once no task is active, get_project returns the finished edit.`,
    raw: { type: 'still_running', status: 'running', projectId, project_id: projectId },
  };
}

function isTimeout(err: unknown): boolean {
  const e = err as { code?: string; name?: string; message?: string };
  return e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.code === 'ERR_CANCELED'
    || e?.name === 'CanceledError' || e?.name === 'TimeoutError' || e?.name === 'AbortError'
    || String(e?.message || '').toLowerCase().includes('timeout');
}

/**
 * One abort signal for a call: the host's cancel signal (a disconnected client)
 * plus a wall-clock limit. `timedOut()` tells the two apart.
 */
function callSignal(limitMs: number, hostSignal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const wall = setTimeout(() => { timedOut = true; controller.abort(); }, limitMs);
  const onHostAbort = () => controller.abort();
  if (hostSignal) {
    if (hostSignal.aborted) controller.abort();
    else hostSignal.addEventListener('abort', onHostAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => { clearTimeout(wall); hostSignal?.removeEventListener('abort', onHostAbort); },
  };
}

/** Execute autonomous_edit (or any allowed tool) — single JSON response. */
export async function execute(edit: EditRequestBody, hostSignal?: AbortSignal): Promise<ExecuteResult> {
  const body = withProjectId(edit);
  // A wall-clock limit: the backend keeps a long edit's response alive with
  // keep-alive bytes, so axios's own (idle) timeout never fires.
  const call = callSignal(DEFAULT_TIMEOUT_MS, hostSignal);
  try {
    const res = await http2().post(v1('/execute'), body, { signal: call.signal });
    const d = (res.data || {}) as Record<string, unknown>;
    if (res.status >= 400) {
      const msg = (d.error as string) || (d.message as string) || `HTTP ${res.status}`;
      return { success: false, message: msg, status: 'error', raw: d };
    }
    return flattenResult(d);
  } catch (err) {
    if (call.timedOut()) return stillRunning(body, DEFAULT_TIMEOUT_MS);
    if (hostSignal?.aborted) return { success: false, status: 'cancelled', message: 'Cancelled by the client; the edit may still be running on Levea.', raw: { type: 'cancelled', projectId: body.projectId } };
    return describeError(err, `execute(${String(body.tool || 'autonomous_edit')})`);
  } finally {
    call.dispose();
  }
}

/**
 * Run a deterministic or universal canonical tool (update_layer, delete_layer,
 * trim_layer, apply_transition, search_tools, get_action_schema, execute_action,
 * execute_batch, render_preview, or any canonical action / read tool) via
 * /v1/execute without invoking the autonomous_edit planner.
 *
 * The backend echoes the whole edited scene; unless `params.include_scene === true`
 * it is dropped here (the caller gets `liveLayers` + `layerCount` and can read
 * the full scene with `get_project`) so multi-step edits do not flood the
 * calling model's context window.
 */
/** Longest server-requested wait the client sits through before retrying a rate-limited call once. */
const RATE_LIMIT_MAX_WAIT_SEC = 65;

/** Seconds to wait before retrying a 429 (retryAfter in the body, else the Retry-After header); null = do not retry. */
function rateLimitWaitSec(res: { status: number; data?: unknown; headers?: Record<string, unknown> }): number | null {
  if (res.status !== 429) return null;
  const bodyWait = Number((res.data as { retryAfter?: unknown } | undefined)?.retryAfter);
  const headerWait = Number(res.headers?.['retry-after']);
  const wait = Number.isFinite(bodyWait) && bodyWait >= 0 ? bodyWait : (Number.isFinite(headerWait) && headerWait >= 0 ? headerWait : NaN);
  if (!Number.isFinite(wait) || wait > RATE_LIMIT_MAX_WAIT_SEC) return null;
  return Math.max(1, Math.ceil(wait)) + Math.random();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/**
 * The task id of a direct call the backend answered "still running" (HTTP 202),
 * else undefined. Only the direct call's own 202 names one: it carries the call
 * id (`callId`, the same id as taskId). An export still rendering also answers
 * status "running" with its job id, and older backends put that id in taskId
 * too: following it replaced the whole reply (polish, deliverableWarnings,
 * receipts) with the export row's clips, {"0": {url, ...}}.
 */
function runningTaskId(d: Record<string, unknown>): string | undefined {
  if (d?.status !== 'running') return undefined;
  const id = d.taskId ?? d.task_id;
  if (typeof id !== 'string' || !id.trim()) return undefined;
  const callId = typeof d.callId === 'string' ? d.callId.trim() : '';
  const pollWith = isPlainObject(d.pollWith) ? d.pollWith : null;
  const pollId = typeof pollWith?.task_id === 'string' ? pollWith.task_id.trim() : '';
  return (callId && callId === id.trim()) || (pollId && pollId === id.trim()) ? id.trim() : undefined;
}

/** A plain JSON object (not an array, not null). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Long-poll a running direct call (GET /task-status/:id?wait=true blocks up to
 * 25 s server-side) until it finishes or this request's own deadline. Returns
 * the call's own full response once finished; on the deadline, the 202 body
 * with the latest live progress (resending the identical call resumes the
 * wait — it is never run twice). null when the call was not running.
 */
async function waitForDirectCall(
  first: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ data: Record<string, unknown>; httpStatus?: number; waitedSec: number } | null> {
  const taskId = runningTaskId(first);
  if (!taskId) return null;
  const t0 = Date.now();
  let data = first;
  const done = (d: Record<string, unknown>, httpStatus?: number) => ({ data: d, httpStatus, waitedSec: Math.round((Date.now() - t0) / 1000) });
  while (!signal.aborted) {
    const pollStart = Date.now();
    let st: { status: number; data: unknown };
    try {
      st = await http2().get(v1(`/task-status/${encodeURIComponent(taskId)}`), { params: { wait: 'true' }, signal });
    } catch {
      if (signal.aborted) break;
      await sleep(5_000, signal);
      continue;
    }
    const s = (st.data || {}) as Record<string, any>;
    if (st.status >= 400) break; // unknown to this key / refused: hand back the 202 as it was
    if (st.status < 400 && s.status && s.status !== 'running') {
      // The call's own full response once finished. Anything else (a job's
      // clip list) is never spread over the reply: it stays under `result`.
      if (isPlainObject(s.result)) {
        const result = s.result;
        return done({ ...result, ...(s.failureCode && !result.failureCode ? { failureCode: s.failureCode } : {}) });
      }
      return done({
        success: s.status === 'completed',
        status: s.status,
        taskId,
        ...(s.result !== undefined && s.result !== null ? { result: s.result } : {}),
        ...(s.failureCode ? { failureCode: s.failureCode } : {}),
        ...(s.error ? { error: s.error } : {}),
        message: s.message,
      });
    }
    if (st.status < 400) {
      // Still running: keep the live progress so a deadline answer says where it is.
      const { result: _r, frames: _f, mcpContent: _m, ...live } = s;
      data = { ...data, ...live, status: 'running', success: false, taskId };
    }
    // The server long-polls ~25 s; if it answered at once (older server), back off.
    if (Date.now() - pollStart < 3_000) await sleep(Math.min(15, Math.max(3, Number(data.retryAfterSec) || 5)) * 1000, signal);
  }
  return done(data);
}

/**
 * Drop what a direct result repeats: `actionsExecuted` is the same array as
 * `stepReceipts`, and `message` often repeats `observation` verbatim. Clients
 * such as Claude Code hand the model the structured result, so every repeated
 * kilobyte is paid for on every call.
 */
function slimDirectResult(r: Record<string, unknown>): Record<string, unknown> {
  const out = { ...r };
  if (Array.isArray(out.stepReceipts) && Array.isArray(out.actionsExecuted)) delete out.actionsExecuted;
  if (typeof out.message === 'string' && out.message === out.observation) delete out.message;
  if (out.task_id === out.taskId) delete out.task_id;
  return out;
}

/** Time left unspent at the end of a call's deadline when it waits for an export job (to answer before the host gives up). */
const EXPORT_WAIT_MARGIN_MS = 10_000;

const EXPORT_JOB_PENDING: ReadonlySet<string> = new Set(['running', 'queued', 'processing', 'pending', 'rendering']);

/** A direct reply whose EXPORT_VIDEO step queued a job still rendering (jobId, a pending status, no video yet). */
function exportStillRendering(r: Record<string, unknown>): boolean {
  if (r.jobId === undefined || r.jobId === null || String(r.jobId).trim() === '') return false;
  if (typeof r.videoUrl === 'string' && r.videoUrl) return false;
  if (!EXPORT_JOB_PENDING.has(String(r.status ?? '').toLowerCase())) return false;
  const receipts = Array.isArray(r.stepReceipts) ? r.stepReceipts as Array<{ action?: unknown }> : [];
  return r.action === 'EXPORT_VIDEO' || receipts.some((s) => s?.action === 'EXPORT_VIDEO');
}

/**
 * The fields a finished (or still running) export job adds to the direct
 * reply that queued it: the job's status and video, under `exportJob` the job
 * record itself, and the report fields the job carries only where the reply
 * has none of its own (the reply's polish / deliverableWarnings /
 * verificationReport are the call's, and win).
 */
function withExportJob(reply: Record<string, unknown>, job: JobStatus): Record<string, unknown> {
  const { polish, deliverableWarnings, exportCallSteps, verificationReport, deliverySampledDecode, ...record } = job;
  const finished = job.status === 'completed' || job.status === 'complete' || job.status === 'succeeded' || job.status === 'success';
  return {
    status: job.status,
    ...(job.videoUrl ? { videoUrl: job.videoUrl } : {}),
    ...(job.success === false || job.status === 'failed' || job.status === 'error' ? { exportError: job.error || job.message } : {}),
    exportJob: record,
    ...(reply.polish === undefined && polish !== undefined ? { polish } : {}),
    ...(reply.deliverableWarnings === undefined && deliverableWarnings !== undefined ? { deliverableWarnings } : {}),
    ...(reply.verificationReport === undefined && verificationReport !== undefined ? { verificationReport } : {}),
    ...(reply.stepReceipts === undefined && exportCallSteps !== undefined ? { exportCallSteps } : {}),
    ...(deliverySampledDecode !== undefined ? { deliverySampledDecode } : {}),
    ...(!finished && EXPORT_JOB_PENDING.has(String(job.status).toLowerCase())
      ? { exportHint: `The export is still rendering; check_job_status { job_id: "${String(reply.jobId)}", wait: true } returns the video with this call's polish report.` }
      : {}),
  };
}

export async function executeDeterministicTool(
  tool: string,
  projectId: string | undefined,
  params: Record<string, unknown>,
  hostSignal?: AbortSignal,
): Promise<unknown> {
  const call = callSignal(DEFAULT_TIMEOUT_MS, hostSignal);
  const callStart = Date.now();
  const resolvedProjectId = projectId || (typeof params?.project_id === 'string' && params.project_id.trim() ? params.project_id.trim() : undefined);
  try {
    const body = {
      tool,
      params,
      ...(resolvedProjectId ? { projectId: resolvedProjectId, project_id: resolvedProjectId } : {}),
      ...(params?.scene !== undefined ? { scene: params.scene } : {}),
    };
    let res = await http2().post(v1('/execute'), body, { signal: call.signal });
    // Rate limited: the server refunded the request and ran nothing, so one
    // retry after its retryAfter (short waits only) is safe and spares the
    // agent a failed step it would otherwise resend at once.
    const waitSec = rateLimitWaitSec(res);
    if (waitSec !== null && !call.signal.aborted) {
      await sleep(waitSec * 1000, call.signal);
      res = await http2().post(v1('/execute'), body, { signal: call.signal });
    }
    let d = (res.data || {}) as Record<string, unknown>;
    let httpStatus = res.status;
    // A long call answers 202 { status: "running", taskId: "dc_…" } and keeps
    // running on Levea. Wait for it here instead of handing the agent a
    // "still running" it would resend in a loop: one tool call returns the
    // call's own full response.
    const waited = await waitForDirectCall(d, call.signal);
    if (waited) { d = waited.data; httpStatus = waited.httpStatus ?? httpStatus; }
    const { scene, ...rest } = d;
    const layers = (scene as { layers?: unknown } | undefined)?.layers;
    const out: Record<string, unknown> = slimDirectResult({
      ...rest,
      ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
      ...(params?.include_scene === true && scene !== undefined ? { scene } : {}),
    });
    if (waited) out.waitedSec = waited.waitedSec;
    if (Array.isArray(layers)) out.layerCount = layers.length;
    // An export still rendering when the call answered: wait for its job
    // here (within this call's own deadline) and add the job's outcome to the
    // reply. The reply's own fields (polish, deliverableWarnings,
    // verificationReport, stepReceipts) are kept; the job never replaces them.
    if (httpStatus < 400 && exportStillRendering(out)) {
      const left = callStart + DEFAULT_TIMEOUT_MS - Date.now() - EXPORT_WAIT_MARGIN_MS;
      if (left > 0 && !call.signal.aborted) {
        const job = await waitForJob(String(out.jobId), { timeoutMs: left });
        Object.assign(out, withExportJob(out, job));
      }
    }
    if (httpStatus >= 400 && out.success === undefined) out.success = false;
    if (httpStatus >= 400) out.httpStatus = httpStatus;
    return out;
  } catch (err) {
    if (hostSignal?.aborted) return { success: false, status: 'cancelled', error: `Cancelled by the client; ${tool} may still have been applied.`, ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}) };
    return describeError(err, `execute(${tool})`);
  } finally {
    call.dispose();
  }
}

/** The run's terminal SSE event types: its outcome, or an error. */
const TERMINAL_STREAM_EVENTS: ReadonlySet<string> = new Set([
  'success', 'partial_success', 'awaiting_approval', 'awaiting_input', 'complete', 'error',
]);

/** How long to wait for the closing payload after a terminal event before returning it. */
const AFTER_TERMINAL_GRACE_MS = 60_000;

/**
 * Execute with SSE streaming. onEvent is called for every event the backend
 * emits (status, thinking, tool_call, tool_result, background_job_completed,
 * heartbeat, the terminal outcome). Returns the final result: the backend's
 * closing JSON payload when it sends one after the stream, else the terminal
 * event; an `error` event ends the call at once.
 */
export async function executeStreaming(
  edit: EditRequestBody,
  onEvent: (ev: SSEEvent) => void,
  hostSignal?: AbortSignal,
): Promise<ExecuteResult> {
  const editBody = withProjectId(edit);
  const body = JSON.stringify(editBody);
  const url = new URL(v1('/execute'));
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  return new Promise<ExecuteResult>((resolve, reject) => {
    let settled = false;
    let final: ExecuteResult | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;
    // A wall-clock limit: the backend's 15 s heartbeats keep the stream busy,
    // so an idle timeout never fires during a long edit. Stopping the wait does
    // not stop the edit: it keeps running on Levea.
    const wall = setTimeout(() => finish(final ?? stillRunning(editBody, STREAM_TIMEOUT_MS)), STREAM_TIMEOUT_MS);
    const onHostAbort = () => finish({ success: false, status: 'cancelled', message: 'Cancelled by the client; the edit may still be running on Levea.', raw: { type: 'cancelled', projectId: editBody.projectId } });
    function finish(result: ExecuteResult | Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(wall);
      if (grace) clearTimeout(grace);
      hostSignal?.removeEventListener('abort', onHostAbort);
      req.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
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
          'X-Levea-Client': clientHeader(),
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          finish(new Error(`Streaming auth rejected (HTTP ${res.statusCode}). Check LEVEA_API_KEY.`));
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          finish(new Error(`Streaming HTTP ${res.statusCode}`));
          return;
        }
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          // SSE messages are delimited by blank lines; accept CRLF line endings too.
          buffer = (buffer + chunk).split('\r\n').join('\n');
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const parsed = parseSSEMessage(raw);
            if (!parsed) continue;
            try { onEvent(parsed); } catch (_e) { /* ignore consumer errors */ }
            const data = typeof parsed.data === 'object' ? parsed.data : { reply: parsed.data };
            const ev = String(parsed.event || (data as Record<string, unknown>).type || '');
            if (!TERMINAL_STREAM_EVENTS.has(ev)) continue;
            if (ev === 'error') {
              // Error events carry no success:false; they are failures.
              const d = data as Record<string, unknown>;
              finish({ ...flattenResult(d), success: false, status: 'error', message: (d.message as string) || (d.error as string) || 'The edit failed.' });
              return;
            }
            final = flattenResult(data as Record<string, unknown>);
            // The backend may still send its closing payload; do not wait forever.
            if (!grace) grace = setTimeout(() => finish(final as ExecuteResult), AFTER_TERMINAL_GRACE_MS);
          }
        });
        res.on('end', () => {
          // The closing payload is a bare JSON object after the last event.
          const rest = buffer.trim();
          if (rest.startsWith('{')) {
            try {
              finish(flattenResult(JSON.parse(rest) as Record<string, unknown>));
              return;
            } catch (_e) { /* not JSON: fall through */ }
          }
          finish(final ?? { success: false, message: 'Stream ended without a terminal event', status: 'incomplete' });
        });
        res.on('error', (e) => finish(e));
      }
    );
    req.on('error', (e) => finish(e));
    if (hostSignal) {
      if (hostSignal.aborted) { onHostAbort(); return; }
      hostSignal.addEventListener('abort', onHostAbort, { once: true });
    }
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
    if (res.status >= 400) {
      // A 4xx (revoked key, rate limit, …) is final for this poll: 'error' ends waitForJob.
      return { success: false, jobId, status: 'error', progress: 0, message: (d.error as string) || (d.message as string) || `HTTP ${res.status}` };
    }
    return {
      success: d.success !== false,
      jobId: (d.jobId as string) || jobId,
      status: (d.status as string) || 'unknown',
      progress: (d.progress as number) || 0,
      message: (d.message as string) || '',
      result: d.result,
      videoUrl: exportedVideoUrl(d),
      error: (d.error as string | null) ?? null,
      createdAt: d.createdAt as string | undefined,
      updatedAt: d.updatedAt as string | undefined,
      ...jobReportFields(d),
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

export async function queueEdit(edit: EditRequestBody): Promise<unknown> {
  try {
    const res = await http2().post(v1('/queue-edit'), withProjectId(edit));
    return res.data;
  } catch (err) {
    return describeError(err, 'queueEdit');
  }
}

export async function getTaskStatus(taskId: string, wait = false): Promise<unknown> {
  try {
    const res = await http2().get(v1(`/task-status/${encodeURIComponent(taskId)}`), wait ? { params: { wait: 'true' } } : undefined);
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
