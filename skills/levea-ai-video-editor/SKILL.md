---
name: levea-ai-video-editor
description: "Plan, execute, and verify timeline video edits through the autonomous_edit MCP tool."
version: 1.1.7
author: brajendrak00068
license: MIT
---

# Levea Video Editor

Plan, execute, and verify timeline video edits through the autonomous_edit MCP tool.

## When to use

- Performing timeline edits such as trimming, reframing, captioning, and color grading.
- Composing text titles, overlays, and audio adjustments on a project scene.
- Exporting a verified timeline scene to MP4.

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
  "prompt": "Trim the video to 30 seconds, apply a warm color grade, add synchronized captions, and export as MP4.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Timeline trimming, splitting, and aspect-ratio reframing.
- Synchronized caption generation and title card overlays.
- Color grading, visual effects, and audio loudness balancing.
- Automated scene verification and MP4 rendering.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
