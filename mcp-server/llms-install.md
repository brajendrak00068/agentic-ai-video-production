# Levea MCP Server — Agent Install Guide

This file helps coding agents (Cline, Claude Code, Cursor, etc.) install and
configure the Levea autonomous AI video editor MCP server automatically.

## What this server does
One tool, `autonomous_edit`: send a natural-language description of the video you
want and it plans, edits, verifies, and exports the finished result (viral clips,
captions, 9:16 reframe, chroma key, motion tracking, B-roll, voiceover, music,
multi-platform export). No timeline. Also exposes streaming, async queue, job
status, brand kits, projects, assets, and caption-template tools.

## Install
No global install needed — run via npx:

```bash
npx -y levea-mcp-server
```

## Required environment variables
| Var | Required | Value |
|---|---|---|
| `LEVEA_API_URL` | yes | `https://api.livecore.ai` (host only — no path) |
| `LEVEA_API_KEY` | yes | Create one at https://livecore.ai/?openclaw=1&utm_source=cline&utm_medium=mcp-server&utm_campaign=levea-mcp-server |

> Legacy `ADSCENE_API_URL` / `ADSCENE_API_KEY` are still accepted as a silent fallback.

## MCP client config (stdio)
```json
{
  "mcpServers": {
    "levea": {
      "command": "npx",
      "args": ["-y", "levea-mcp-server"],
      "env": {
        "LEVEA_API_URL": "https://api.livecore.ai",
        "LEVEA_API_KEY": "<your-key-from-livecore.ai>"
      }
    }
  }
}
```

## Hosted alternative (no local process)
Clients that support remote MCP servers can connect directly to the hosted
Streamable HTTP endpoint instead of running npx:

```json
{
  "mcpServers": {
    "levea": {
      "type": "streamable-http",
      "url": "https://api.livecore.ai/api/v1/misc/mcp",
      "headers": { "Authorization": "Bearer <your-key-from-livecore.ai>" }
    }
  }
}
```

## One-line client adds
- Claude Code: `claude mcp add levea -e LEVEA_API_URL=https://api.livecore.ai -e LEVEA_API_KEY=... -- npx -y levea-mcp-server`
- Claude Code (hosted): `claude mcp add --transport http levea https://api.livecore.ai/api/v1/misc/mcp --header "Authorization: Bearer ..."`
- OpenClaw: `openclaw mcp add levea --command "npx -y levea-mcp-server" --env LEVEA_API_URL=https://api.livecore.ai --env LEVEA_API_KEY=...`

## Verify
Call the `editor_health` tool — it should report the backend as healthy. `tools/list`
should return 25 tools.

## Notes for the agent
- Never print or log `LEVEA_API_KEY`.
- `autonomous_edit` is the primary tool; pass the user's goal as `params.prompt`.
- Mutating edits auto-export; async generation returns a `jobId` to poll.
