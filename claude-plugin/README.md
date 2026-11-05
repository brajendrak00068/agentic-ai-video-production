# Levea AI Video Editor plugin

Prompt-first AI video editing inside Claude Code and Cursor. Describe the edit in plain language and Levea plans it, runs it on its editing engine, checks the result and exports a finished MP4.

## What's inside

- `.mcp.json` connects to the hosted Levea MCP server: `https://api.livecore.ai/api/v1/misc/mcp` (Streamable HTTP).
- `skills/levea-video-editor` teaches the agent how to drive the editor.

## Setup

1. Install the plugin (Claude Code: `/plugin marketplace add brajendrak00068/agentic-ai-video-production`; Cursor: from the Cursor Marketplace).
2. On first use your client opens the Levea sign-in page (OAuth). Sign in or create a free account at https://www.livecore.ai.
3. Ask for an edit, for example: "Make three 30-second vertical clips with captions from this video: <URL>".

No API key is needed with OAuth. Plans: Free (3 edits/month, 720p, watermark) and paid plans with higher limits; see https://www.livecore.ai.

## Links

- Docs: https://github.com/brajendrak00068/agentic-ai-video-production/blob/main/mcp-server/README.md
- Privacy: https://livecore.ai/privacy · Terms: https://livecore.ai/terms
- Support: support@livecore.ai or https://github.com/brajendrak00068/agentic-ai-video-production/issues
