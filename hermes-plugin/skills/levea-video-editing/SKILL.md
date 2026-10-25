---
name: levea-video-editing
description: "Plan, run, and verify video edits with the Levea autonomous editor tools (levea_video_edit, queue and status polling)."
version: 1.0.0
author: brajendrak00068
license: MIT
---

# Levea Video Editing

Use the `levea_video_edit` tool to perform video edits. Send the complete user intent as one natural-language
`prompt`; the Levea backend plans, executes, verifies, repairs, and exports. Do not split one request into many
small tool calls.

## When to use

- Trimming, cutting, 9:16 vertical reframing, viral clips from long videos.
- Captions (caption templates such as `hormozi`, `viral-pop`, `karaoke`, `minimal-pro`), titles, overlays, motion graphics.
- B-roll, multicam podcast sync, audio cleanup, music, voiceover, color grading.
- Exporting the verified timeline to MP4.

## Workflow

1. First call: pass `prompt` plus `video_url` (or `assets`). Save the returned `projectId`.
2. Follow-up edits: always pass the same `project_id`, so edits stack on the committed project.
3. Read `status` and `success` from the result:
   - `success: true` means the backend verified the edit. Report `videoUrl` when present.
   - `pending` with a `jobId`: call `levea_job_status` with `wait: true` to get the rendered file.
   - `awaiting_approval`: show the plan to the user; resend with `workingMemory` (and optional `editedPlan`) to continue.
   - `partial` or `error`: tell the user what failed using `message`; do not claim success.
4. For very long edits use `levea_queue_edit` (requires `project_id`) and poll `levea_task_status`.
   If a connection drops mid-edit, `levea_active_task` reconnects to the running edit for a project.

## Example

```json
{
  "prompt": "Cut this podcast into a 30 second 9:16 reel around the strongest hook, add bold animated captions, and export MP4.",
  "video_url": "https://example.com/podcast.mp4"
}
```
