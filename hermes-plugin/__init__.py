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


def _normalize(field: dict, value: Any) -> Any:
    if value is None:
        return None
    kind = field["schema"].get("type")
    if kind == "string":
        return None if isinstance(value, str) and not value.strip() else str(value)
    if kind == "boolean":
        return bool(value)
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
        project_id = _first_string(args.get("project_id"))
        body = _build_edit_body({**args, "prompt": prompt}, "all")
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
        body = _build_edit_body({**args, "prompt": prompt, "project_id": project_id}, "queue")
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
