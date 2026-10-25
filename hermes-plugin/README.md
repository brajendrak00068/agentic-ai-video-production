# Levea Video Editor — Hermes plugin

Agentic AI video editing for [Hermes Agent](https://hermes-agent.nousresearch.com). Describe the edit in plain
language; the Levea backend plans it, edits the timeline, verifies the result, and exports an MP4.

Trim, 9:16 vertical reframe, viral clips, animated captions, B-roll, multicam podcast sync, audio cleanup, music,
voiceover, color grading, motion graphics, and MP4 export.

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

A bundled skill, `levea-video-editor:levea-video-editing`, teaches the agent the edit → poll → follow-up workflow.

## Disclosures

- **Network:** every tool call sends your prompt, source URLs/assets, and project ids to the Levea API
  (`https://api.livecore.ai`, or `LEVEA_API_URL`) with your `LEVEA_API_KEY`. Source videos at the URLs you pass are
  downloaded and processed by Levea.
- **Usage:** edits and exports consume your Levea account quota. Tool calls run without an extra approval prompt.
- **Long calls:** `levea_video_edit` and `levea_job_status` with `wait: true` can block for up to 10 minutes.
- **No telemetry**, no background processes, no shell commands, no files read or written outside the plugin.
- Credentials are read only through Hermes's secret scope.

## License

MIT
