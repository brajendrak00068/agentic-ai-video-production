# hermes-levea

Thin **Hermes** wrapper for the Levea AI video editor. There is intentionally
almost nothing here: the real integration is the
[`levea-mcp-server`](../mcp-server/) MCP server. Hermes connects to external
tool servers over MCP, so the "plugin" is just a registration that points
Hermes at that server.

This keeps one tool surface (the MCP server, backed by one backend contract)
instead of a bespoke Hermes codebase that drifts.

## Register with Hermes (hosted server — default, nothing to install)

Hermes reads MCP servers from `~/.hermes/config.yaml` under `mcp_servers`
(HTTP servers take `url` + `headers` or `auth: oauth`; `${VAR}` placeholders
resolve from the environment and `~/.hermes/.env`). Point it at the hosted
Levea MCP endpoint (Streamable HTTP):

```yaml
mcp_servers:
  levea:
    url: "https://api.livecore.ai/api/v1/misc/mcp"
    auth: oauth            # sign in once: `hermes mcp login levea`
```

Or with an API key instead of OAuth (key from https://livecore.ai/):

```yaml
mcp_servers:
  levea:
    url: "https://api.livecore.ai/api/v1/misc/mcp"
    headers:
      Authorization: "Bearer ${LEVEA_API_KEY}"
```

[`mcp.json`](./mcp.json) and [`hermes.plugin.json`](./hermes.plugin.json) carry
the same remote entry (API-key header) for tools that import a JSON
`mcpServers` block (for example `hermes import-agent claude-code`).

## Fallback: local stdio server (`npx`)

If your Hermes build cannot reach HTTP MCP servers, run the npm package over
stdio instead (Node 18+):

```yaml
mcp_servers:
  levea:
    command: npx
    args: ["-y", "levea-mcp-server@^0.7.3"]
    env:
      LEVEA_API_URL: "https://api.livecore.ai"
      LEVEA_API_KEY: "${LEVEA_API_KEY}"
```

```bash
export LEVEA_API_KEY="your-levea-api-key"   # from https://livecore.ai/
```

Both paths expose the same tools and call the same backend.

## Tools

The full `levea-mcp-server` surface (39 tools): the high-level edit tool `autonomous_edit`
plus streaming, async queue, the universal direct canonical suite (`search_tools`, `get_action_schema`,
`execute_action`, `execute_batch`, `render_preview`, `search_skills`, `load_skill`, `read_skill_resource`
unlocking all 195 canonical actions, 28 read tools, and 100+ craft skills),
job and task
status, caption templates, brand kits,
projects, assets, and `editor_health`. See the
[MCP server README](../mcp-server/README.md).
