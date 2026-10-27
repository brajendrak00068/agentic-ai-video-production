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

## Setup & Authentication

1. Generate a free API key at `https://www.livecore.ai/?openclaw=1` and set `LEVEA_API_KEY` in your environment or OpenClaw plugin config (`LEVEA_API_URL` defaults to `https://api.livecore.ai`).
2. Ensure the OpenClaw plugin (`openclaw plugins install openclaw-ai-video-editor`) or MCP server (`npx -y levea-mcp-server`) is installed so the `ai-video-editor` / `autonomous_edit` tool is registered.

## Tool interface

Use the registered `ai-video-editor` (OpenClaw plugin) or `autonomous_edit` (MCP server) tool to run edits against a project timeline.

### Tool parameters

<!-- edit-contract:start (generated from contract/edit-contract.json — edit that file, then run node scripts/sync-contract.mjs) -->
- `prompt` (string, required): Description of the video edit to perform, in the user's own words.
- `project_id` (string, optional): Project identifier returned by a prior call; reuse it for every follow-up edit on the same video.
- `video_url` (string, optional): Public source video URL when starting a new project.
- `assets` (array, optional): Input media (video, image, audio) as public HTTP/HTTPS URLs.
- `scene` (object, optional): Existing scene/timeline state to continue editing (advanced).
- `captionTemplatePreset` (string, optional): Caption template id to apply: a builtin slug (e.g. `hormozi`, `viral-pop`, `karaoke`) or a saved template id. Call `list_caption_templates` for the exact ids.
- `captionTemplateMode` (string, optional): How to apply `captionTemplatePreset`: one of `add`, `recreate`, `style`, `translate`, `clear`, `remove_fillers`.
- `requirePlanApproval` (boolean, optional): When `true`, pause after planning and return `workingMemory` for the user to approve.
- `workingMemory` (object, optional): State returned by a paused plan-approval call; send it back to resume.
- `editedPlan` (object, optional): The user's edited version of a plan returned by an approval pause.
- `attachedImages` (array, optional): Reference image URLs for planning (style, branding).
- `flaggedIssues` (array, optional): Specific problems the user flagged that this run must fix.
- `brandId` (string, optional): Brand kit to apply to this call.
- `projectBrandId` (string, optional): Default brand kit for the project; persists across calls.
- `core_only` (boolean, optional): Return only rendering-essential scene fields (smaller responses).
<!-- edit-contract:end -->

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
