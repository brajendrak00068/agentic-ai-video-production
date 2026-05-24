# hermes-levea

Thin **Hermes** wrapper for the Levea AI video editor. There is intentionally
almost nothing here: the real integration is the
[`levea-mcp-server`](../mcp-server/) MCP server. Hermes connects to external
tool servers over MCP, so the "plugin" is just a registration that points
Hermes at that server.

This keeps one tool surface (the MCP server, backed by one backend contract)
instead of a bespoke Hermes codebase that drifts.

## Configure

Set your key once:

```bash
export LEVEA_API_KEY="your-levea-api-key"   # from https://studio.livecore.ai/
```

## Register with Hermes

Either point Hermes at `hermes.plugin.json` in this folder, or add the MCP
server directly to your Hermes MCP config (see [`mcp.json`](./mcp.json)):

```jsonc
{
  "mcpServers": {
    "levea": {
      "command": "npx",
      "args": ["-y", "levea-mcp-server"],
      "env": {
        "LEVEA_API_URL": "https://api.livecore.ai",
        "LEVEA_API_KEY": "${LEVEA_API_KEY}"
      }
    }
  }
}
```

> The MCP transport/command/env fields are universal. If your Hermes build
> expects a different manifest shape, only the wrapper field names change —
> the MCP server itself does not.

## Tools

Same surface as every other client: a single edit tool (`autonomous_edit`) plus
two diagnostics (`check_job_status`, `editor_health`). One brain, one entry
point — see the [MCP server README](../mcp-server/README.md) for the rationale.
