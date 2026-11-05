# Security policy

## Reporting a vulnerability

Please report security issues privately to **support@livecore.ai** with "Security" in the subject, not in a public issue. Include what you found, how to reproduce it, and which component it affects (the `levea-mcp-server` npm package, the OpenClaw / Hermes plugins, the hosted MCP endpoint, or the Levea API).

We acknowledge reports within 3 business days and keep you updated until the issue is fixed.

## Scope

- The clients in this repository: `levea-mcp-server`, the OpenClaw plugin, the Hermes plugin, the Claude Code plugin, the skills, and the ChatGPT app manifests.
- The hosted endpoints they call: `https://api.livecore.ai` and `https://api.livecore.ai/api/v1/misc/mcp` (including OAuth).

Never include a real API key in a report or an issue. If a key was exposed, regenerate it at [livecore.ai](https://www.livecore.ai).
