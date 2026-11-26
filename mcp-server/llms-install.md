# Levea MCP Server — Agent Install Guide

This file helps coding agents (Cline, Claude Code, Cursor, etc.) install and
configure the Levea autonomous AI video editor MCP server automatically.

## What this server does
By default (35 tools) the agent plans the edit and the direct canonical suite
(`search_tools`, `get_action_schema`, `execute_action`, `execute_batch`,
`render_preview`, `search_skills`, `load_skill`, `read_skill_resource`)
executes each action exactly as given and reports what happened (viral clips,
captions, 9:16 reframe, 2D and 3D motion graphics, chroma key, motion tracking,
B-roll, voiceover, music and sound effects, multi-platform export), plus
shader-effect, job status, brand kit, project, asset, skill and caption-template
tools.

Autonomous mode is opt-in: with `LEVEA_ENABLE_AUTONOMOUS=1` in the server's
environment (Claude Desktop `.mcpb`: the "Enable autonomous mode" setting) it
also lists `autonomous_edit` (send a natural-language description of the video
you want and it plans, edits, verifies on the rendered frames, and exports),
`autonomous_edit_streaming`, `queue_edit` for long edits, and `get_active_task`
(39 tools). Without the flag, calling one of them returns an error naming the
flag. The hosted endpoint moves to this default in a later release; until then it lists all 39 tools.

## Default: hosted endpoint (OAuth, nothing to install)
Connect to the hosted Streamable HTTP endpoint. The client signs the user in to
Levea with OAuth on first connect; no API key, no local process.

```
https://api.livecore.ai/api/v1/misc/mcp
```

- Claude Code: `claude mcp add --transport http levea https://api.livecore.ai/api/v1/misc/mcp`
- Claude Desktop / Claude.ai: Settings → Connectors → Add custom connector → the URL above (or install the `.mcpb` bundle)
- Cursor (`~/.cursor/mcp.json`):
  ```json
  {"mcpServers":{"levea":{"url":"https://api.livecore.ai/api/v1/misc/mcp"}}}
  ```
- Windsurf (`mcp_config.json`):
  ```json
  {"mcpServers":{"levea":{"serverUrl":"https://api.livecore.ai/api/v1/misc/mcp"}}}
  ```
- Cline (`cline_mcp_settings.json`):
  ```json
  {"mcpServers":{"levea":{"type":"streamableHttp","url":"https://api.livecore.ai/api/v1/misc/mcp"}}}
  ```

## Fallback: local stdio server (clients without remote-MCP support)
Only when the client cannot connect to a URL. Runs via npx (the package has no
dependencies; Node 18+) and needs an API key:

| Var | Required | Value |
|---|---|---|
| `LEVEA_API_KEY` | yes (for edits) | Create one at https://livecore.ai/?openclaw=1&utm_source=cline&utm_medium=mcp-server&utm_campaign=levea-mcp-server |
| `LEVEA_API_URL` | no | Defaults to `https://api.livecore.ai` (host only — no path) |
| `LEVEA_ENABLE_AUTONOMOUS` | no | `1` (or `true`) lists the autonomous-mode tools; off by default |

> Legacy `ADSCENE_API_URL` / `ADSCENE_API_KEY` are still accepted as a silent fallback.

```json
{
  "mcpServers": {
    "levea": {
      "command": "npx",
      "args": ["-y", "levea-mcp-server"],
      "env": {
        "LEVEA_API_KEY": "<your-key-from-livecore.ai>"
      }
    }
  }
}
```

- Claude Code (stdio): `claude mcp add levea -e LEVEA_API_KEY=... -- npx -y levea-mcp-server`
- OpenClaw: `openclaw mcp add levea --command "npx -y levea-mcp-server" --env LEVEA_API_KEY=...`

## Verify
Call the `editor_health` tool — it should report the backend as healthy.
`tools/list` returns the Levea tools (35 by default; 39, `autonomous_edit` first, with `LEVEA_ENABLE_AUTONOMOUS=1`).

## Notes for the agent
- Never print or log `LEVEA_API_KEY`.
- Direct tools: `search_tools` and `get_action_schema` return the actions and their parameter schemas; `execute_action` / `execute_batch` run them; `render_preview` returns rendered frames; `EXPORT_VIDEO` (through `execute_action`) renders the MP4. A direct call that returns status `running` with a `dc_…` taskId is read with `check_task_status`; an identical resend waits for it and is never applied twice.
- Autonomous mode (`LEVEA_ENABLE_AUTONOMOUS=1`): `autonomous_edit` is the primary tool; pass the user's goal verbatim as `prompt`. For long edits prefer `queue_edit` + `check_task_status`. If it returns status `running`, follow it with `get_active_task { project_id }`; never re-send the edit. Mutating edits auto-export.
- Async generation returns a `jobId` to poll with `check_job_status`.
