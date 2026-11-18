# Levea Video Editor — Hermes plugin

Levea is an **AI video editor** and agentic video editing agent for [Hermes Agent](https://hermes-agent.nousresearch.com),
built for creators, podcasters, YouTubers and marketing teams. Describe the edit in plain language; the Levea
backend plans it, edits the timeline, verifies the result on the rendered frames, and exports a publish-ready MP4.

Use natural-language prompts to turn long-form videos, podcasts and interviews into short-form viral clips,
YouTube Shorts, Instagram Reels and TikToks: trim, 9:16 vertical reframe with active-speaker face tracking,
automatic animated captions, B-roll, multicam podcast editing, audio cleanup, music, AI voiceover, color grading,
motion graphics, and MP4 export.

## Install

```bash
hermes plugins install levea-video-editor
hermes plugins enable levea-video-editor
```

Hermes prompts for `LEVEA_API_KEY` at install. Get a key at [livecore.ai](https://livecore.ai).
Optional: `LEVEA_API_URL` (defaults to `https://api.livecore.ai`).

## Tools

| Tool | Purpose |
|---|---|
| `levea_video_edit` | Run a natural-language edit; returns the verified result, `projectId`, and `videoUrl`/`jobId`. |
| `levea_queue_edit` | Queue a long-running edit for a `project_id`; returns a `taskId`. |
| `levea_job_status` | Read an export/render job; `wait: true` polls until it finishes (up to 10 min). |
| `levea_task_status` | Read a queued edit by `taskId`. |
| `levea_active_task` | Reconnect to the running edit for a `project_id`. |
| `levea_search_tools` | Search all 189+ canonical editing actions, 13 read tools, and preset catalogs (`captions`, `vfx`, `transitions`, `color_presets`, `title_cards`, `fonts`, `blend_modes`). |
| `levea_get_action_schema` | Fetch the full JSON inputSchema and parameter constraints for any canonical action or read tool. |
| `levea_execute_action` | Execute any single canonical action or read tool directly on a project scene. |
| `levea_execute_batch` | Execute an ordered batch of canonical actions in one atomic round-trip with automatic timeline reconciliation and project commit. |
| `levea_render_preview` | Render GPU-composited JPEG screenshots at specified timestamps for visual inspection before `EXPORT_VIDEO`. |
| `levea_search_skills` | Search 100+ production craft skills (`SKILL.md` playbooks across editing, color grading, captions, audio, motion graphics, VFX). |
| `levea_load_skill` | Load the full craft playbook (`SKILL.md`) and resource list for one or more skill IDs. |
| `levea_read_skill_resource` | Read a bundled reference or template file belonging to a production skill. |
| `levea_asset_upload_url` | Get a signed PUT URL to upload a local media file so its `fileUrl` can be passed to `video_url` or `assets`. |

A bundled skill, `levea-video-editor:levea-video-editing`, teaches the agent the edit → poll → follow-up workflow.

## Disclosures

- **Network:** every tool call sends your prompt, source URLs/assets, and project ids to the Levea API
  (`https://api.livecore.ai`, or `LEVEA_API_URL`) with your `LEVEA_API_KEY`. Source videos at the URLs you pass are
  downloaded and processed by Levea.
- **Usage:** edits and exports consume your Levea account quota. Tool calls run without an extra approval prompt.
- **Long calls:** `levea_video_edit` and `levea_job_status` with `wait: true` can block for up to 10 minutes. A full edit with motion graphics and export can take longer; the call then returns the `project_id` and the edit keeps running (follow it with `levea_active_task`, or use `levea_queue_edit` for long edits).
- **No telemetry pings.** Requests identify the client as `hermes-plugin/<version>` (`X-Levea-Client`). No background processes, no shell commands, no files read or written outside the plugin.
- Credentials are read only through Hermes's secret scope.

## License

MIT
