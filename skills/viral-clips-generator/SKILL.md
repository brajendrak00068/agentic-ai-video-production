---
name: viral-clips-generator
description: "Identify high-engagement moments in long-form recordings and extract standalone short-form video clips."
version: 1.1.7
author: brajendrak00068
license: MIT
---

# Highlight Clip Extractor

Identify high-engagement moments in long-form recordings and extract standalone short-form video clips.

## When to use

- Extracting multiple standalone highlight clips from a long lecture, interview, or stream.
- Selecting segments based on transcript hooks and narrative peaks.
- Batch-exporting short clips with vertical reframing and captions.

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
  "prompt": "Extract 3 standalone 30-second highlight clips from the most engaging moments in this recording.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Transcript and narrative peak analysis for highlight selection.
- Batch subclip extraction with independent timelines.
- Optional 9:16 vertical reframing and captioning per extracted clip.
- Consolidated MP4 and archive delivery.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
