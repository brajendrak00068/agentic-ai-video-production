---
name: ai-video-editor
description: "Edit video timelines with trimming, captions, aspect-ratio reframing, color grading, and MP4 export."
version: 1.1.7
author: brajendrak00068
license: MIT
---

# Timeline Video Editor

Edit video timelines with trimming, captions, aspect-ratio reframing, color grading, and MP4 export.

## When to use

- Trimming and arranging video and audio layers on a timeline.
- Adding captions, title cards, and visual styling to footage.
- Rendering finished timelines to MP4.

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
  "prompt": "Trim the first 15 seconds, add a centered title card, and apply a clean color grade.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Non-destructive layer trimming, splitting, and sequencing.
- Caption generation and typography preset styling.
- Color grading and audio level balancing.
- MP4 video export.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
