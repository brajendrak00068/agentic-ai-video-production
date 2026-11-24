import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { isIP } from 'net';

/**
 * Thin HTTP client for the Levea editor backend.
 *
 * Pass-through only. All endpoints live under `/api/v1/misc/openclaw/v1/*`
 * (API-key auth). The MCP tool surface here mirrors what the route exposes.
 *
 * Dependency-free on purpose (node:http/https with shared keep-alive agents):
 * the published package installs nothing, so `npx -y levea-mcp-server`
 * starts well inside MCP clients' connect timeouts.
 */

/** Backend edit request body, built from the edit contract (editContract.buildEditBody). */
export type EditRequestBody = Record<string, unknown>;

/**
 * An edit's result: the backend's own reply (every field it sent), with
 * success / message / videoUrl normalised and the project id always present.
 */
export interface ExecuteResult {
  success: boolean;
  message?: string;
  data?: unknown;
  videoUrl?: string;
  jobId?: number | string;
  status?: string;
  type?: string;
  projectId?: string;
  project_id?: string;
  workingMemory?: Record<string, unknown>;
  reply?: string;
  /** Only on a "still running" result (kept small: { type, status, projectId, project_id }). */
  raw?: Record<string, unknown>;
  [key: string]: unknown;
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

/** Called while a long call waits: one short human-readable line per poll / heartbeat. */
export type ProgressFn = (message: string) => void;

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
/** How often a long wait without its own events reports progress. */
const PROGRESS_INTERVAL_MS = 15_000;
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

// ───────────────────────────────────────────────────────────────────────────
// HTTP: one shared keep-alive agent per protocol (the hosted endpoint loops
// many calls back to the same API host; a fresh TLS handshake per call is
// wasted latency). Auth headers are per request, never on the agent.
// ───────────────────────────────────────────────────────────────────────────

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64 });

interface HttpResponse {
  status: number;
  data: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
}

interface RequestOpts {
  body?: unknown;
  params?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Idle (socket inactivity) timeout. */
  timeoutMs?: number;
  /** Send the caller's API key (default true). */
  auth?: boolean;
}

class RequestError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    if (code === 'ABORT_ERR') this.name = 'AbortError';
  }
}

function parseBody(text: string): Record<string, unknown> {
  const t = text.trim();
  if (!t) return {};
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const v = JSON.parse(t);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : { data: v };
    } catch { /* not JSON */ }
  }
  return { message: t.length > 2000 ? `${t.slice(0, 2000)}…` : t };
}

/** One HTTP request. Resolves for any status; rejects on network errors, idle timeout, or abort. */
function request(method: string, url: string, opts: RequestOpts = {}): Promise<HttpResponse> {
  // Built before any socket or timer exists: a missing key rejects cleanly.
  const headers: Record<string, string | number> = {
    Accept: 'application/json',
    'X-Levea-Client': clientHeader(),
  };
  if (opts.auth !== false) headers.Authorization = `Bearer ${apiKey()}`;
  const u = new URL(url);
  for (const [k, v] of Object.entries(opts.params || {})) if (v !== undefined) u.searchParams.set(k, v);
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  const isHttps = u.protocol === 'https:';
  const transport = isHttps ? https : http;
  return new Promise<HttpResponse>((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new RequestError('The request was aborted', 'ABORT_ERR')); return; }
    let done = false;
    let req: http.ClientRequest | undefined;
    const onAbort = () => fail(new RequestError('The request was aborted', 'ABORT_ERR'));
    function fail(err: Error) {
      if (done) return;
      done = true;
      opts.signal?.removeEventListener('abort', onAbort);
      req?.destroy();
      reject(err);
    }
    req = transport.request(
      u,
      { method, headers, agent: isHttps ? httpsAgent : httpAgent },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('error', (e) => fail(e));
        res.on('end', () => {
          if (done) return;
          done = true;
          opts.signal?.removeEventListener('abort', onAbort);
          resolve({ status: res.statusCode || 0, data: parseBody(Buffer.concat(chunks).toString('utf8')), headers: res.headers });
        });
      },
    );
    req.setTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => fail(new RequestError(`timeout after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`, 'ETIMEDOUT')));
    req.on('error', (e) => fail(e));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
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
    void request('POST', telemetryUrl, {
      body: { event, client: 'levea-mcp-server', version: MCP_CLIENT_VERSION, hasApiKey },
      timeoutMs: 3000,
      auth: false,
    }).catch(() => {});
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
        'and set LEVEA_API_KEY in your MCP client env / mcpServers config. (Or connect to the hosted endpoint https://api.livecore.ai/api/v1/misc/mcp, which signs in with OAuth and needs no key.)'
    );
  }
  return key;
}

function authRejected(label: string, code: number): Error {
  const scoped = Boolean(requestConfig.getStore());
  return new Error(
    `${label} failed: authentication rejected (HTTP ${code}). ` +
      (scoped
        ? 'Your Levea credential was refused: reconnect / sign in again, or send a fresh key generated at https://livecore.ai/?openclaw=1&utm_source=levea-mcp-hosted&utm_medium=auth-failed&utm_campaign=levea-mcp-server . '
        : 'LEVEA_API_KEY is invalid or revoked: regenerate a key at https://livecore.ai/?openclaw=1&utm_source=levea-mcp-server&utm_medium=auth-failed&utm_campaign=levea-mcp-server and update your MCP client config. ') +
      'Do not retry with the same key.'
  );
}

function upstreamMessage(d: Record<string, unknown>, status: number): string {
  const e = d.error;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message;
  if (typeof d.message === 'string' && d.message) return d.message;
  return `HTTP ${status}`;
}

function isAbort(err: unknown): boolean {
  const e = err as { code?: string; name?: string };
  return e?.code === 'ABORT_ERR' || e?.name === 'AbortError';
}

/**
 * A backend call with Levea's error rules:
 *  - 401 / 403 → the "regenerate your key, do not retry" error (thrown);
 *  - 5xx / network error → retried once with backoff when `retry` (read-only
 *    and poll calls only — never a mutating execute), else thrown;
 *  - any other status is returned for the caller to read.
 */
async function call(
  label: string,
  method: string,
  path: string,
  opts: RequestOpts & { retry?: boolean } = {},
): Promise<HttpResponse> {
  const attempts = opts.retry ? 2 : 1;
  for (let attempt = 1; ; attempt++) {
    let res: HttpResponse;
    try {
      res = await request(method, v1(path), opts);
    } catch (err) {
      // Only transport failures (they carry a system code) are retried; a missing key or an abort is final.
      const transient = typeof (err as { code?: unknown })?.code === 'string' && !isAbort(err);
      if (!transient || attempt >= attempts || opts.signal?.aborted) {
        throw new Error(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(1000 + Math.random() * 1000, opts.signal);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw authRejected(label, res.status);
    if (res.status >= 500) {
      if (attempt < attempts && !opts.signal?.aborted) { await sleep(1000 + Math.random() * 1000, opts.signal); continue; }
      throw new Error(`${label} failed (HTTP ${res.status}): ${upstreamMessage(res.data, res.status)}`);
    }
    return res;
  }
}

/**
 * The JSON body of a management call. A 4xx is a failure even when the body
 * does not say success:false (so the tool result is an MCP error).
 */
async function callJson(
  label: string,
  method: string,
  path: string,
  opts: RequestOpts & { retry?: boolean } = {},
): Promise<Record<string, unknown>> {
  const res = await call(label, method, path, opts);
  if (res.status >= 400) {
    return { ...res.data, success: false, httpStatus: res.status, error: upstreamMessage(res.data, res.status) };
  }
  return res.data;
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

/** The backend's reply as-is (no duplicate copy), with the normalised fields set. */
function flattenResult(d: Record<string, unknown>, projectId?: unknown): ExecuteResult {
  const out: ExecuteResult = { ...d, success: d.success !== false };
  const message = (d.message as string | undefined) ?? (d.reply as string | undefined);
  if (message !== undefined) out.message = message;
  const videoUrl = exportedVideoUrl(d);
  if (videoUrl) out.videoUrl = videoUrl;
  if (typeof projectId === 'string' && projectId && !d.projectId && !d.project_id) out.projectId = projectId;
  return out;
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
    type: 'still_running',
    projectId,
    project_id: projectId,
    message:
      `The edit is still running on Levea after ${minutes} min (full edits with motion graphics and export can take 10-20 minutes). ` +
      `Call get_active_task with project_id "${projectId}" to follow it; once no task is active, get_project returns the finished edit.`,
    raw: { type: 'still_running', status: 'running', projectId, project_id: projectId },
  };
}

function cancelled(projectId: unknown): ExecuteResult {
  return {
    success: false,
    status: 'cancelled',
    type: 'cancelled',
    message: 'Cancelled by the client; the edit may still be running on Levea.',
    ...(typeof projectId === 'string' && projectId ? { projectId, project_id: projectId } : {}),
  };
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

/** The first progress line of an edit: names the project so a client that stops waiting can follow it. */
function editStartedMessage(projectId: unknown): string {
  return `Edit started on project_id "${String(projectId)}". It can take 10-20 minutes; if your client stops waiting, call get_active_task { project_id: "${String(projectId)}" } (never re-send the edit).`;
}

/** Progress every PROGRESS_INTERVAL_MS while a single long request is open. */
function progressTicker(onProgress: ProgressFn | undefined, line: (elapsedSec: number) => string): () => void {
  if (!onProgress) return () => undefined;
  const t0 = Date.now();
  const timer = setInterval(() => {
    try { onProgress(line(Math.round((Date.now() - t0) / 1000))); } catch { /* ignore */ }
  }, PROGRESS_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

function emit(onProgress: ProgressFn | undefined, message: string): void {
  if (!onProgress) return;
  try { onProgress(message); } catch { /* ignore consumer errors */ }
}

/** Execute autonomous_edit (or any allowed tool) — single JSON response. */
export async function execute(edit: EditRequestBody, hostSignal?: AbortSignal, onProgress?: ProgressFn): Promise<ExecuteResult> {
  apiKey(); // a missing key fails before anything starts (no "edit started" progress)
  const body = withProjectId(edit);
  // A wall-clock limit: the backend keeps a long edit's response alive with
  // keep-alive bytes, so the socket idle timeout never fires.
  const call_ = callSignal(DEFAULT_TIMEOUT_MS, hostSignal);
  emit(onProgress, editStartedMessage(body.projectId));
  const stopTicker = progressTicker(onProgress, (s) => `Still editing project_id "${String(body.projectId)}" (${s} s elapsed).`);
  try {
    const res = await call(`execute(${String(body.tool || 'autonomous_edit')})`, 'POST', '/execute', { body, signal: call_.signal });
    const d = res.data;
    if (res.status >= 400) {
      return { ...d, success: false, status: 'error', httpStatus: res.status, message: upstreamMessage(d, res.status), projectId: String(body.projectId) };
    }
    return flattenResult(d, body.projectId);
  } catch (err) {
    if (call_.timedOut()) return stillRunning(body, DEFAULT_TIMEOUT_MS);
    if (hostSignal?.aborted) return cancelled(body.projectId);
    throw err;
  } finally {
    stopTicker();
    call_.dispose();
  }
}

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
    if (signal?.aborted) { resolve(); return; }
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
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

/** "step 2 of 5 (COLOR_GRADE)" from a running direct call's progressDetail, else ''. */
function stepWhere(d: Record<string, unknown>): string {
  const pd = d.progressDetail as { stepsDone?: number; stepsTotal?: number; currentAction?: string } | undefined;
  if (!pd || !pd.stepsTotal) return '';
  return `, step ${Math.min(pd.stepsTotal, (pd.stepsDone ?? 0) + 1)} of ${pd.stepsTotal}${pd.currentAction ? ` (${pd.currentAction})` : ''}`;
}

/**
 * Long-poll a running direct call (GET /task-status/:id?wait=true blocks up to
 * 25 s server-side) until it finishes or this request's own deadline. Returns
 * the call's own full response once finished; on the deadline, the 202 body
 * with the latest live progress (resending the identical call resumes the
 * wait — it is never run twice). null when the call was not running.
 */
async function waitForDirectCall(
  tool: string,
  first: Record<string, unknown>,
  signal: AbortSignal,
  onProgress?: ProgressFn,
): Promise<{ data: Record<string, unknown>; httpStatus?: number; waitedSec: number } | null> {
  const taskId = runningTaskId(first);
  if (!taskId) return null;
  const t0 = Date.now();
  let data = first;
  const pid = first.projectId ?? first.project_id;
  const done = (d: Record<string, unknown>, httpStatus?: number) => ({ data: d, httpStatus, waitedSec: Math.round((Date.now() - t0) / 1000) });
  emit(onProgress, `${tool} is running on Levea (task ${taskId}${pid ? `, project_id "${String(pid)}"` : ''}); waiting for its result.`);
  while (!signal.aborted) {
    const pollStart = Date.now();
    let st: HttpResponse;
    try {
      st = await call(`check(${taskId})`, 'GET', `/task-status/${encodeURIComponent(taskId)}`, { params: { wait: 'true' }, signal });
    } catch {
      if (signal.aborted) break;
      await sleep(5_000, signal);
      continue;
    }
    const s = st.data as Record<string, any>;
    if (st.status >= 400) break; // unknown to this key / refused: hand back the 202 as it was
    if (s.status && s.status !== 'running') {
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
    // Still running: keep the live progress so a deadline answer says where it is.
    const { result: _r, frames: _f, mcpContent: _m, ...live } = s;
    data = { ...data, ...live, status: 'running', success: false, taskId };
    emit(onProgress, `${tool} still running (task ${taskId}, ${Math.round((Date.now() - t0) / 1000)} s${stepWhere(data)}).`);
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

/** Direct tools that only read: a 5xx / network failure is retried once. */
const READ_ONLY_DIRECT_TOOLS: ReadonlySet<string> = new Set(['search_tools', 'get_action_schema', 'search_skills', 'load_skill', 'read_skill_resource']);

/**
 * Run a universal canonical tool (search_tools, get_action_schema, execute_action,
 * execute_batch, render_preview, or any canonical action / read tool) via
 * /v1/execute without invoking the autonomous_edit planner.
 *
 * The backend echoes the whole edited scene; unless `params.include_scene === true`
 * it is dropped here (the caller gets `liveLayers` + `layerCount` and can read
 * the full scene with `get_project`) so multi-step edits do not flood the
 * calling model's context window.
 */
export async function executeDeterministicTool(
  tool: string,
  projectId: string | undefined,
  params: Record<string, unknown>,
  hostSignal?: AbortSignal,
  onProgress?: ProgressFn,
): Promise<unknown> {
  const call_ = callSignal(DEFAULT_TIMEOUT_MS, hostSignal);
  const callStart = Date.now();
  const resolvedProjectId = projectId || (typeof params?.project_id === 'string' && params.project_id.trim() ? params.project_id.trim() : undefined);
  const label = `execute(${tool})`;
  try {
    const body = {
      tool,
      params,
      ...(resolvedProjectId ? { projectId: resolvedProjectId, project_id: resolvedProjectId } : {}),
      ...(params?.scene !== undefined ? { scene: params.scene } : {}),
    };
    const retry = READ_ONLY_DIRECT_TOOLS.has(tool);
    let res = await call(label, 'POST', '/execute', { body, signal: call_.signal, retry });
    // Rate limited: the server refunded the request and ran nothing, so one
    // retry after its retryAfter (short waits only) is safe and spares the
    // agent a failed step it would otherwise resend at once.
    const waitSec = rateLimitWaitSec(res);
    if (waitSec !== null && !call_.signal.aborted) {
      emit(onProgress, `${tool} rate-limited; retrying in ${Math.round(waitSec)} s.`);
      await sleep(waitSec * 1000, call_.signal);
      res = await call(label, 'POST', '/execute', { body, signal: call_.signal, retry });
    }
    let d = res.data;
    let httpStatus = res.status;
    // A long call answers 202 { status: "running", taskId: "dc_…" } and keeps
    // running on Levea. Wait for it here instead of handing the agent a
    // "still running" it would resend in a loop: one tool call returns the
    // call's own full response.
    const waited = await waitForDirectCall(tool, { ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}), ...d }, call_.signal, onProgress);
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
      if (left > 0 && !call_.signal.aborted) {
        const job = await waitForJob(String(out.jobId), { timeoutMs: left, signal: call_.signal, onProgress });
        Object.assign(out, withExportJob(out, job));
      }
    }
    if (httpStatus >= 400) {
      out.success = false;
      out.httpStatus = httpStatus;
      if (out.error === undefined) out.error = upstreamMessage(d, httpStatus);
    }
    return out;
  } catch (err) {
    if (hostSignal?.aborted) return { success: false, status: 'cancelled', error: `Cancelled by the client; ${tool} may still have been applied.`, ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}) };
    throw err;
  } finally {
    call_.dispose();
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
  onProgress?: ProgressFn,
): Promise<ExecuteResult> {
  const editBody = withProjectId(edit);
  const body = JSON.stringify(editBody);
  const url = new URL(v1('/execute'));
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  // Everything that can throw (a missing key) runs before any timer or socket exists.
  const headers = {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'X-Levea-Client': clientHeader(),
    'Content-Length': Buffer.byteLength(body),
  };
  emit(onProgress, editStartedMessage(editBody.projectId));
  return new Promise<ExecuteResult>((resolve, reject) => {
    let settled = false;
    let final: ExecuteResult | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;
    let req: http.ClientRequest | undefined;
    // A wall-clock limit: the backend's 15 s heartbeats keep the stream busy,
    // so an idle timeout never fires during a long edit. Stopping the wait does
    // not stop the edit: it keeps running on Levea.
    const wall = setTimeout(() => finish(final ?? stillRunning(editBody, STREAM_TIMEOUT_MS)), STREAM_TIMEOUT_MS);
    const onHostAbort = () => finish(cancelled(editBody.projectId));
    function finish(result: ExecuteResult | Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(wall);
      if (grace) clearTimeout(grace);
      hostSignal?.removeEventListener('abort', onHostAbort);
      req?.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
    try {
      req = transport.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          headers,
        },
        (res) => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            res.resume();
            finish(authRejected('autonomous_edit_streaming', res.statusCode));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              const d = parseBody(Buffer.concat(chunks).toString('utf8'));
              finish({ ...d, success: false, status: 'error', httpStatus: res.statusCode, message: upstreamMessage(d, res.statusCode || 0), projectId: String(editBody.projectId) });
            });
            res.on('error', (e) => finish(e));
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
                const msg = (typeof d.message === 'string' && d.message) || (typeof d.error === 'string' && d.error) || 'The edit failed.';
                finish({ ...flattenResult(d, editBody.projectId), success: false, status: 'error', message: msg });
                return;
              }
              final = flattenResult(data as Record<string, unknown>, editBody.projectId);
              // The backend may still send its closing payload; do not wait forever.
              if (!grace) grace = setTimeout(() => finish(final as ExecuteResult), AFTER_TERMINAL_GRACE_MS);
            }
          });
          res.on('end', () => {
            // The closing payload is a bare JSON object after the last event.
            const rest = buffer.trim();
            if (rest.startsWith('{')) {
              try {
                finish(flattenResult(JSON.parse(rest) as Record<string, unknown>, editBody.projectId));
                return;
              } catch (_e) { /* not JSON: fall through */ }
            }
            finish(final ?? { success: false, message: 'Stream ended without a terminal event', status: 'incomplete', projectId: String(editBody.projectId) });
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
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
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
export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  const res = await call(`getJobStatus(${jobId})`, 'GET', `/jobs/${encodeURIComponent(jobId)}`, { signal, retry: true });
  const d = res.data;
  if (res.status === 404) {
    return { success: false, jobId, status: 'not_found', progress: 0, message: 'Job not found' };
  }
  if (res.status >= 400) {
    // A 4xx (rate limit, …) is final for this poll: 'error' ends waitForJob.
    return { success: false, jobId, status: 'error', progress: 0, message: upstreamMessage(d, res.status) };
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
}

/** Block until a job reaches a terminal state, the deadline passes, or the signal aborts. */
export async function waitForJob(
  jobId: string,
  opts: { timeoutMs?: number; pollMs?: number; signal?: AbortSignal; onProgress?: ProgressFn } = {}
): Promise<JobStatus> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const pollMs = opts.pollMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  const terminal = new Set([
    'completed', 'complete', 'succeeded', 'success',
    'failed', 'error', 'cancelled', 'canceled', 'not_found',
  ]);
  let last = await getJobStatus(jobId, opts.signal);
  while (!terminal.has(last.status.toLowerCase())) {
    emit(opts.onProgress, `job ${last.jobId}: ${last.status} (${last.progress}%)${last.message ? ` ${last.message}` : ''}`);
    if (opts.signal?.aborted) return { ...last, message: `${last.message} (stopped waiting: cancelled)` };
    if (Date.now() > deadline) {
      return { ...last, message: `${last.message} (poll timed out)` };
    }
    await sleep(pollMs, opts.signal);
    if (opts.signal?.aborted) return { ...last, message: `${last.message} (stopped waiting: cancelled)` };
    last = await getJobStatus(jobId, opts.signal);
  }
  return last;
}

/** Unauthenticated health probe. */
export async function health(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await request('GET', v1('/health'), { timeoutMs: 15_000, auth: false });
    const status = (res.data as { status?: string })?.status;
    return { ok: status === 'healthy', detail: JSON.stringify(res.data) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Caption templates  (/openclaw/v1/caption-templates)
// ───────────────────────────────────────────────────────────────────────────

export const listCaptionTemplates = (): Promise<unknown> =>
  callJson('listCaptionTemplates', 'GET', '/caption-templates', { retry: true });

export const saveCaptionTemplate = (template: Record<string, unknown>): Promise<unknown> =>
  callJson('saveCaptionTemplate', 'POST', '/caption-templates', { body: template });

export const saveCurrentCaptionTemplate = (body: Record<string, unknown>): Promise<unknown> =>
  callJson('saveCurrentCaptionTemplate', 'POST', '/caption-templates/save-current', { body });

export const applyCaptionTemplate = (body: Record<string, unknown>): Promise<unknown> =>
  callJson('applyCaptionTemplate', 'POST', '/caption-templates/apply', { body });

export const deleteCaptionTemplate = (templateId: string): Promise<unknown> =>
  callJson(`deleteCaptionTemplate(${templateId})`, 'DELETE', `/caption-templates/${encodeURIComponent(templateId)}`);

// ───────────────────────────────────────────────────────────────────────────
// Queue / task status
// ───────────────────────────────────────────────────────────────────────────

export const queueEdit = (edit: EditRequestBody): Promise<unknown> =>
  callJson('queueEdit', 'POST', '/queue-edit', { body: withProjectId(edit) });

export const getTaskStatus = (taskId: string, wait = false, signal?: AbortSignal): Promise<unknown> =>
  callJson(`getTaskStatus(${taskId})`, 'GET', `/task-status/${encodeURIComponent(taskId)}`, {
    ...(wait ? { params: { wait: 'true' } } : {}),
    signal,
    retry: true,
  });

export const getActiveTask = (projectId: string): Promise<unknown> =>
  callJson(`getActiveTask(${projectId})`, 'GET', `/projects/${encodeURIComponent(projectId)}/active-task`, { retry: true });

// ───────────────────────────────────────────────────────────────────────────
// Brand kits  (/openclaw/v1/brands/*)
// ───────────────────────────────────────────────────────────────────────────

export const listBrandKits = (): Promise<unknown> => callJson('listBrandKits', 'GET', '/brands', { retry: true });

export const getBrandKit = (id: string): Promise<unknown> =>
  callJson(`getBrandKit(${id})`, 'GET', `/brands/${encodeURIComponent(id)}`, { retry: true });

export const createBrandKit = (brand: Record<string, unknown>): Promise<unknown> =>
  callJson('createBrandKit', 'POST', '/brands', { body: brand });

export const updateBrandKit = (id: string, brand: Record<string, unknown>): Promise<unknown> =>
  callJson(`updateBrandKit(${id})`, 'PUT', `/brands/${encodeURIComponent(id)}`, { body: brand });

export const deleteBrandKit = (id: string): Promise<unknown> =>
  callJson(`deleteBrandKit(${id})`, 'DELETE', `/brands/${encodeURIComponent(id)}`);

// ───────────────────────────────────────────────────────────────────────────
// Projects  (/openclaw/v1/projects/*)
// ───────────────────────────────────────────────────────────────────────────

export const listProjects = (): Promise<unknown> => callJson('listProjects', 'GET', '/projects', { retry: true });

export const getProject = (id: string): Promise<unknown> =>
  callJson(`getProject(${id})`, 'GET', `/projects/${encodeURIComponent(id)}`, { retry: true });

export const createProject = (project: Record<string, unknown>): Promise<unknown> =>
  callJson('createProject', 'POST', '/projects', { body: project });

export const deleteProject = (id: string): Promise<unknown> =>
  callJson(`deleteProject(${id})`, 'DELETE', `/projects/${encodeURIComponent(id)}`);

// ───────────────────────────────────────────────────────────────────────────
// Assets  (/openclaw/v1/assets/*)
// ───────────────────────────────────────────────────────────────────────────

export const assetUploadUrl = (body: Record<string, unknown>): Promise<unknown> =>
  callJson('assetUploadUrl', 'POST', '/assets/upload-url', { body });

export const listAssets = (query?: Record<string, string>): Promise<unknown> =>
  callJson('listAssets', 'GET', '/assets/list', { params: query, retry: true });

export const deleteAsset = (fileName: string): Promise<unknown> =>
  callJson(`deleteAsset(${fileName})`, 'DELETE', `/assets/${encodeURIComponent(fileName)}`);

export const transcribeAsset = (body: Record<string, unknown>): Promise<unknown> =>
  callJson('transcribeAsset', 'POST', '/assets/transcribe', { body });

// ───────────────────────────────────────────────────────────────────────────
// Chat-attached files (ChatGPT `openai/fileParams`)
// ───────────────────────────────────────────────────────────────────────────

/** A file the chat host passes to a tool: a temporary download URL plus its id (and maybe name / MIME type). */
export interface HostFile {
  download_url: string;
  file_id?: string;
  mime_type?: string;
  file_name?: string;
}

export interface ImportedFile {
  url: string;
  kind: 'video' | 'audio' | 'image';
  name: string;
  mimeType?: string;
  /** true when the bytes now live in Levea storage; false = the host's own (expiring) URL is passed on as-is. */
  copied: boolean;
  note?: string;
}

const IMPORT_MAX_REDIRECTS = 5;
const IMPORT_IDLE_TIMEOUT_MS = 120_000;
/** A download without Content-Length is held in memory to learn its size (signed PUTs need it); larger ones are passed on by URL. */
const IMPORT_MAX_BUFFER_BYTES = 1024 * 1024 * 1024;

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', '3gp', 'mts', 'm2ts', 'wmv', 'flv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'weba']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff', 'svg']);

/** video / audio / image from the MIME type, else the file extension; video when nothing says otherwise. */
export function hostFileKind(mime: string | undefined, name: string | undefined): 'video' | 'audio' | 'image' {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('image/')) return 'image';
  const ext = (name || '').toLowerCase().split('?')[0].split('.').pop() || '';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'video';
}

/** Private, loopback, link-local, CGNAT and other non-public addresses (the hosted server must never fetch these). */
function isNonPublicAddress(address: string, family: number): boolean {
  if (family === 6) {
    const a = address.toLowerCase();
    if (a === '::' || a === '::1') return true;
    if (a.startsWith('::ffff:')) return isNonPublicAddress(a.slice(7), 4);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a);
  }
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

/** DNS lookup that refuses non-public addresses at connect time (no rebinding window). */
function publicOnlyLookup(hostname: string, options: any, callback: any): void {
  import('dns').then((dns) => {
    dns.lookup(hostname, { ...options, all: true }, (err: NodeJS.ErrnoException | null, addresses: any) => {
      if (err) return callback(err);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: options?.family || 4 }]) as { address: string; family: number }[];
      const bad = list.find((x) => isNonPublicAddress(x.address, x.family));
      if (bad || list.length === 0) return callback(new RequestError(`refusing to fetch ${hostname}: not a public address`, 'EADDRNOTPUBLIC'));
      if (options?.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  }, callback);
}

/** GET a public https URL (following redirects); resolves with the open response stream. */
function openDownload(rawUrl: string, signal: AbortSignal | undefined, hops = 0): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(rawUrl); } catch { reject(new RequestError('download_url is not a valid URL', 'EINVALIDURL')); return; }
    if (u.protocol !== 'https:') { reject(new RequestError('download_url must be https', 'EINVALIDURL')); return; }
    // An IP-literal host skips DNS (and so publicOnlyLookup): check it here.
    const literal = u.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(literal);
    if (family && isNonPublicAddress(literal, family)) {
      reject(new RequestError(`refusing to fetch ${u.hostname}: not a public address`, 'EADDRNOTPUBLIC'));
      return;
    }
    if (signal?.aborted) { reject(new RequestError('The request was aborted', 'ABORT_ERR')); return; }
    const req = https.get(u, { lookup: publicOnlyLookup as any, headers: { Accept: '*/*', 'User-Agent': clientHeader() } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hops >= IMPORT_MAX_REDIRECTS) { reject(new RequestError('too many redirects', 'EREDIRECT')); return; }
        openDownload(new URL(res.headers.location, u).toString(), signal, hops + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { res.resume(); reject(new RequestError(`download failed: HTTP ${status}`, 'EDOWNLOAD')); return; }
      resolve(res);
    });
    req.setTimeout(IMPORT_IDLE_TIMEOUT_MS, () => req.destroy(new RequestError('download timed out', 'ETIMEDOUT')));
    req.on('error', reject);
    signal?.addEventListener('abort', () => req.destroy(new RequestError('The request was aborted', 'ABORT_ERR')), { once: true });
  });
}

function readAll(res: http.IncomingMessage, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    res.on('data', (c: Buffer) => {
      n += c.length;
      if (n > cap) { res.destroy(new RequestError('file too large to buffer', 'ETOOLARGE')); return; }
      chunks.push(c);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

/** PUT a body (stream or buffer) to a signed upload URL with the exact headers it was signed for. */
function putSigned(uploadUrl: string, headers: Record<string, string>, body: http.IncomingMessage | Buffer, size: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new URL(uploadUrl);
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.request(u, { method: 'PUT', headers: { ...headers, 'Content-Length': String(size) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const status = res.statusCode || 0;
        if (status >= 200 && status < 300) resolve();
        else reject(new RequestError(`upload failed: HTTP ${status} ${Buffer.concat(chunks).toString('utf8').slice(0, 300)}`, 'EUPLOAD'));
      });
      res.on('error', reject);
    });
    req.setTimeout(IMPORT_IDLE_TIMEOUT_MS, () => req.destroy(new RequestError('upload timed out', 'ETIMEDOUT')));
    req.on('error', reject);
    signal?.addEventListener('abort', () => req.destroy(new RequestError('The request was aborted', 'ABORT_ERR')), { once: true });
    if (Buffer.isBuffer(body)) req.end(body);
    else {
      body.on('error', (e) => req.destroy(e));
      body.pipe(req);
    }
  });
}

function fileNameFor(f: HostFile, kind: string, mime: string | undefined): string {
  const given = (f.file_name || '').trim();
  if (given) return given;
  const sub = (mime || '').split('/')[1]?.split(';')[0];
  const ext = sub && /^[a-z0-9.+-]{1,12}$/i.test(sub) ? sub.replace('quicktime', 'mov') : (kind === 'image' ? 'png' : kind === 'audio' ? 'mp3' : 'mp4');
  return `${kind}-${(f.file_id || randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(-24)}.${ext}`;
}

/**
 * Copy a chat-attached file (ChatGPT passes { download_url, file_id }) into the
 * user's Levea asset storage, so the edit reads a stable URL instead of a
 * short-lived host link. Never throws: if the copy cannot be made, the host's
 * own URL is passed on (the backend fetches public URLs itself) with a note.
 */
export async function importHostFile(f: HostFile, signal?: AbortSignal): Promise<ImportedFile> {
  const declaredMime = typeof f.mime_type === 'string' && f.mime_type.trim() ? f.mime_type.trim() : undefined;
  const fallbackKind = hostFileKind(declaredMime, f.file_name);
  const passOn = (note: string): ImportedFile => ({
    url: f.download_url,
    kind: fallbackKind,
    name: fileNameFor(f, fallbackKind, declaredMime),
    ...(declaredMime ? { mimeType: declaredMime } : {}),
    copied: false,
    note,
  });
  let res: http.IncomingMessage;
  try {
    res = await openDownload(f.download_url, signal);
  } catch (err) {
    if ((err as RequestError)?.code === 'ABORT_ERR') throw err;
    // A non-public / non-https URL is never passed on either: the backend must not be pointed at it.
    if ((err as RequestError)?.code === 'EADDRNOTPUBLIC' || (err as RequestError)?.code === 'EINVALIDURL') {
      throw new Error(`The attached file's download_url was refused (${(err as Error).message}).`);
    }
    return passOn(`could not download the file to copy it (${(err as Error).message}); passing the original link`);
  }
  const headerMime = String(res.headers['content-type'] || '').split(';')[0].trim();
  const mime = declaredMime || (headerMime && headerMime !== 'application/octet-stream' ? headerMime : undefined);
  const kind = hostFileKind(mime, f.file_name);
  const name = fileNameFor(f, kind, mime);
  try {
    let body: http.IncomingMessage | Buffer = res;
    let size = Number(res.headers['content-length']);
    if (!Number.isSafeInteger(size) || size <= 0 || res.headers['content-encoding']) {
      body = await readAll(res, IMPORT_MAX_BUFFER_BYTES);
      size = body.length;
    }
    const contentType = mime || (kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
    const signed = await assetUploadUrl({ fileName: name, fileType: kind, contentType, fileSize: size }) as Record<string, unknown>;
    const uploadUrl = typeof signed.uploadUrl === 'string' ? signed.uploadUrl : (typeof signed.signedUrl === 'string' ? signed.signedUrl : '');
    const fileUrl = typeof signed.fileUrl === 'string' ? signed.fileUrl : (typeof signed.publicUrl === 'string' ? signed.publicUrl : '');
    if (signed.success === false || !uploadUrl || !fileUrl || (signed.uploadType && signed.uploadType !== 'signed_put')) {
      if (!Buffer.isBuffer(body)) res.destroy();
      return passOn(`Levea storage did not return a signed upload (${String(signed.error || signed.uploadType || 'no url')}); passing the original link`);
    }
    const required = (signed.requiredHeaders && typeof signed.requiredHeaders === 'object' ? signed.requiredHeaders : {}) as Record<string, string>;
    const headers: Record<string, string> = { 'Content-Type': contentType };
    for (const [k, v] of Object.entries(required)) if (k.toLowerCase() !== 'content-length') headers[k] = String(v);
    await putSigned(uploadUrl, headers, body, size, signal);
    return { url: fileUrl, kind, name, mimeType: contentType, copied: true };
  } catch (err) {
    res.destroy();
    if ((err as RequestError)?.code === 'ABORT_ERR') throw err;
    return passOn(`copying the file into Levea failed (${(err as Error).message}); passing the original link`);
  }
}
