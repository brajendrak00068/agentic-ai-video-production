---
name: openclaw-ai-video-editor
description: "Edit project timelines and render MP4 videos using the ai-video-editor OpenClaw plugin tool."
version: 1.1.7
author: brajendrak00068
license: MIT
---

# OpenClaw Video Editor

Edit project timelines and render MP4 videos using the ai-video-editor OpenClaw plugin tool.

## When to use

- Running natural-language video timeline edits through the OpenClaw plugin.
- Continuing multi-turn edits on a committed project using project_id.
- Checking queued edit tasks and render job statuses.

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
  "prompt": "Configure a 9:16 vertical canvas, trim the clip to 20 seconds, add captions, and render to MP4.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Single-tool edit planning and execution via ai-video-editor.
- Revisioned project state persistence across multi-turn edits.
- Asynchronous task queueing and status polling via queue_edit and check_job_status.
- Verified MP4 export delivery.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
