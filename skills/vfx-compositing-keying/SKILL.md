---
name: vfx-compositing-keying
description: "Composite video layers with green screen chroma key (Keylight spill suppression), AI background removal without green screen, rotoscoping, color grading, .cube 3D LUTs, depth bokeh camera lens blur, glow, face blur, watermark removal, Bezier masks, and 328 GPU VFX."
version: 1.0.1
author: brajendrak00068
license: MIT
---

# VFX Compositing, Keying, Optics, and Color Finishing

Composite video layers with Keylight screen keying, spill suppression, depth-aware camera lens blur, two-tone threshold glow, ordered effect stacks, curves, selective color, .cube 3D LUTs, Bezier masks, and 29 blend modes.

## Setup

This skill calls the Levea (livecore.ai) editing service, which requires a Levea account and API key.

1. Sign up and generate an API key at https://livecore.ai/?openclaw=1&utm_source=clawhub&utm_medium=skill&utm_campaign=vfx-compositing-keying
2. Provide the key to the tool you use:
   - OpenClaw plugin `openclaw-ai-video-editor` (ClawHub): set `apiKey` in the plugin config.
   - MCP server `levea-mcp-server` (npm): set `LEVEA_API_KEY` in the MCP server config. `LEVEA_API_URL` is optional and defaults to `https://api.livecore.ai`.
3. Describe the edit you want in plain language; the tool returns a project ID and, after export, an MP4 URL.

## When to use

- Keying out green or blue screens with Keylight-style screen color key, Lab/YUV/RGB color range keying, and spill suppression, or isolating subjects without a green screen using AI alpha mattes.
- Applying optical camera effects on footage: depth-map-driven camera lens blur with polygonal iris bokeh, optical clip lens flares, and After Effects two-tone threshold glow.
- Stacking up to four ordered procedural effects on a single layer (`fx_stack`), applying custom SVG Bezier mask paths (`mask_path`), feathered/inverted mattes, track mattes, or placing titles and graphics behind the foreground subject (`occlusion: "behind_subject"`).
- Performing per-clip precision color work: monotone cubic RGB curves, CMYK per-hue selective color, 5-point histogram levels, and custom `.cube` 3D LUT files.

## Tool interface

Use the registered `ai-video-editor` (OpenClaw plugin) or `autonomous_edit` (MCP server) tool to run edits against a project timeline.

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
  "prompt": "Key out the green screen with Keylight screen color key and despill, blur the background clip with a hexagonal camera lens blur focused on the foreground subject, add a two-tone cyan-to-magenta threshold glow on the logo, and export as MP4.",
  "project_id": "project_example_01"
}
```

## Capabilities

- Keylight-grade `screen_color_key` (gain, balance, clip black/white, despill, softness, shrink/grow, preblur), `color_range_key` (Lab/YUV/RGB box + fuzziness), `spill_suppressor` (standard/ultra), and AI alpha-matte background replacement.
- Physical optics: `camera_lens_blur` (64-tap polygonal iris bokeh with highlight bloom and auto-estimated depth-map focal plane), `clip_lens_flare` (keyframable light source and prime/zoom lens presets), and After Effects two-tone threshold glow (`glow_threshold`, `glow_color`, `glow_color_b`, `glow_composite`).
- Precision color finishing: monotone cubic `curves` (master/R/G/B), CMYK per-range `selective_color` (reds through blacks), 5-point `levels`, custom `.cube` 1D/3D LUTs (`color_lut_url`), and 21 cinematic color looks.
- Layer compositing: 328 procedural VFX presets, ordered multi-effect stacks (`fx_stack`, up to 4 chained effects per layer), SVG Bezier `mask_path`, feathered/inverted mattes, track mattes, universal `occlusion: "behind_subject"`, and all 29 After Effects blend modes.

## Response fields

- `success` (boolean): True when the edit and verification passed.
- `status` (string): One of `completed`, `waiting`, `awaiting_approval`, or `failed`.
- `projectId` (string): Active project identifier for subsequent edits.
- `projectRevision` (number): Committed project revision number.
- `videoUrl` (string, optional): Rendered MP4 download URL when export completes.
- `verificationReport` (object): `status` is `verified`, `rejected`, `unverified`, or `not_applicable`, with each failed check and what repair tried.
- `qualityNotes` (array, optional): Advisory notes about the result.
- `jobId` (string, optional): Async render job identifier for status polling via `check_job_status`.
