---
name: silence-removal-audio-cleanup
description: "Remove dead air, pauses, and filler words from video and audio timelines with automatic music ducking."
version: 1.1.7
author: brajendrak00068
license: MIT
---

# Silence Removal and Audio Cleanup

Remove dead air, pauses, and filler words from video and audio timelines with automatic music ducking.

## When to use

- Removing silent pauses and dead air from spoken-word recordings.
- Trimming filler words and tightening conversational pacing.
- Balancing dialogue loudness and ducking background music under speech.

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
  "prompt": "Remove silences longer than 0.5 seconds, cut filler words, and normalize dialogue audio to -14 LUFS.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Silence and pause detection with frame-accurate timeline trimming.
- Filler-word removal and breath attenuation.
- Sidechain auto-ducking of background music under spoken dialogue.
- Broadcast loudness normalization and vocal clarity EQ.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
