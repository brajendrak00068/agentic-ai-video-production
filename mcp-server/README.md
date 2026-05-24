# Levea MCP Server

> Autonomous AI video editing for any MCP client — Claude Desktop, Claude Code, Cursor, Cline, OpenClaw, Hermes.

`levea-mcp-server` exposes the Levea autonomous video editor over the
[Model Context Protocol](https://modelcontextprotocol.io). One prompt →
the agent plans, edits, verifies, and exports: viral clips, captions,
vertical 9:16 reframe, chroma key, audio cleanup, motion tracking, B‑roll,
voiceover, music, and MP4 export.

It is a **thin, stable adapter**. Every tool maps onto one backend contract
(`POST /api/v1/misc/openclaw/v1/execute`). No editing logic, shell, filesystem,
or raw renderer access lives in this process — those stay behind the backend,
which allowlists tools server‑side.

## Tools

**One edit tool, many management tools.** The editing path is single-tool by design — no `add_captions` / `generate_viral_clips` / `editor_execute` shims. Everything else (brand kits, projects, assets, caption templates) is typed state-management you can drive through the API key.

**Edit (3 variants of one entry point)**
- `autonomous_edit` — primary. Natural-language brief end-to-end. Planner picks the right actions.
- `autonomous_edit_streaming` — same input, SSE response. Emits per-step MCP progress notifications.
- `queue_edit` — fire-and-forget. Returns `taskId` for `check_task_status`.

**Job / task polling** — `check_job_status` · `check_task_status` · `get_active_task`

**Caption templates** — `list_caption_templates` · `apply_caption_template` · `save_caption_template` · `save_current_caption_template` · `delete_caption_template`

**Brand kits** — `list_brand_kits` · `get_brand_kit` · `create_brand_kit` · `update_brand_kit` · `delete_brand_kit`

**Projects** — `list_projects` · `get_project` · `create_project` · `delete_project`

**Assets** — `asset_upload_url` (signed PUT URL — upload local files) · `list_assets` · `delete_asset` · `transcribe_asset`

**Diagnostics** — `editor_health`

See [AGENTS.md](../AGENTS.md) for the rationale, full call patterns, and typed param descriptions on `autonomous_edit` (plan approval, brand binding, caption preset, attached screenshots, working-memory resume, …).

## Configuration

Two environment variables:

| Var | Required | Value |
|---|---|---|
| `LEVEA_API_URL` | yes | `https://api.livecore.ai` |
| `LEVEA_API_KEY` | yes | Generate at <https://studio.livecore.ai/> |

> Use `https://api.livecore.ai` — **not** `https://studio.livecore.ai`. Studio is
> the user‑facing app; MCP traffic goes to the API‑key route.

## Install

### Claude Desktop / Claude Code / Cursor / Cline

```jsonc
{
  "mcpServers": {
    "levea": {
      "command": "npx",
      "args": ["-y", "levea-mcp-server"],
      "env": {
        "LEVEA_API_URL": "https://api.livecore.ai",
        "LEVEA_API_KEY": "your-levea-api-key"
      }
    }
  }
}
```

(Claude Code: `claude mcp add levea -e LEVEA_API_URL=https://api.livecore.ai -e LEVEA_API_KEY=… -- npx -y levea-mcp-server`)

### OpenClaw

```bash
openclaw mcp add levea --command "npx -y levea-mcp-server" \
  --env LEVEA_API_URL=https://api.livecore.ai \
  --env LEVEA_API_KEY=your-levea-api-key
```

### Hermes

See [`../hermes-levea/`](../hermes-levea/) — a thin Hermes wrapper that registers this MCP server.

## Develop

```bash
npm install
npm run build
LEVEA_API_URL=https://api.livecore.ai LEVEA_API_KEY=… npm start
```

## Publish

```bash
# 1. npm (requires `npm login`)
npm publish --access public

# 2. Official MCP Registry (requires the mcp-publisher CLI)
mcp-publisher login github
mcp-publisher publish        # validates server.json against the published npm package
```

`package.json` carries `mcpName: io.github.brajendrak00068/levea-mcp-server`,
which the registry cross‑checks against `server.json`.

## License

MIT
