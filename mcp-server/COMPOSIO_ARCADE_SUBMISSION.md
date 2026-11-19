# Composio & Arcade AI Toolkit Broker Submission Kit — Levea AI Video Editor

Everything needed to register **Levea AI Video Editor** in **Composio** (`https://dashboard.composio.dev`) and **Arcade AI** (`https://arcade.dev`), which power the dynamic **Browse Apps** catalog inside CopilotKit OpenBot, OpenDuet, OpenDots, OpenFuse, Suparagent, and OpenMausBot.

---

## 1. Canonical Endpoints & Metadata

| Field | Value |
|---|---|
| **Toolkit / App Name** | `Levea AI Video Editor` (slug: `levea`) |
| **Category** | `Video Editing / Media & Content Creation` |
| **Hosted MCP Endpoint (Streamable HTTP)** | `https://api.livecore.ai/api/v1/misc/mcp` |
| **OpenAPI 3.1 Spec URL** | `https://www.livecore.ai/openapi.json` |
| **Protected Resource Metadata (RFC 9728)** | `https://api.livecore.ai/.well-known/oauth-protected-resource/api/v1/misc/mcp` |
| **Authorization Server Metadata (RFC 8414)** | `https://api.livecore.ai/.well-known/oauth-authorization-server` |
| **Dynamic Client Registration (RFC 7591)** | `https://api.livecore.ai/api/v1/misc/oauth/register` |
| **Authorize URL** | `https://api.livecore.ai/api/v1/misc/oauth/authorize` |
| **Token URL** | `https://api.livecore.ai/api/v1/misc/oauth/token` |
| **OAuth 2.1 Scope** | `levea` (PKCE `S256`) |
| **Pre-Registered Composio OAuth Client ID** | `lvo_client_867566272b21454140ac932b52a6fe6f` |
| **Pre-Registered Arcade OAuth Client ID** | `lvo_client_f41b0c79f8306e6e5888acb36469dd84` |
| **Bearer API Key Header (Alternative Auth)** | `Authorization: Bearer <LEVEA_API_KEY>` (free key at `https://livecore.ai`) |
| **Icon (512×512 PNG)** | `https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/mcp-server/icon-512.png` |

---

## 2. Paste-Ready Description

> Autonomous cloud GPU AI video editor exposed over MCP (`https://api.livecore.ai/api/v1/misc/mcp`, 37 annotated tools) and OpenAPI (`https://www.livecore.ai/openapi.json`). Turn natural-language prompts or long recordings into viral vertical clips (9:16 active-speaker face tracking), 280+ GPU-accelerated animated caption templates, split-screen multicam podcasts, B-roll, 2D/3D motion graphics, voiceover, music, and verified MP4 exports.
