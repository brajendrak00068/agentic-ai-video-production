---
name: multicam-podcast-video-editor
description: "Synchronize multi-camera podcast recordings by audio waveform and switch camera angles on the active speaker."
version: 1.0.2
author: brajendrak00068
license: MIT
---

# Multicam and Podcast Video Editor

Synchronize multi-camera podcast recordings by audio waveform and switch camera angles on the active speaker.

## Setup

This skill calls the Levea (livecore.ai) editing service, which requires a Levea account and API key.

1. Sign up and generate an API key at https://livecore.ai/?openclaw=1&utm_source=clawhub&utm_medium=skill&utm_campaign=multicam-podcast-video-editor
2. Provide the key to the tool you use:
   - OpenClaw plugin `openclaw-ai-video-editor` (ClawHub): set `apiKey` in the plugin config.
   - MCP server `levea-mcp-server` (npm): set `LEVEA_API_KEY` in the MCP server config. `LEVEA_API_URL` is optional and defaults to `https://api.livecore.ai`.
3. Describe the edit you want in plain language; the tool returns a project ID and, after export, an MP4 URL.

## When to use

- Aligning multiple camera angles and external audio tracks for a podcast or interview.
- Switching between speaker close-ups and wide two-shots based on active dialogue.
- Assembling a podcast episode with a highlight cold open.

## Tool interface

Use the registered `ai-video-editor` (OpenClaw plugin) or `autonomous_edit` (MCP server) tool to run edits against a project timeline.

### Tool parameters

- `prompt` (string, required): Description of the video edit to perform.
- `project_id` (string, optional): Project identifier returned by a prior call for multi-turn continuity.
- `video_url` (string, optional): Source video URL when starting a new project.
- `captionTemplatePreset` (string, optional): Built-in caption style slug (for example `hormozi`, `viral-pop`, `karaoke`, `subtitle-bar`); call `list_caption_templates` for the exact ids.
- `captionTemplateMode` (string, optional): One of `add`, `recreate`, `style`, `translate`, `clear`, `remove_fillers`.
- `requirePlanApproval` (boolean, optional): When `true`, pauses after planning and returns `workingMemory` for user confirmation.
- `workingMemory` (object, optional): State object from a paused plan-approval call.

### Example tool input

```json
{
  "prompt": "Sync all camera angles by audio waveform, switch to the active speaker with a 0.8s minimum shot hold, and add a 15-second cold open.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Audio-waveform alignment across multiple camera and microphone tracks.
- Active-speaker camera switching with hysteresis debouncing.
- Reaction-shot and wide two-shot cutaways.
- Cold-open highlight hook placement at the start of the timeline.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
