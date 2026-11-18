---
name: ai-agentic-video-editor
description: "Autonomous timeline AI video editor for TikTok, Reels, YouTube Shorts, and podcasts. Use when editing videos from natural language or canonical actions: smart jump cuts, silence removal, 9:16 active-speaker reframing, 280+ animated captions and subtitles, B-roll cutaways, After Effects motion graphics, VFX keying, color grading, voiceover, audio cleanup, and cloud MP4 export."
version: 1.0.32
author: brajendrak00068
license: MIT
---

# Autonomous Timeline Video Editor

Compile and execute multi-step video editing plans with automated timeline verification.

## Setup

This skill calls the Levea (livecore.ai) editing service, which requires a Levea account and API key.

1. Sign up and generate an API key at https://livecore.ai/?openclaw=1&utm_source=clawhub&utm_medium=skill&utm_campaign=ai-agentic-video-editor
2. Provide the key to the tool you use:
   - OpenClaw plugin `openclaw-ai-video-editor` (ClawHub): set `apiKey` in the plugin config.
   - MCP server `levea-mcp-server` (npm): set `LEVEA_API_KEY` in the MCP server config. `LEVEA_API_URL` is optional and defaults to `https://api.livecore.ai`.
3. Describe the edit you want in plain language; the tool returns a project ID and, after export, an MP4 URL.

## When to use

- Executing multi-step video editing briefs in a single tool call.
- Previewing an edit plan with requirePlanApproval before applying changes.
- Verifying timeline continuity and exporting MP4 output.

## Tool interface (Mode A: Goal Delegation vs. Mode B: Direct Canonical Tools)

- **Mode A — Goal Delegation (`autonomous_edit` / `ai-video-editor`):** Send the user's natural-language brief in `prompt`; the backend ReAct agent inspects the footage, executes actions iteratively, verifies rendered frames, and exports.
- **Mode B — Direct Canonical Tool Control (`search_tools` → `get_action_schema` → `execute_action` / `execute_batch` → `render_preview` → `EXPORT_VIDEO`):** Bypass `autonomous_edit` and drive any of the **189+ canonical actions** and **13 read/inspection tools** directly on `project_id`. Always execute in the 5-phase NLE order: (1) Inspect → (2) Structure & Cuts → (3) Visuals & Overlays → (4) Audio Mix → (5) Call `render_preview` to inspect real GPU-composited JPEG screenshots, fix any visual issue, then call `EXPORT_VIDEO`.

### Tool parameters

<!-- edit-contract:start (generated from contract/edit-contract.json — edit that file, then run node scripts/sync-contract.mjs) -->
- `prompt` (string, required): Description of the video edit to perform, in the user's own words.
- `project_id` (string, optional): Project identifier returned by a prior call; reuse it for every follow-up edit on the same video.
- `video_url` (string, optional): Public source video URL when starting a new project.
- `assets` (array, optional): Input media (video, image, audio) as public HTTP/HTTPS URLs.
- `scene` (object, optional): Existing scene/timeline state to continue editing (advanced).
- `captionTemplatePreset` (string, optional): Caption template id to apply: a builtin slug (e.g. `hormozi`, `viral-pop`, `karaoke`) or a saved template id. With the MCP server, `list_caption_templates` lists the exact ids; elsewhere, name the look in the prompt.
- `captionTemplateMode` (string, optional): How to apply `captionTemplatePreset`: one of `add`, `recreate`, `style`, `translate`, `clear`, `remove_fillers`.
- `requirePlanApproval` (boolean, optional): When `true`, pause after planning and return `workingMemory` for the user to approve.
- `workingMemory` (object, optional): State returned by a paused plan-approval call; send it back to resume.
- `editedPlan` (object, optional): The user's edited version of a plan returned by an approval pause.
- `planDecision` (string, optional): Set to `"approve"` to approve the plan from an approval pause; resend it with that response's `workingMemory`.
- `attachedImages` (array, optional): Reference image URLs for planning (style, branding).
- `style_reference_url` (string, optional): A reference video whose editing style the result should match (pacing, captions, framing, zooms, transitions, grade).
- `flaggedIssues` (array, optional): Specific problems the user flagged that this run must fix.
- `brandId` (string, optional): Brand kit to apply to this call.
- `projectBrandId` (string, optional): Default brand kit for the project; persists across calls.
- `core_only` (boolean, optional): Return only rendering-essential scene fields (smaller responses).
<!-- edit-contract:end -->

### Example tool input

```json
{
  "prompt": "Reframe the video to 9:16, remove silences, add bottom captions, and verify timeline layout.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Structured multi-step edit planning and dependency ordering.
- Optional plan approval: pause with workingMemory, then resume with planDecision "approve" or an edited plan.
- Every edit checked on the rendered frames, with an automatic repair loop and a typed verification report.
- Synchronous and queued MP4 rendering.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `verificationReport` (object): `status` is `verified`, `rejected`, `unverified`, or `not_applicable`, with each failed check and what repair tried.
- `qualityNotes` (array, optional): Advisory notes about the result.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
