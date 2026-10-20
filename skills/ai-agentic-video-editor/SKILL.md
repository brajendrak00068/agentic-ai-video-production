---
name: ai-agentic-video-editor
description: "Compile and execute multi-step video editing plans with automated timeline verification."
version: 1.1.7
author: brajendrak00068
license: MIT
---

# Autonomous Timeline Video Editor

Compile and execute multi-step video editing plans with automated timeline verification.

## When to use

- Executing multi-step video editing briefs in a single tool call.
- Previewing an edit plan with requirePlanApproval before applying changes.
- Verifying timeline continuity and exporting MP4 output.

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
  "prompt": "Reframe the video to 9:16, remove silences, add bottom captions, and verify timeline layout.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Structured multi-step edit planning and dependency ordering.
- Optional plan approval pause and resume via workingMemory.
- Post-edit geometry and timeline verification.
- Synchronous and queued MP4 rendering.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
