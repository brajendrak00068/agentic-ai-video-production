"""Levea Agentic Video Editor — Hermes plugin.

Python port of the OpenClaw plugin (../index.ts).
Editing stays a single high-level tool: the Levea backend owns planning,
execution, verification, and export. The queue and polling tools expose
durable backend state; none of them mutate scenes directly.

Network: every call goes to the Levea API (default https://api.livecore.ai,
override with LEVEA_API_URL) with the user's LEVEA_API_KEY. No telemetry.
"""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import random
import socket
import tempfile
import time
import uuid
import base64 as _b64
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional, Tuple

PLUGIN_VERSION = "1.1.6"
TOOLSET = "levea_video_editor"
DEFAULT_API_URL = "https://api.livecore.ai"
def _env_seconds(name: str, fallback: float) -> float:
    try:
        value = float(os.environ.get(name, "")) / 1000.0
        return value if value > 0 else fallback
    except ValueError:
        return fallback


# How long one call waits in total (LEVEA_REQUEST_TIMEOUT_MS; default 10 min). A
# wall-clock deadline: the backend keeps a long edit's response alive with
# keep-alive bytes, so a socket timeout alone would never fire.
REQUEST_TIMEOUT_SEC = _env_seconds("LEVEA_REQUEST_TIMEOUT_MS", 600.0)
# Longest silence tolerated on the socket (the backend writes every ~15 s).
SOCKET_READ_TIMEOUT_SEC = 60
POLL_INTERVAL_SEC = 4
# Longest server-requested 429 wait (Retry-After) the plugin sits through before one retry.
RATE_LIMIT_MAX_WAIT_SEC = 65
# Time left unspent at the end of a direct call's deadline when it waits for its export job.
EXPORT_WAIT_MARGIN_SEC = 10
EXPORT_JOB_PENDING = {"running", "queued", "processing", "pending", "rendering"}
# Image payload keys a render answer carries (~50 KB of base64 per frame); never sent to the model as text.
IMAGE_DATA_KEYS = {"base64", "dataUrl", "frameImages", "mcpContent"}
KEY_PORTAL_URL = "https://livecore.ai/?utm_source=hermes-plugin"

TERMINAL_JOB_STATES = {
    "completed", "complete", "succeeded", "success",
    "failed", "failure", "error", "errored",
    "cancelled", "canceled", "timeout", "timed_out", "not_found",
}
FAILED_JOB_STATES = {
    "failed", "failure", "error", "errored",
    "cancelled", "canceled", "timeout", "timed_out", "not_found",
}
PENDING_TOOL_STATES = {
    "pending", "waiting", "queued", "processing", "rendering", "planning",
    "executing", "dispatch", "running", "verifying", "awaiting_approval", "awaiting_input",
}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _secret(name: str) -> Optional[str]:
    """Hermes' profile secret scope first, then the process environment.

    Older Hermes builds (and plain Python imports) have no ``agent.secret_scope``.
    """
    value: Any = None
    try:
        from agent.secret_scope import get_secret  # type: ignore[import-not-found]
    except ImportError:
        get_secret = None
    if get_secret is not None:
        try:
            value = get_secret(name)
        except Exception:  # a broken secret store must not hide the env value
            value = None
    if isinstance(value, str) and value.strip():
        return value.strip()
    value = os.environ.get(name)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _first_string(*values: Any) -> Optional[str]:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_host(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    if not raw:
        return DEFAULT_API_URL
    for marketing_host in ("https://livecore.ai", "https://www.livecore.ai",
                           "http://livecore.ai", "http://www.livecore.ai"):
        if raw == marketing_host:
            return DEFAULT_API_URL
        if raw.startswith(marketing_host + "/"):
            return DEFAULT_API_URL + raw[len(marketing_host):]
    return raw


def _v1_root() -> str:
    raw = _normalize_host(_secret("LEVEA_API_URL") or DEFAULT_API_URL)
    if raw.endswith("/api/v1/misc/openclaw/v1/execute"):
        return raw[: -len("/execute")]
    if raw.endswith("/api/v1/misc/openclaw/v1"):
        return raw
    if raw.endswith("/api/v1/misc/openclaw"):
        return raw + "/v1"
    if raw.endswith("/api/v1/misc"):
        return raw + "/openclaw/v1"
    return raw + "/api/v1/misc/openclaw/v1"


# ---------------------------------------------------------------------------
# Backend contract
# ---------------------------------------------------------------------------

def _contract_failure(message: str, payload: Any, http_status: Optional[int] = None,
                      extra: Optional[dict] = None) -> dict:
    base = dict(payload) if isinstance(payload, dict) else {}
    base.update(extra or {})
    base.update({
        "success": False,
        "message": message,
        "code": "BACKEND_CONTRACT_ERROR",
        "contractError": True,
        "backendPayload": payload,
    })
    if http_status is not None:
        base["httpStatus"] = http_status
    return base


def normalize_backend_response(http_status: int, payload: Any, *, label: str,
                               require_message: bool = False,
                               require_verification: bool = False,
                               fallback_project_id: Optional[str] = None,
                               accept_active_contract: bool = False) -> dict:
    """Validate rather than infer the backend outcome from HTTP 200."""
    fallback = _first_string(fallback_project_id)
    if not isinstance(payload, dict):
        extra = {"projectId": fallback, "project_id": fallback} if fallback else {}
        return _contract_failure(
            f"{label} returned a malformed non-object response (HTTP {http_status}).",
            payload, http_status, extra)

    data = payload
    project_id = _first_string(data.get("projectId"), data.get("project_id"), fallback)
    project_fields = {"projectId": project_id, "project_id": project_id} if project_id else {}
    upstream_message = _first_string(data.get("message"), data.get("reply"), data.get("error"))

    if http_status < 200 or http_status >= 300:
        out = {**data, **project_fields, "success": False, "httpStatus": http_status}
        out["message"] = upstream_message or f"{label} failed with HTTP {http_status}."
        if http_status in (401, 403):
            out.setdefault("code", "AUTH_FAILED")
            if not upstream_message:
                out["message"] = f"Authentication failed. Check LEVEA_API_KEY or create a new key at {KEY_PORTAL_URL}"
        return out

    # The active-task endpoint signals its outcome with a typed `active` boolean.
    has_active_contract = accept_active_contract and isinstance(data.get("active"), bool)
    if not isinstance(data.get("success"), bool) and not has_active_contract:
        return _contract_failure(
            f"{label} returned HTTP {http_status} without an explicit success outcome.",
            payload, http_status, project_fields)

    explicit_success = True if has_active_contract else data.get("success") is True
    if explicit_success and data.get("partial") is True:
        return _contract_failure(
            f"{label} returned contradictory success and partial outcomes.",
            payload, http_status, project_fields)
    if explicit_success and require_verification and data.get("verificationPassed") is not True:
        return _contract_failure(
            f"{label} returned success without authoritative verification.",
            payload, http_status, project_fields)

    message = upstream_message
    if not message and require_message:
        return _contract_failure(
            f"{label} returned success without a human-readable outcome.",
            payload, http_status, project_fields)
    if not message:
        if has_active_contract:
            message = (f"{label}: active task {data.get('taskId', '')} is {data.get('status') or 'running'}."
                       if data.get("active") else f"{label}: no active task.")
        else:
            message = f"{label}: {data.get('status') or ('accepted' if explicit_success else 'failed')}."

    return {**data, **project_fields, "success": explicit_success, "message": message,
            "httpStatus": http_status}


class _TransportError(Exception):
    """A request that produced no HTTP answer. kind: timeout | unreachable | missing_key | error."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


def _missing_key_message() -> str:
    return (f"LEVEA_API_KEY is required. Generate a key at {KEY_PORTAL_URL} "
            "and add it with `hermes config set LEVEA_API_KEY <key>` (or export LEVEA_API_KEY).")


def _send(method: str, path: str, body: Optional[dict], *, deadline: float,
          query: Optional[dict] = None) -> Tuple[int, Any, Any]:
    """One HTTP exchange: (status, parsed payload, headers). Raises _TransportError."""
    api_key = _secret("LEVEA_API_KEY")
    if not api_key:
        raise _TransportError("missing_key", _missing_key_message())
    url = _v1_root() + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Levea-Client": f"hermes-plugin/{PLUGIN_VERSION}",
    })
    left = deadline - time.monotonic()
    if left <= 0:
        raise _TransportError("timeout", "No time left before the request deadline.")
    try:
        with urllib.request.urlopen(request, timeout=min(SOCKET_READ_TIMEOUT_SEC, max(1.0, left))) as response:
            status, headers = response.status, response.headers
            chunks = []
            while True:
                chunk = response.read1(65536)
                if not chunk:
                    break
                chunks.append(chunk)
                # A wall-clock deadline: keep-alive bytes on a long edit never trip the socket timeout.
                if time.monotonic() > deadline:
                    raise _TransportError("timeout", "The request deadline passed while the response was streaming.")
            raw = b"".join(chunks)
    except _TransportError:
        raise
    except urllib.error.HTTPError as error:
        status, headers = error.code, error.headers
        try:
            raw = error.read()
        except Exception:
            raw = b""
    except (TimeoutError, socket.timeout) as error:
        raise _TransportError("timeout", str(error) or "timed out")
    except urllib.error.URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise _TransportError("timeout", str(error.reason) or "timed out")
        raise _TransportError("unreachable", f"Cannot reach the editor backend: {error.reason}")
    except (ConnectionError, http.client.HTTPException, OSError) as error:
        raise _TransportError("unreachable", f"Connection to the editor backend failed: {error}")
    except Exception as error:  # handlers must never raise
        raise _TransportError("error", str(error) or "Unknown editor transport error.")

    try:
        payload: Any = json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = raw.decode("utf-8", errors="replace")[:2000]
    return status, payload, headers


def _retry_after_sec(status: int, payload: Any, headers: Any) -> Optional[float]:
    """Seconds a 429 asks to wait (body retryAfter, else Retry-After header); None = do not retry."""
    if status != 429:
        return None
    wait: Optional[float] = None
    for raw in ((payload or {}).get("retryAfter") if isinstance(payload, dict) else None,
                headers.get("Retry-After") if headers is not None else None):
        try:
            value = float(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if value >= 0:
            wait = value
            break
    if wait is None or wait > RATE_LIMIT_MAX_WAIT_SEC:
        return None
    return max(1.0, wait) + random.random()


def _sleep_within(seconds: float, deadline: float) -> bool:
    """Sleep up to ``seconds`` without passing ``deadline``; False when no time is left."""
    left = deadline - time.monotonic()
    if left <= 0.5:
        return False
    time.sleep(max(0.0, min(seconds, left - 0.5)))
    return True


def _send_with_retry(method: str, path: str, body: Optional[dict], *, deadline: float,
                     query: Optional[dict] = None, retries: int = 0) -> Tuple[int, Any, Any]:
    """_send plus up to ``retries`` retries on 429 / 5xx / network errors.

    Only read-only GETs pass retries > 0: a mutating POST is never resent automatically.
    """
    attempt = 0
    while True:
        backoff = 2.0 * (attempt + 1) + random.random()
        try:
            status, payload, headers = _send(method, path, body, deadline=deadline, query=query)
        except _TransportError as error:
            if (error.kind in ("missing_key", "error") or attempt >= retries
                    or not _sleep_within(backoff, deadline)):
                raise
            attempt += 1
            continue
        if attempt < retries and (status == 429 or status >= 500):
            wait = _retry_after_sec(status, payload, headers) if status == 429 else backoff
            if wait is not None and time.monotonic() + wait < deadline and _sleep_within(wait, deadline):
                attempt += 1
                continue
        return status, payload, headers


def _edit_still_running(project_fields: dict) -> dict:
    return {**project_fields, "success": False, "code": "STILL_RUNNING", "status": "running",
            "message": "The edit is still running on Levea (full edits with motion graphics and "
                       "export can take 10-20 minutes). Call levea_active_task with this project_id "
                       "to see whether it is still active (it reports the current state; call it again "
                       "every minute or so). Do not run the edit again."}


def _status_timeout(label: str, project_fields: dict) -> dict:
    return {**project_fields, "success": False, "code": "STATUS_TIMEOUT", "status": "running",
            "message": f"{label}: Levea did not answer the status request in time. The task itself is "
                       "unaffected; call the same status tool again."}


def _transport_failure(error: _TransportError, project_fields: dict) -> dict:
    code = {"missing_key": "MISSING_API_KEY", "unreachable": "BACKEND_UNREACHABLE"}.get(error.kind, "TRANSPORT_ERROR")
    return {**project_fields, "success": False, "code": code, "message": error.message}


def _call_backend(method: str, path: str, body: Optional[dict], *, label: str,
                  require_message: bool = False, require_verification: bool = False,
                  fallback_project_id: Optional[str] = None,
                  accept_active_contract: bool = False,
                  query: Optional[dict] = None, retries: int = 0,
                  deadline: Optional[float] = None,
                  timeout_result: Optional[dict] = None) -> dict:
    project_fields = ({"projectId": fallback_project_id, "project_id": fallback_project_id}
                      if fallback_project_id else {})
    if deadline is None:
        deadline = time.monotonic() + REQUEST_TIMEOUT_SEC
    try:
        status, payload, _ = _send_with_retry(method, path, body, deadline=deadline,
                                              query=query, retries=retries)
    except _TransportError as error:
        if error.kind == "timeout":
            return timeout_result if timeout_result is not None else _status_timeout(label, project_fields)
        return _transport_failure(error, project_fields)
    return normalize_backend_response(
        status, payload, label=label, require_message=require_message,
        require_verification=require_verification, fallback_project_id=fallback_project_id,
        accept_active_contract=accept_active_contract)


def _is_transient(result: dict) -> bool:
    """A poll answer that says nothing about the job (rate limit, 5xx, network): keep polling."""
    status = result.get("httpStatus")
    if isinstance(status, int) and (status == 429 or status >= 500):
        return True
    return result.get("code") in ("BACKEND_UNREACHABLE", "STATUS_TIMEOUT", "TRANSPORT_ERROR")


def _poll(path: str, label: str, *, fallback_project_id: Optional[str] = None,
          accept_active_contract: bool = False, query: Optional[dict] = None,
          deadline: Optional[float] = None) -> dict:
    """One read-only status GET (retried once on 429 / 5xx / network errors)."""
    result = _call_backend("GET", path, None, label=label,
                           fallback_project_id=fallback_project_id,
                           accept_active_contract=accept_active_contract,
                           query=query, retries=1, deadline=deadline)
    status = str(result.get("status") or "").lower()
    if result.get("success") is True and status in FAILED_JOB_STATES:
        result = {**result, "success": False,
                  "message": _first_string(result.get("error"), result.get("message")) or f"{label}: {status}."}
    return result


def _wait_for_job(job_id: str, deadline: float) -> dict:
    """Poll an export / async job until a terminal state or ``deadline``.

    A transient answer (429, 5xx, network error) never ends the wait; a 4xx
    (unknown job, revoked key) does.
    """
    path = "/jobs/" + urllib.parse.quote(job_id, safe="")
    label = f"job {job_id}"
    last_good: Optional[dict] = None
    result = _poll(path, label, deadline=deadline)
    transient_streak = 0
    while True:
        if _is_transient(result):
            transient_streak += 1
            wait = min(30.0, POLL_INTERVAL_SEC * (2 ** min(transient_streak, 3)))
        else:
            transient_streak = 0
            last_good = result
            if not result.get("success") or str(result.get("status") or "").lower() in TERMINAL_JOB_STATES:
                return result
            wait = POLL_INTERVAL_SEC
        if not _sleep_within(wait, deadline):
            base = last_good or result
            return {**base, "success": False, "code": "POLL_TIMEOUT", "status": base.get("status") or "running",
                    "message": f"Job {job_id} is still {base.get('status') or 'running'} after the wait limit. "
                               f"Call levea_job_status with job_id {job_id} and wait=true to keep waiting."}
        result = _poll(path, label, deadline=deadline)


def _running_task_id(d: Any) -> Optional[str]:
    """The task id of a direct call the backend answered "still running" (HTTP 202), else None.

    Only the direct call's own 202 names one (callId == taskId, or pollWith.task_id ==
    taskId); an export still rendering also says "running" but with its job id.
    """
    if not isinstance(d, dict) or d.get("status") != "running":
        return None
    task_id = d.get("taskId") if d.get("taskId") is not None else d.get("task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        return None
    task_id = task_id.strip()
    call_id = d.get("callId").strip() if isinstance(d.get("callId"), str) else ""
    poll_with = d.get("pollWith") if isinstance(d.get("pollWith"), dict) else {}
    poll_id = poll_with.get("task_id").strip() if isinstance(poll_with.get("task_id"), str) else ""
    return task_id if task_id in (call_id, poll_id) else None


def _wait_for_direct_call(first: Any, deadline: float) -> Optional[Tuple[dict, int, bool]]:
    """Long-poll a running direct call (GET /task-status/:id?wait=true, ~25 s per request).

    Returns (data, waited seconds, finished) or None when the call was not running.
    finished=True: data is the call's own full response. False: the 202 body with the
    latest live progress (resending the identical call resumes the wait; it never runs twice).
    """
    task_id = _running_task_id(first)
    if not task_id:
        return None
    t0 = time.monotonic()
    data = dict(first)
    path = "/task-status/" + urllib.parse.quote(task_id, safe="")

    def waited() -> int:
        return int(round(time.monotonic() - t0))

    while time.monotonic() < deadline:
        poll_start = time.monotonic()
        try:
            status, s, headers = _send("GET", path, None, deadline=deadline, query={"wait": "true"})
        except _TransportError as error:
            if error.kind in ("missing_key", "error") or not _sleep_within(5.0, deadline):
                break
            continue
        if status == 429 or status >= 500:
            if not _sleep_within(_retry_after_sec(status, s, headers) or 5.0, deadline):
                break
            continue
        if status >= 400:
            break  # unknown to this key / refused: hand back the 202 as it was
        s = s if isinstance(s, dict) else {}
        if s.get("status") and s.get("status") != "running":
            result = s.get("result")
            if isinstance(result, dict):
                out = dict(result)
                if s.get("failureCode") and not out.get("failureCode"):
                    out["failureCode"] = s["failureCode"]
                return out, waited(), True
            out = {"success": s.get("status") == "completed", "status": s.get("status"), "taskId": task_id,
                   "message": s.get("message")}
            for key in ("result", "failureCode", "error"):
                if s.get(key) not in (None, ""):
                    out[key] = s[key]
            return out, waited(), True
        live = {k: v for k, v in s.items() if k not in ("result", "frames", "mcpContent")}
        data = {**data, **live, "status": "running", "success": False, "taskId": task_id}
        if time.monotonic() - poll_start < 3:  # an older server answered at once: back off
            try:
                hint = float(data.get("retryAfterSec") or 5)
            except (TypeError, ValueError):
                hint = 5.0
            if not _sleep_within(min(15.0, max(3.0, hint)), deadline):
                break
    return data, waited(), False


def _export_still_rendering(r: dict) -> bool:
    """A direct reply whose EXPORT_VIDEO step queued a job still rendering."""
    if r.get("jobId") is None or str(r.get("jobId")).strip() == "":
        return False
    if isinstance(r.get("videoUrl"), str) and r.get("videoUrl"):
        return False
    if str(r.get("status") or "").lower() not in EXPORT_JOB_PENDING:
        return False
    receipts = r.get("stepReceipts") if isinstance(r.get("stepReceipts"), list) else []
    return r.get("action") == "EXPORT_VIDEO" or any(
        isinstance(s, dict) and s.get("action") == "EXPORT_VIDEO" for s in receipts)


def _with_export_job(reply: dict, job: dict) -> dict:
    """Fields a finished (or still rendering) export job adds to the reply that queued it.

    The reply's own polish / deliverableWarnings / verificationReport / stepReceipts win.
    """
    status = str(job.get("status") or "").lower()
    finished = status in ("completed", "complete", "succeeded", "success")
    record = {k: v for k, v in job.items()
              if k not in ("polish", "deliverableWarnings", "exportCallSteps", "verificationReport",
                           "deliverySampledDecode", "projectId", "project_id")}
    out: dict = {"status": job.get("status"), "exportJob": record}
    for key in ("videoUrl", "exportUrl", "export_url", "downloadUrl"):
        if isinstance(job.get(key), str) and job[key].startswith("http"):
            out["videoUrl"] = job[key]
            break
    if job.get("success") is False or status in FAILED_JOB_STATES:
        out["exportError"] = _first_string(job.get("error"), job.get("message")) or status
        out["success"] = False
    elif finished:
        out["success"] = True
    for key in ("polish", "deliverableWarnings", "verificationReport"):
        if reply.get(key) is None and job.get(key) is not None:
            out[key] = job[key]
    if reply.get("stepReceipts") is None and job.get("exportCallSteps") is not None:
        out["exportCallSteps"] = job["exportCallSteps"]
    if job.get("deliverySampledDecode") is not None:
        out["deliverySampledDecode"] = job["deliverySampledDecode"]
    if not finished and (status in EXPORT_JOB_PENDING or job.get("code") == "POLL_TIMEOUT"):
        out["status"] = "rendering"
        out["exportHint"] = (f"The export is still rendering; call levea_job_status with job_id "
                             f"{reply.get('jobId')} and wait=true to get the video.")
        out["message"] = out["exportHint"]
    return out


def _frame_dir() -> Path:
    path = Path(tempfile.gettempdir()) / "levea-hermes-frames"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _save_frame(frame: dict) -> Optional[str]:
    """Write a frame's base64 JPEG to a local file (deduplicated by content); its path, or None."""
    raw = frame.get("base64")
    if not isinstance(raw, str) or not raw:
        data_url = frame.get("dataUrl")
        raw = data_url.split(",", 1)[1] if isinstance(data_url, str) and "," in data_url else None
    if not raw:
        return None
    try:
        blob = _b64.b64decode(raw, validate=False)
        ext = "png" if str(frame.get("mimeType") or "").endswith("png") else "jpg"
        target = _frame_dir() / f"frame-{hashlib.sha1(blob).hexdigest()[:16]}.{ext}"
        if not target.exists():
            target.write_bytes(blob)
        return str(target)
    except Exception:
        return None


def _strip_image_data(value: Any, depth: int = 0) -> Any:
    """Drop base64 / dataUrl / frameImages / mcpContent; frames keep their metadata, URL, and a local file path.

    Hermes plugin tools return text only, so ~50 KB of base64 per frame would go straight
    into the model's context. Each frame is written to a local JPEG instead (open it with
    an image-capable tool); any frame URL the backend returns is kept as-is.
    """
    if depth > 6 or not isinstance(value, (dict, list)):
        return value
    if isinstance(value, list):
        return [_strip_image_data(v, depth + 1) for v in value]
    out: dict = {}
    has_image = any(k in value for k in ("base64", "dataUrl"))
    for key, item in value.items():
        if key in IMAGE_DATA_KEYS:
            continue
        out[key] = _strip_image_data(item, depth + 1)
    if has_image:
        path = _save_frame(value)
        if path:
            out["path"] = path
    return out


def _frame_summary(result: dict) -> None:
    """Add a top-level list of the rendered frames (timestamp, url, path) to a stripped result."""
    frames = result.get("frames") if isinstance(result.get("frames"), list) else None
    if not frames:
        return
    listed = []
    for frame in frames:
        if not isinstance(frame, dict):
            continue
        entry = {k: frame[k] for k in ("index", "timestamp", "url", "frameUrl", "imageUrl", "path") if frame.get(k) is not None}
        listed.append(entry)
    result.pop("screenshots", None)  # the same frames again
    result["frames"] = listed
    result["framesNote"] = (f"{len(listed)} frame(s) rendered. Image data is not inlined; each frame is a local "
                            "JPEG at frames[].path (and a URL where Levea returns one) for an image-capable tool.")


def _to_tool_result(result: dict) -> str:
    """Return the full backend object with a normalized status; never reconstruct state from text."""
    backend_status = _first_string(result.get("status"))
    lowered = (backend_status or "").lower()
    pending = result.get("partial") is not True and lowered in PENDING_TOOL_STATES
    failed = not pending and (result.get("success") is not True or result.get("partial") is True
                               or lowered in FAILED_JOB_STATES)
    if failed:
        normalized = "partial" if result.get("partial") is True else "error"
    elif pending:
        normalized = "pending"
    else:
        normalized = backend_status or "completed"
    out = dict(result)
    # Hermes marks any result carrying an ``error`` key (even null) plus a ``message`` as a
    # failed call (agent/display.py _detect_tool_failure), so a successful export showed ✗.
    if not failed and not out.get("error"):
        out.pop("error", None)
    if backend_status and backend_status != normalized:
        out["backendStatus"] = backend_status
    out["status"] = normalized
    return json.dumps(out, default=str)


# ---------------------------------------------------------------------------
# Tool handlers (accept (args, **kwargs), always return a JSON string)
# ---------------------------------------------------------------------------

# Edit request fields come from edit_contract.json, a synced copy of the repo's
# single source of truth (contract/edit-contract.json). Both the tool schemas
# and the backend bodies loop over its fields, so no field can be dropped.
_CONTRACT = json.loads((Path(__file__).parent / "edit_contract.json").read_text(encoding="utf-8"))


def _contract_fields(surface: str) -> list:
    return [f for f in _CONTRACT["fields"] if surface in f["surfaces"]]


def _edit_schema(surface: str, required: Optional[list] = None) -> dict:
    fields = _contract_fields(surface)
    names = {f["name"] for f in fields}
    return {
        "type": "object",
        "properties": {f["name"]: f["schema"] for f in fields},
        "required": required or [n for n in _CONTRACT["required"] if n in names],
        "additionalProperties": False,
    }


def _bool(value: Any) -> Optional[bool]:
    """A real boolean or its string spelling; anything else is None (omit).

    bool("false") is True, so never coerce with bool() (mirrors contract/editContract.ts).
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes"):
            return True
        if lowered in ("false", "0", "no"):
            return False
    return None


def _normalize(field: dict, value: Any) -> Any:
    if value is None:
        return None
    kind = field["schema"].get("type")
    if kind == "string":
        return None if isinstance(value, str) and not value.strip() else str(value)
    if kind == "boolean":
        return _bool(value)
    if kind == "array":
        return value if isinstance(value, list) and value else None
    return value


def _build_edit_body(args: dict, surface: str) -> dict:
    params: dict = {}
    body: dict = {"tool": "autonomous_edit", "params": params}
    for field in _contract_fields(surface):
        value = _normalize(field, args.get(field["name"]))
        if value is None:
            continue
        if field["placement"] == "param":
            params[field["name"]] = value
        elif field["placement"] == "project":
            body["projectId"] = value
            body["project_id"] = value
        else:
            body[field["name"]] = value
    return body


def handle_video_edit(args: dict, **kwargs) -> str:
    try:
        args = args or {}
        prompt = _first_string(args.get("prompt"))
        if not prompt:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_PROMPT",
                               "message": "Missing required parameter: prompt."})
        # A first call without project_id gets one here, before the request, so an
        # edit that outlives the wait can be found (levea_active_task) and a retry
        # continues the same project instead of starting a second one.
        project_id = _first_string(args.get("project_id")) or f"hermes_{uuid.uuid4()}"
        body = _build_edit_body({**args, "prompt": prompt, "project_id": project_id}, "all")
        # A mutating POST: never retried automatically (retries=0).
        return _to_tool_result(_call_backend(
            "POST", "/execute", body, label="autonomous_edit", require_message=True,
            require_verification=True, fallback_project_id=project_id,
            timeout_result=_edit_still_running({"projectId": project_id, "project_id": project_id})))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_queue_edit(args: dict, **kwargs) -> str:
    try:
        args = args or {}
        prompt = _first_string(args.get("prompt"))
        project_id = _first_string(args.get("project_id"))
        if not prompt:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_PROMPT",
                               "message": "Missing required parameter: prompt."})
        if not project_id:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_PROJECT_ID",
                               "message": "levea_queue_edit requires a stable project_id so the queued "
                                          "edit cannot attach to a shared default project."})
        body = _build_edit_body({**args, "prompt": prompt, "project_id": project_id}, "queue")
        project_fields = {"projectId": project_id, "project_id": project_id}
        return _to_tool_result(_call_backend(
            "POST", "/queue-edit", body, label="queue_edit", require_message=True,
            fallback_project_id=project_id,
            timeout_result={**project_fields, "success": False, "code": "QUEUE_TIMEOUT", "status": "error",
                            "message": "Levea did not confirm the queued edit in time; it may have been queued. "
                                       "Call levea_active_task with this project_id before queueing it again."}))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_job_status(args: dict, **kwargs) -> str:
    try:
        args = args or {}
        job_id = _first_string(str(args.get("job_id") or ""))
        if not job_id:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_JOB_ID",
                               "message": "Missing required parameter: job_id."})
        deadline = time.monotonic() + REQUEST_TIMEOUT_SEC
        if _bool(args.get("wait")) is True:
            # Bounded by REQUEST_TIMEOUT_SEC; a 429 / 5xx / network blip keeps polling.
            return _to_tool_result(_wait_for_job(job_id, deadline))
        return _to_tool_result(_poll("/jobs/" + urllib.parse.quote(job_id, safe=""), f"job {job_id}",
                                     deadline=deadline))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_task_status(args: dict, **kwargs) -> str:
    try:
        task_id = _first_string(str((args or {}).get("task_id") or ""))
        if not task_id:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_TASK_ID",
                               "message": "Missing required parameter: task_id."})
        # wait=true long-polls server-side (~25 s) for a direct call ("dc_…") still running;
        # a backend that does not long-poll a queued task answers at once.
        label = f"task {task_id}"
        result = _poll("/task-status/" + urllib.parse.quote(task_id, safe=""), label, query={"wait": "true"})
        if result.get("success") is True and str(result.get("status") or "").lower() == "running":
            result = {**result, "message": f"{label} is still running on Levea (nothing lost, never run twice). "
                                           f"Call levea_task_status with task_id {task_id} again to keep waiting."}
        return _to_tool_result(result)
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_active_task(args: dict, **kwargs) -> str:
    try:
        project_id = _first_string((args or {}).get("project_id"))
        if not project_id:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_PROJECT_ID",
                               "message": "Missing required parameter: project_id."})
        # One read (the active-task endpoint does not long-poll); retried once on 429 / 5xx.
        return _to_tool_result(_poll(
            f"/projects/{urllib.parse.quote(project_id, safe='')}/active-task",
            f"active task for {project_id}", fallback_project_id=project_id,
            accept_active_contract=True))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def _direct_still_running(tool_name: str, data: dict, waited_sec: Optional[int]) -> str:
    task_id = data.get("taskId") or data.get("task_id")
    waited = f" (waited {waited_sec} s for it)" if waited_sec is not None else ""
    progress = data.get("progressDetail") if isinstance(data.get("progressDetail"), dict) else {}
    where = ""
    if progress.get("stepsTotal"):
        total = progress["stepsTotal"]
        step = min(total, (progress.get("stepsDone") or 0) + 1)
        where = f" Step {step} of {total}" + (f" ({progress['currentAction']})" if progress.get("currentAction") else "") + "."
    return (f"{tool_name} is still running on Levea{waited}; nothing lost, never run twice.{where} "
            f"Call levea_task_status with task_id {task_id} to keep waiting, or resend the identical call "
            "(it waits again and returns the full result). Do not change the params while it runs.")


def _handle_universal_tool(tool_name: str, args: dict) -> str:
    try:
        args = args or {}
        project_id = _first_string(args.get("project_id"), args.get("projectId"))
        project_fields = {"projectId": project_id, "project_id": project_id} if project_id else {}
        body: dict = {"tool": tool_name, "params": args}
        if project_id:
            body["projectId"] = project_id
            body["project_id"] = project_id
        if "scene" in args and args["scene"] is not None:
            body["scene"] = args["scene"]
        call_start = time.monotonic()
        deadline = call_start + REQUEST_TIMEOUT_SEC
        try:
            # A mutating POST: never resent automatically.
            status, payload, _ = _send("POST", "/execute", body, deadline=deadline)
        except _TransportError as error:
            if error.kind == "timeout":
                return _to_tool_result({
                    **project_fields, "success": False, "code": "STILL_RUNNING", "status": "running",
                    "message": f"{tool_name} did not answer within {int(REQUEST_TIMEOUT_SEC)} s and may still be "
                               "running on Levea. Resend the identical call to keep waiting (an identical resend "
                               "is never run twice), or check levea_active_task with this project_id."})
            return _to_tool_result(_transport_failure(error, project_fields))

        # A long direct call (FACE_RETOUCH, generation, EXPORT_VIDEO, …) answers HTTP 202
        # { status: "running", taskId: "dc_…" }: wait for its own result here.
        waited = _wait_for_direct_call(payload, deadline) if status < 400 else None
        still_running = False
        waited_sec: Optional[int] = None
        if waited is not None:
            payload, waited_sec, finished = waited
            still_running = not finished
            if finished:
                status = 200
        res = normalize_backend_response(status, payload, label=tool_name, fallback_project_id=project_id)
        if waited_sec is not None:
            res["waitedSec"] = waited_sec
        if still_running:
            res.update({"success": False, "status": "running", "code": "STILL_RUNNING",
                        "message": _direct_still_running(tool_name, res, waited_sec)})
            res.pop("contractError", None)
            res.pop("backendPayload", None)
        elif res.get("httpStatus", 500) < 400 and _export_still_rendering(res):
            # An export still rendering: wait for its job within this call's own deadline.
            left = call_start + REQUEST_TIMEOUT_SEC - time.monotonic() - EXPORT_WAIT_MARGIN_SEC
            if left > 0:
                res.update(_with_export_job(res, _wait_for_job(str(res["jobId"]), time.monotonic() + left)))
            else:
                res.update(_with_export_job(res, {"status": res.get("status") or "rendering"}))
        if _bool(args.get("include_scene")) is not True:
            res.pop("scene", None)
        if isinstance(res.get("actionsExecuted"), list) and isinstance(res.get("stepReceipts"), list):
            res.pop("actionsExecuted", None)  # the same array as stepReceipts
        res = _strip_image_data(res)
        _frame_summary(res)
        if isinstance(res.get("observationData"), dict) and not res["observationData"]:
            res.pop("observationData", None)
        return _to_tool_result(res)
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_search_tools(args: dict, **kwargs) -> str:
    return _handle_universal_tool("search_tools", args)


def handle_get_action_schema(args: dict, **kwargs) -> str:
    return _handle_universal_tool("get_action_schema", args)


def handle_execute_action(args: dict, **kwargs) -> str:
    return _handle_universal_tool("execute_action", args)


def handle_execute_batch(args: dict, **kwargs) -> str:
    return _handle_universal_tool("execute_batch", args)


def handle_render_preview(args: dict, **kwargs) -> str:
    return _handle_universal_tool("RENDER_PREVIEW", args)


def handle_search_skills(args: dict, **kwargs) -> str:
    return _handle_universal_tool("search_skills", args)


def handle_load_skill(args: dict, **kwargs) -> str:
    return _handle_universal_tool("load_skill", args)


def handle_read_skill_resource(args: dict, **kwargs) -> str:
    return _handle_universal_tool("read_skill_resource", args)


def handle_asset_upload_url(args: dict, **kwargs) -> str:
    try:
        args = args or {}
        file_name = _first_string(args.get("fileName"), args.get("filename"))
        if not file_name:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_FILE_NAME",
                               "message": "Missing required parameter: fileName."})
        body: dict = {"fileName": file_name}
        if args.get("contentType"):
            body["contentType"] = str(args["contentType"])
        project_id = _first_string(args.get("projectId"), args.get("project_id"))
        if project_id:
            body["projectId"] = project_id
        return _to_tool_result(_call_backend(
            "POST", "/assets/upload-url", body, label="asset_upload_url",
            require_message=False, require_verification=False, fallback_project_id=project_id))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

_PROJECT_ID = {
    "type": "string",
    "minLength": 1,
    "description": "Stable project identifier. Reuse the projectId returned by the first call for every continuation.",
}

VIDEO_EDIT_SCHEMA = {
    "name": "levea_video_edit",
    "description": (
        "Run a natural-language video edit with the Levea autonomous editor (trim, 9:16 reframe, captions, "
        "B-roll, multicam podcast sync, audio cleanup, color grade, motion graphics, MP4 export). Can take "
        "several minutes. success is true only after the backend's authoritative verification; partial, "
        "pending, and failed outcomes are explicit in status. Reuse the returned projectId for follow-up edits."
    ),
    "parameters": _edit_schema("all"),
}

QUEUE_EDIT_SCHEMA = {
    "name": "levea_queue_edit",
    "description": "Queue a long-running Levea edit against a required stable project_id; poll the returned taskId with levea_task_status.",
    "parameters": _edit_schema("queue", required=["prompt", "project_id"]),
}

JOB_STATUS_SCHEMA = {
    "name": "levea_job_status",
    "description": ("Read a Levea export/async render job. wait=true polls until a terminal state, up to "
                    "LEVEA_REQUEST_TIMEOUT_MS (default 10 minutes); rate limits and transient 5xx/network errors "
                    "keep polling instead of failing. On the limit it answers POLL_TIMEOUT: call it again."),
    "parameters": {
        "type": "object",
        "properties": {
            "job_id": {"type": "string", "minLength": 1, "description": "Export or async job id."},
            "wait": {"type": "boolean", "description": "Poll until a terminal status or timeout."},
        },
        "required": ["job_id"],
        "additionalProperties": False,
    },
}

TASK_STATUS_SCHEMA = {
    "name": "levea_task_status",
    "description": ("Read a queued Levea edit task by the taskId returned from levea_queue_edit, or a direct call that "
                    "answered status \"running\" (taskId \"dc_…\" from levea_execute_action / levea_execute_batch / "
                    "levea_render_preview): waits up to ~25 s for it, and once completed / failed its result is that "
                    "call's full response. Direct calls already wait for their own result, so this is rarely needed. "
                    "Separate from job_id (exports: levea_job_status)."),
    "parameters": {
        "type": "object",
        "properties": {"task_id": {"type": "string", "minLength": 1,
                                   "description": "Task id from levea_queue_edit, or a \"dc_…\" id from a direct call still running."}},
        "required": ["task_id"],
        "additionalProperties": False,
    },
}

ACTIVE_TASK_SCHEMA = {
    "name": "levea_active_task",
    "description": ("Return the currently running Levea edit task for a stable project_id (one read; it does not wait). "
                    "Call again every minute or so to follow a long edit; once no task is active the edit has finished."),
    "parameters": {
        "type": "object",
        "properties": {"project_id": _PROJECT_ID},
        "required": ["project_id"],
        "additionalProperties": False,
    },
}

SEARCH_TOOLS_SCHEMA = {
    "name": "levea_search_tools",
    "description": "Search all 195 canonical video editing actions, 28 read/inspection tools, AND canonical preset catalogs (captions, vfx, transitions, color_presets, title_cards, fonts, blend_modes, properties, animatable) by keyword, category, or catalog filter, and retrieve the 5-phase NLE editorialPlaybook.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Optional search keyword."},
            "catalog": {
                "type": "string",
                "enum": ["all", "actions", "captions", "vfx", "transitions", "color_presets", "title_cards", "fonts", "blend_modes", "properties", "animatable"],
                "description": "Optional catalog filter: captions, vfx, transitions, color_presets, title_cards, fonts, blend_modes, properties, animatable, actions, or all.",
            },
            "category": {"type": "string", "description": "Optional domain/category filter."},
            "limit": {"type": "number", "description": "Max actions to return (default: all matches; preset catalogs default to 50)."},
            "include_schemas": {"type": "boolean", "description": "Force parameter specs on (true) or off (false). Default: on when 25 or fewer actions match."},
            "offset": {"type": "number", "description": "Page through a long result: pass the nextOffset a previous answer returned (answers stay under ~10k tokens)."},
            "detail": {"type": "string", "enum": ["summary", "full"], "description": "\"summary\" (default): one-line descriptions. \"full\": full action descriptions (pages sooner)."},
        },
        "additionalProperties": False,
    },
}

GET_ACTION_SCHEMA_SCHEMA = {
    "name": "levea_get_action_schema",
    "description": "Fetch the full JSON inputSchema and parameter constraints for any canonical editor action or read tool.",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "minLength": 1, "description": "Canonical action name or read tool name."},
            "actions": {"type": "array", "items": {"type": "string"},
                        "description": "Several action names at once (up to 40) — one round trip instead of many. They share one answer budget (~10k tokens): small schemas come whole, larger ones summarised (listed in `compacted`; schemaDetail.paramsOmitted names the rest)."},
            "params": {
                "oneOf": [
                    {"type": "array", "items": {"type": "string"}},
                    {"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string"}}},
                ],
                "description": "Only these parameters, in full (nested schemas, every enum value): [\"name\", ...], or { \"ACTION\": [\"name\", ...] } per action with actions: [...]. Use it for the parameters a summarised schema lists in schemaDetail.paramsOmitted.",
            },
            "detail": {"type": "string", "enum": ["summary", "full"], "description": "\"summary\" (default): a very large schema is compacted to stay under ~10k tokens. \"full\": the whole schema as stored."},
        },
        "additionalProperties": False,
    },
}

EXECUTE_ACTION_SCHEMA = {
    "name": "levea_execute_action",
    "description": "Execute any single canonical editor action (all 195 actions) or read tool directly on a project scene without autonomous_edit.",
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "minLength": 1, "description": "Canonical action name or read tool name."},
            "action_params": {"type": "object", "description": "Parameters for the canonical action."},
            "project_id": _PROJECT_ID,
            "video_url": {"type": "string", "description": "Optional source video URL to seed a new project."},
            "assets": {"type": "array", "items": {"type": "object"}, "description": "Optional media assets to seed a new project."},
            "scene": {"type": "object", "description": "Optional inline scene."},
            "include_scene": {"type": "boolean", "description": "If true, include the full raw scene JSON in the response."},
            "idempotency_key": {"type": "string", "description": "Optional: your own id for this logical call. Resending with the same key returns the first answer instead of applying the edit twice (a resend of a call that answered \"running\" is deduplicated even without one)."},
            "rerun": {"type": "boolean", "description": "true runs an identical call again on purpose instead of returning the earlier answer."},
            "dry_run": {"type": "boolean", "description": "true: check every step's parameters against its schema (unknown names, enum values, types, ranges) and return valid / problems / corrected_params; nothing runs or is committed. Send the same call without dry_run to run it."},
            "allow_unknown_params": {"type": "boolean", "description": "true runs the call even with parameters an action does not take (they are ignored and listed). Default false: any parameter problem refuses the call with INVALID_PARAMS before anything runs."},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}

EXECUTE_BATCH_SCHEMA = {
    "name": "levea_execute_batch",
    "description": ("Execute an ordered array (up to 25) of canonical actions and/or read tools in one round trip. The whole batch is "
                    "validated first: unknown actions, unconfirmed destructive actions (need confirm_destructive: true) and invalid "
                    "params (INVALID_PARAMS, with suggestions) reject it before anything runs; dry_run: true only checks. Atomic "
                    "unless allow_partial. After the edits the server runs structural passes only (safe zones, timeline "
                    "reconciliation) and commits the scene to project_id. Long steps (generation, FACE_RETOUCH, EXPORT_VIDEO) "
                    "are waited for here; if still running, the answer names a taskId for levea_task_status."),
    "parameters": {
        "type": "object",
        "properties": {
            "actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"action": {"type": "string"}, "params": {"type": "object"}},
                    "required": ["action"],
                },
            },
            "project_id": _PROJECT_ID,
            "video_url": {"type": "string", "description": "Optional source video URL to seed a new project."},
            "assets": {"type": "array", "items": {"type": "object"}, "description": "Optional media assets to seed a new project."},
            "scene": {"type": "object", "description": "Optional inline scene."},
            "include_scene": {"type": "boolean", "description": "If true, include the full raw scene JSON in the response."},
            "idempotency_key": {"type": "string", "description": "Optional: your own id for this logical call. Resending with the same key returns the first answer instead of applying the edit twice (a resend of a call that answered \"running\" is deduplicated even without one)."},
            "rerun": {"type": "boolean", "description": "true runs an identical call again on purpose instead of returning the earlier answer."},
            "dry_run": {"type": "boolean", "description": "true: check every step's parameters against its schema (unknown names, enum values, types, ranges) and return valid / problems / corrected_params; nothing runs or is committed. Send the same call without dry_run to run it."},
            "allow_unknown_params": {"type": "boolean", "description": "true runs the call even with parameters an action does not take (they are ignored and listed). Default false: any parameter problem refuses the call with INVALID_PARAMS before anything runs."},
            "allow_partial": {"description": "false (default): atomic. true: commit every step that succeeded. \"until_failure\": commit the steps before the first failure."},
            "confirm_destructive": {"type": "boolean", "description": "Required true for destructive actions (CLEAR, DELETE_LAYER on many layers, …)."},
        },
        "required": ["actions"],
        "additionalProperties": False,
    },
}

RENDER_PREVIEW_SCHEMA = {
    "name": "levea_render_preview",
    "description": ("Render real GPU-composited JPEG screenshots of the live project timeline at specified timestamps (and optional "
                    "0..1 region crop) for visual inspection before EXPORT_VIDEO. Image data is not inlined: each frame is saved "
                    "as a local JPEG (frames[].path; plus a URL where Levea returns one) to open with an image-capable tool."),
    "parameters": {
        "type": "object",
        "properties": {
            "project_id": _PROJECT_ID,
            "timestamps": {"type": "array", "items": {"type": "number"}, "description": "Timeline timestamps in seconds."},
            "region": {"type": "object", "description": "Optional normalized zoom region { x, y, width, height } in 0..1."},
            "scene": {"type": "object", "description": "Optional inline scene."},
        },
        "additionalProperties": False,
    },
}

SEARCH_SKILLS_SCHEMA = {
    "name": "levea_search_skills",
    "description": "Search Levea production craft skills (SKILL.md playbooks across editing, color grading, captions, audio mixing, motion graphics, VFX, documentary, podcast, and social shorts) by keyword or category.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search keyword."},
            "category": {"type": "string", "description": "Optional category filter."},
            "limit": {"type": "number", "description": "Max skills to return."},
        },
        "additionalProperties": False,
    },
}

LOAD_SKILL_SCHEMA = {
    "name": "levea_load_skill",
    "description": "Load the full craft playbook (SKILL.md) and bundled resource list for one or more skill IDs returned by levea_search_skills.",
    "parameters": {
        "type": "object",
        "properties": {
            "skill_id": {"type": "string", "description": "Skill ID to load."},
            "skill_ids": {"type": "array", "items": {"type": "string"}, "description": "Optional array of skill IDs to load."},
        },
        "additionalProperties": False,
    },
}

READ_SKILL_RESOURCE_SCHEMA = {
    "name": "levea_read_skill_resource",
    "description": "Read a bundled reference or template file belonging to a production skill.",
    "parameters": {
        "type": "object",
        "properties": {
            "skill_id": {"type": "string", "description": "Skill ID that owns the resource."},
            "resource": {"type": "string", "minLength": 1, "description": "Relative path of the resource inside the skill."},
        },
        "required": ["resource"],
        "additionalProperties": False,
    },
}

ASSET_UPLOAD_URL_SCHEMA = {
    "name": "levea_asset_upload_url",
    "description": "Generate a presigned PUT upload URL to upload a local video, audio, or image file to Levea cloud storage, then pass the returned fileUrl as video_url or assets.",
    "parameters": {
        "type": "object",
        "properties": {
            "fileName": {"type": "string", "minLength": 1, "description": "File name (e.g. 'clip.mp4')."},
            "contentType": {"type": "string", "description": "Optional MIME type (e.g. 'video/mp4')."},
            "projectId": {"type": "string", "description": "Optional project identifier."},
        },
        "required": ["fileName"],
        "additionalProperties": False,
    },
}

_TOOLS = (
    (VIDEO_EDIT_SCHEMA, handle_video_edit, "🎬"),
    (QUEUE_EDIT_SCHEMA, handle_queue_edit, "📥"),
    (JOB_STATUS_SCHEMA, handle_job_status, "📦"),
    (TASK_STATUS_SCHEMA, handle_task_status, "⏳"),
    (ACTIVE_TASK_SCHEMA, handle_active_task, "🔗"),
    (SEARCH_TOOLS_SCHEMA, handle_search_tools, "🔍"),
    (GET_ACTION_SCHEMA_SCHEMA, handle_get_action_schema, "📋"),
    (EXECUTE_ACTION_SCHEMA, handle_execute_action, "⚡"),
    (EXECUTE_BATCH_SCHEMA, handle_execute_batch, "🚀"),
    (RENDER_PREVIEW_SCHEMA, handle_render_preview, "🖼️"),
    (SEARCH_SKILLS_SCHEMA, handle_search_skills, "📚"),
    (LOAD_SKILL_SCHEMA, handle_load_skill, "📖"),
    (READ_SKILL_RESOURCE_SCHEMA, handle_read_skill_resource, "📄"),
    (ASSET_UPLOAD_URL_SCHEMA, handle_asset_upload_url, "☁️"),
)


def _skill_description(skill_md: Path) -> str:
    """The ``description:`` value from a SKILL.md YAML frontmatter block, or ``""``."""
    lines = skill_md.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    for line in lines[1:]:
        if line.strip() == "---":
            break
        key, sep, value = line.partition(":")
        if sep and key.strip() == "description":
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value
    return ""


def register(ctx) -> None:
    for schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=schema["name"],
            toolset=TOOLSET,
            schema=schema,
            handler=handler,
            description=schema["description"],
            emoji=emoji,
        )

    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.is_dir():
        for child in sorted(skills_dir.iterdir()):
            skill_md = child / "SKILL.md"
            if child.is_dir() and skill_md.exists():
                # Hermes lists plugin skills in <available_skills> with the description we pass;
                # without it the row is blank and the model guesses the skill name.
                ctx.register_skill(child.name, skill_md, description=_skill_description(skill_md))
