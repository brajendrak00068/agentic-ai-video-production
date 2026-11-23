---
name: levea-video-editing
description: "AI video editor and autonomous editing agent for TikTok, Reels, YouTube Shorts, and podcasts (levea_video_edit + 195 canonical actions). Use when the user wants to edit a video, cut silences, add 216 animated captions or subtitles, reframe 16:9 to 9:16 vertical, insert B-roll, motion graphics, VFX, color grading, voiceover, or export MP4."
version: 1.0.1
author: brajendrak00068
license: MIT
---

# Levea Video Editing

Levea supports two editing modes plus on-demand craft skills:
- **Mode A — Goal Delegation (`levea_video_edit`):** Send the complete user intent as one natural-language `prompt`; Levea's autonomous editing agent inspects, executes, verifies, repairs, and exports.
- **Mode B — Direct Canonical Tools (`levea_search_tools` → `levea_get_action_schema` → `levea_execute_action` / `levea_execute_batch` → `levea_render_preview` → `EXPORT_VIDEO`):** Drive any of the 195 canonical actions and 28 read tools directly on `project_id`, inspect GPU-composited JPEG screenshots via `levea_render_preview`, and export without invoking the planner.
- **Skills (`levea_search_skills` → `levea_load_skill` → `levea_read_skill_resource`):** Search and load any of Levea's 100+ built-in production craft `SKILL.md` playbooks on demand, or combine them with custom user skills in `~/.hermes/skills/`.

## When to use

- Trimming, cutting, 9:16 vertical reframing, viral clips from long videos.
- Captions (caption templates such as `hormozi`, `viral-pop`, `karaoke`, `subtitle-bar`, and 216 more; name the look in the prompt or pass `captionTemplatePreset`), titles, overlays, motion graphics.
- B-roll, multicam podcast sync, audio cleanup, music, voiceover, color grading.
- Exporting the verified timeline to MP4.

## Workflow

1. First call: pass `prompt` plus `video_url` (or `assets`). Save the returned `projectId`.
2. Follow-up edits: always pass the same `project_id`, so edits stack on the committed project.
3. Read `status` and `success` from the result:
   - `success: true` means the backend verified the edit. Report `videoUrl` when present.
   - `pending` with a `jobId`: call `levea_job_status` with `wait: true` to get the rendered file.
   - `awaiting_approval`: show the plan to the user; when they agree, resend with the returned `workingMemory` and `planDecision: "approve"` (optionally an `editedPlan`). To change the plan, send a new prompt with the same `workingMemory`.
   - `running` (`STILL_RUNNING`): the edit outlived the wait and keeps running; call `levea_active_task` with the `project_id`, never run the edit again.
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
