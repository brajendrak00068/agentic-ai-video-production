# Changelog — levea-mcp-server

## 0.8.0 — breaking: autonomous mode is opt-in

**What moved.** By default the server now lists only the direct tools: your agent plans the edit, and `execute_action`, `execute_batch`, `render_preview`, the read and measure tools, and the shader-effect tools execute it and report what happened. Four tools are no longer listed:

- `autonomous_edit`
- `autonomous_edit_streaming`
- `queue_edit`
- `get_active_task`

**How to turn it back on.** Set `LEVEA_ENABLE_AUTONOMOUS=1` (or `true`) in the MCP server's environment. In Claude Desktop (MCPB), switch on **Enable autonomous mode** in the extension settings. With the flag, the server lists exactly the tools 0.7.x listed and sends the same instructions.

**Details.**
- Calling a hidden tool without the flag returns a tool error. The error says the tool is off by default and names the flag; it is not "unknown tool".
- Without the flag, the `initialize` instructions describe only the direct tools.
- Without the flag, five tools describe themselves without naming a hidden tool: `check_task_status`, `apply_caption_template`, `list_brand_kits`, `asset_upload_url` and `save_skill`.
- `manifest.json` lists the default tools, copied from the server, and a test keeps them in sync.
- Unchanged: the Levea backend, the web app, and the OpenClaw, Hermes and ChatGPT clients keep autonomous mode. No direct tool behaves differently.

## 0.7.7
- Export links stay whole in text results, and a result's video link gets its own 📹 line.
- A gateway 504 on a direct call says the call may still be running, and that an identical resend waits for it.
- `check_job_status` is described by its `job_id` parameter.
- An `EXPORT_VIDEO` receipt that said "still rendering" is followed by the outcome of the job the call waited for.
