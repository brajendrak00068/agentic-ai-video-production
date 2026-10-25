---
name: ai-b-roll-motion-graphics
description: "Insert contextual B-roll cutaways, animated data charts, lower thirds, and callout overlays on video timelines."
version: 1.0.2
author: brajendrak00068
license: MIT
---

# B-Roll and Motion Graphics Composer

Insert contextual B-roll cutaways, animated data charts, lower thirds, and callout overlays on video timelines.

## Setup

This skill calls the Levea (livecore.ai) editing service, which requires a Levea account and API key.

1. Sign up and generate an API key at https://livecore.ai/?openclaw=1&utm_source=clawhub&utm_medium=skill&utm_campaign=ai-b-roll-motion-graphics
2. Provide the key to the tool you use:
   - OpenClaw plugin `openclaw-ai-video-editor` (ClawHub): set `apiKey` in the plugin config.
   - MCP server `levea-mcp-server` (npm): set `LEVEA_API_KEY` in the MCP server config. `LEVEA_API_URL` is optional and defaults to `https://api.livecore.ai`.
3. Describe the edit you want in plain language; the tool returns a project ID and, after export, an MP4 URL.

## When to use

- Adding contextual B-roll cutaways timed to spoken topics on the primary video track.
- Generating animated data visualizations, stat callouts, and lower-third titles.
- Composing split-screen or picture-in-picture visual overlays.

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
  "prompt": "Add lower-third speaker titles at 0:03 and insert animated stat callout cards when metrics are mentioned.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Contextual B-roll placement aligned to transcript timestamps.
- Animated charts, stat counters, and lower-third title cards.
- Picture-in-picture and split-screen layout composition.
- Safe-zone aware positioning for landscape and vertical canvases.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
