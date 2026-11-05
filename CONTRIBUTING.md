# Contributing

Thanks for helping improve the Levea clients. This repository holds the open-source clients (MCP server, OpenClaw and Hermes plugins, Claude Code plugin, skills, ChatGPT manifests); the video engine itself is hosted.

## Before you start

- **Bugs and ideas:** open an issue with the template. For security issues, follow [SECURITY.md](./SECURITY.md) instead.
- **Edit request fields have one source:** `contract/edit-contract.json`. To add or change a field, edit that file and run `npm run sync-contract`; never hand-edit the generated copies (skills, `mcp-server/src/edit-contract.json`, the Hermes copy, the ChatGPT specs). CI fails if they drift.

## Checks

```bash
npm ci && npm run build                     # OpenClaw plugin
cd mcp-server && npm ci && npm run build && npm test
node scripts/sync-contract.mjs --check      # contract copies in sync
```

Keep pull requests focused, describe what changed and why, and never commit API keys or `.env` files.
