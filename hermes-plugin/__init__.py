"""Levea Agentic Video Editor — Hermes plugin.

Python port of the OpenClaw plugin (../openclaw-ai-video-editor/index.ts).
Editing stays a single high-level tool: the Levea backend owns planning,
execution, verification, and export. The queue and polling tools expose
durable backend state; none of them mutate scenes directly.

Network: every call goes to the Levea API (default https://api.livecore.ai,
override with LEVEA_API_URL) with the user's LEVEA_API_KEY. No telemetry.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

PLUGIN_VERSION = "1.0.0"
TOOLSET = "levea_video_editor"
DEFAULT_API_URL = "https://api.livecore.ai"
REQUEST_TIMEOUT_SEC = 600
POLL_INTERVAL_SEC = 4
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
    "executing", "dispatch", "awaiting_approval", "awaiting_input",
}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _secret(name: str) -> Optional[str]:
    # Hermes routes credentials through the active profile's secret scope.
    from agent.secret_scope import get_secret

    value = get_secret(name)
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


def _call_backend(method: str, path: str, body: Optional[dict], *, label: str,
                  require_message: bool = False, require_verification: bool = False,
                  fallback_project_id: Optional[str] = None,
                  accept_active_contract: bool = False) -> dict:
    project_fields = ({"projectId": fallback_project_id, "project_id": fallback_project_id}
                      if fallback_project_id else {})
    api_key = _secret("LEVEA_API_KEY")
    if not api_key:
        return {**project_fields, "success": False, "code": "MISSING_API_KEY",
                "message": f"LEVEA_API_KEY is required. Generate a key at {KEY_PORTAL_URL} "
                           "and add it with `hermes config set LEVEA_API_KEY <key>`."}

    url = _v1_root() + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Levea-Client": f"hermes-plugin/{PLUGIN_VERSION}",
    })
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    except TimeoutError:
        return {**project_fields, "success": False, "code": "TIMEOUT", "status": "unknown",
                "message": "The editor request timed out; its final state is unknown. Poll by "
                           "the returned project or task identifier before retrying."}
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            return {**project_fields, "success": False, "code": "TIMEOUT", "status": "unknown",
                    "message": "The editor request timed out; its final state is unknown. Poll by "
                               "the returned project or task identifier before retrying."}
        return {**project_fields, "success": False, "code": "BACKEND_UNREACHABLE",
                "message": f"Cannot reach the editor backend: {error.reason}"}
    except Exception as error:  # handlers must never raise
        return {**project_fields, "success": False, "code": "TRANSPORT_ERROR",
                "message": str(error) or "Unknown editor transport error."}

    try:
        payload: Any = json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = raw.decode("utf-8", errors="replace")[:2000]
    return normalize_backend_response(
        status, payload, label=label, require_message=require_message,
        require_verification=require_verification, fallback_project_id=fallback_project_id,
        accept_active_contract=accept_active_contract)


def _poll(path: str, label: str, *, fallback_project_id: Optional[str] = None,
          accept_active_contract: bool = False) -> dict:
    result = _call_backend("GET", path, None, label=label,
                           fallback_project_id=fallback_project_id,
                           accept_active_contract=accept_active_contract)
    status = str(result.get("status") or "").lower()
    if result.get("success") is True and status in FAILED_JOB_STATES:
        result = {**result, "success": False,
                  "message": _first_string(result.get("error"), result.get("message")) or f"{label}: {status}."}
    return result


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
    if backend_status and backend_status != normalized:
        out["backendStatus"] = backend_status
    out["status"] = normalized
    return json.dumps(out, default=str)


# ---------------------------------------------------------------------------
# Tool handlers (accept (args, **kwargs), always return a JSON string)
# ---------------------------------------------------------------------------

_EDIT_TOP_LEVEL_KEYS = (
    "requirePlanApproval", "workingMemory", "captionTemplatePreset", "captionTemplateMode",
    "core_only", "brandId", "projectBrandId", "editedPlan",
)


def handle_video_edit(args: dict, **kwargs) -> str:
    try:
        args = args or {}
        prompt = _first_string(args.get("prompt"))
        if not prompt:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_PROMPT",
                               "message": "Missing required parameter: prompt."})
        project_id = _first_string(args.get("project_id"))
        params: dict = {"prompt": prompt}
        if _first_string(args.get("video_url")):
            params["video_url"] = args["video_url"]
        if isinstance(args.get("assets"), list) and args["assets"]:
            params["assets"] = args["assets"]
        body: dict = {"tool": "autonomous_edit", "params": params}
        if project_id:
            body["projectId"] = project_id
            body["project_id"] = project_id
        if args.get("scene") is not None:
            body["scene"] = args["scene"]
        for key in ("attachedImages", "flaggedIssues"):
            if isinstance(args.get(key), list) and args[key]:
                body[key] = args[key]
        for key in _EDIT_TOP_LEVEL_KEYS:
            if args.get(key) is not None and args.get(key) != "":
                body[key] = args[key]
        return _to_tool_result(_call_backend(
            "POST", "/execute", body, label="autonomous_edit", require_message=True,
            require_verification=True, fallback_project_id=project_id))
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
        body: dict = {"prompt": prompt, "projectId": project_id, "project_id": project_id}
        if args.get("scene") is not None:
            body["scene"] = args["scene"]
        for key in ("assets", "platforms"):
            if isinstance(args.get(key), list):
                body[key] = args[key]
        if isinstance(args.get("autoExport"), bool):
            body["autoExport"] = args["autoExport"]
        return _to_tool_result(_call_backend(
            "POST", "/queue-edit", body, label="queue_edit", require_message=True,
            fallback_project_id=project_id))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_job_status(args: dict, **kwargs) -> str:
    try:
        args = args or {}
        job_id = _first_string(str(args.get("job_id") or ""))
        if not job_id:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_JOB_ID",
                               "message": "Missing required parameter: job_id."})
        path = "/jobs/" + urllib.parse.quote(job_id, safe="")
        label = f"job {job_id}"
        result = _poll(path, label)
        if args.get("wait") is True:
            deadline = time.monotonic() + REQUEST_TIMEOUT_SEC
            while result.get("success") and str(result.get("status") or "").lower() not in TERMINAL_JOB_STATES:
                if time.monotonic() >= deadline:
                    result = {**result, "success": False, "code": "POLL_TIMEOUT",
                              "message": f"Timed out waiting for job {job_id}."}
                    break
                time.sleep(POLL_INTERVAL_SEC)
                result = _poll(path, label)
        return _to_tool_result(result)
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_task_status(args: dict, **kwargs) -> str:
    try:
        task_id = _first_string(str((args or {}).get("task_id") or ""))
        if not task_id:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_TASK_ID",
                               "message": "Missing required parameter: task_id."})
        return _to_tool_result(_poll("/task-status/" + urllib.parse.quote(task_id, safe=""),
                                     f"task {task_id}"))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


def handle_active_task(args: dict, **kwargs) -> str:
    try:
        project_id = _first_string((args or {}).get("project_id"))
        if not project_id:
            return json.dumps({"success": False, "status": "error", "code": "MISSING_PROJECT_ID",
                               "message": "Missing required parameter: project_id."})
        return _to_tool_result(_poll(
            f"/projects/{urllib.parse.quote(project_id, safe='')}/active-task",
            f"active task for {project_id}", fallback_project_id=project_id,
            accept_active_contract=True))
    except Exception as error:
        return json.dumps({"success": False, "status": "error", "code": "PLUGIN_ERROR", "message": str(error)})


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

_PROMPT = {
    "type": "string",
    "minLength": 1,
    "description": ("Natural-language description of the desired video edit. Send the complete user "
                    "intent in one prompt; the backend owns decomposition, execution, and verification."),
}
_PROJECT_ID = {
    "type": "string",
    "minLength": 1,
    "description": "Stable project identifier. Reuse the projectId returned by the first call for every continuation.",
}
_SCENE = {"type": "object", "description": "Optional scene used only to bootstrap a project without a committed scene."}
_ASSETS = {"type": "array", "items": {"type": "object"}, "description": "Optional asset descriptors used to seed a new scene."}

VIDEO_EDIT_SCHEMA = {
    "name": "levea_video_edit",
    "description": (
        "Run a natural-language video edit with the Levea autonomous editor (trim, 9:16 reframe, captions, "
        "B-roll, multicam podcast sync, audio cleanup, color grade, motion graphics, MP4 export). Can take "
        "several minutes. success is true only after the backend's authoritative verification; partial, "
        "pending, and failed outcomes are explicit in status. Reuse the returned projectId for follow-up edits."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": _PROMPT,
            "video_url": {"type": "string", "description": "Optional source video URL for a new project."},
            "assets": _ASSETS,
            "project_id": _PROJECT_ID,
            "scene": _SCENE,
            "requirePlanApproval": {"type": "boolean", "description": "Pause after planning and return workingMemory for approval."},
            "workingMemory": {"type": "object", "description": "Working memory returned by an awaiting-approval call; resend it to resume."},
            "attachedImages": {"type": "array", "items": {"type": "string"}, "description": "Reference images for planning."},
            "flaggedIssues": {"type": "array", "items": {"type": "string"}, "description": "Specific issues the editor must repair."},
            "captionTemplatePreset": {"type": "string", "description": "Caption template slug or saved template id."},
            "captionTemplateMode": {
                "type": "string",
                "enum": ["add", "recreate", "style", "translate", "clear", "remove_fillers"],
                "description": "Caption-template operation mode.",
            },
            "core_only": {"type": "boolean", "description": "Return rendering-essential scene fields only."},
            "brandId": {"type": "string", "description": "Per-call brand profile id."},
            "projectBrandId": {"type": "string", "description": "Default brand profile for this project."},
            "editedPlan": {"type": "object", "description": "User-edited plan returned by a prior approval pause."},
        },
        "required": ["prompt"],
        "additionalProperties": False,
    },
}

QUEUE_EDIT_SCHEMA = {
    "name": "levea_queue_edit",
    "description": "Queue a long-running Levea edit against a required stable project_id; poll the returned taskId with levea_task_status.",
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": _PROMPT,
            "project_id": _PROJECT_ID,
            "scene": _SCENE,
            "assets": _ASSETS,
            "platforms": {"type": "array", "items": {"type": "string"}, "description": "Optional export platforms."},
            "autoExport": {"type": "boolean", "description": "Automatically export after the queued edit."},
        },
        "required": ["prompt", "project_id"],
        "additionalProperties": False,
    },
}

JOB_STATUS_SCHEMA = {
    "name": "levea_job_status",
    "description": "Read a Levea export/async render job. wait=true polls until a terminal state (up to 10 minutes).",
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
    "description": "Read a queued Levea edit task by the taskId returned from levea_queue_edit.",
    "parameters": {
        "type": "object",
        "properties": {"task_id": {"type": "string", "minLength": 1, "description": "Task id returned by levea_queue_edit."}},
        "required": ["task_id"],
        "additionalProperties": False,
    },
}

ACTIVE_TASK_SCHEMA = {
    "name": "levea_active_task",
    "description": "Reconnect to the currently running Levea edit for a stable project_id.",
    "parameters": {
        "type": "object",
        "properties": {"project_id": _PROJECT_ID},
        "required": ["project_id"],
        "additionalProperties": False,
    },
}

_TOOLS = (
    (VIDEO_EDIT_SCHEMA, handle_video_edit, "🎬"),
    (QUEUE_EDIT_SCHEMA, handle_queue_edit, "📥"),
    (JOB_STATUS_SCHEMA, handle_job_status, "📦"),
    (TASK_STATUS_SCHEMA, handle_task_status, "⏳"),
    (ACTIVE_TASK_SCHEMA, handle_active_task, "🔗"),
)


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
                ctx.register_skill(child.name, skill_md)
