---
name: auto-captions-subtitles
description: "Generate synchronized word-by-word animated captions and translated subtitles for video timelines."
version: 1.1.7
author: brajendrak00068
license: MIT
---

# Auto Captions and Subtitles

Generate synchronized word-by-word animated captions and translated subtitles for video timelines.

## When to use

- Generating word-level synchronized captions from a video audio track.
- Styling subtitles with built-in typography presets such as karaoke or pill highlights.
- Translating timeline captions into another language.

## Setup & Authentication

1. Generate a free API key at `https://www.livecore.ai/?openclaw=1` and set `LEVEA_API_KEY` in your environment or OpenClaw plugin config (`LEVEA_API_URL` defaults to `https://api.livecore.ai`).
2. Ensure the OpenClaw plugin (`openclaw plugins install openclaw-ai-video-editor`) or MCP server (`npx -y levea-mcp-server`) is installed so the `ai-video-editor` / `autonomous_edit` tool is registered.

## Tool interface

Use the registered `ai-video-editor` (OpenClaw plugin) or `autonomous_edit` (MCP server) tool to run edits against a project timeline.

### Tool parameters

- `prompt` (string, required): Description of the video edit to perform.
- `project_id` (string, optional): Project identifier returned by a prior call for multi-turn continuity.
- `video_url` (string, optional): Source video URL when starting a new project.
- `captionTemplatePreset` (string, optional): Built-in caption style slug (for example `hormozi`, `viral-pop`, `karaoke`, `minimal-pro`).
- `captionTemplateMode` (string, optional): One of `add`, `recreate`, `style`, `translate`, `clear`, `remove_fillers`.
- `requirePlanApproval` (boolean, optional): When `true`, pauses after planning and returns `workingMemory` for user confirmation.
- `workingMemory` (object, optional): State object from a paused plan-approval call.

### Example tool input

```json
{
  "prompt": "Generate word-by-word captions at the bottom of the frame using the viral-pop preset.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Speech-to-text word timing alignment on the active timeline.
- Built-in caption templates including karaoke, word-pill, typewriter, and minimal subtitle bars.
- Safe-zone placement that avoids covering faces and lower-third graphics.
- Multi-language subtitle translation.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
