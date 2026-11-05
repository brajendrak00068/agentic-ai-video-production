---
name: levea-video-editor
description: Edit videos with Levea from a plain-language brief - viral clips, captions, 9:16 reframe, motion graphics, music, multicam, and MP4 export - through the hosted Levea MCP tools. Use when the user wants to edit, cut, caption, reframe, or export a video.
---

# Levea video editing

Levea is a hosted video editor that is itself an agent: send the user's brief to `autonomous_edit` and it plans, edits, checks the result on the rendered frames, and exports an MP4. The tools come from the `levea` MCP server bundled with this plugin; on first use, run `/mcp`, select **levea**, and sign in.

## Workflow

1. **Get the source.** Edits need a public video URL (direct MP4, Google Drive, Dropbox, YouTube) passed as `video_url` or `assets`. For a local file, call `asset_upload_url`, upload the file to the returned URL, and pass the resulting asset URL.
2. **Send the brief verbatim** to `autonomous_edit` as `prompt`. Do not split one request into several calls; the editor plans multi-step edits itself.
3. **Keep the `project_id`** from the response and pass it on every follow-up edit of the same video.
4. **Long edits.** A full edit with motion graphics, music, and export can take 10-20 minutes. Prefer `queue_edit` (returns a `taskId`, then poll `check_task_status`) for those. If `autonomous_edit` returns `status: "running"`, the edit is still going: call `get_active_task` with the `project_id`; never start the edit again.
5. **Plan approval.** For destructive or costly work set `requirePlanApproval: true`. On `status: "awaiting_approval"`, show the plan; when the user agrees, call again with the returned `workingMemory` and `planDecision: "approve"`.
6. **Report honestly.** Give the user `videoUrl`. Read `verificationReport.status`: only `verified` means the result passed its checks; otherwise say what `verificationReport` and `qualityNotes` report.

## Tips

- Name caption looks in the prompt ("Hormozi-style", "karaoke", "Spotlight") or pass `captionTemplatePreset`; `list_caption_templates` lists exact ids.
- Brand kits (`list_brand_kits`, `create_brand_kit`) carry colors, fonts, logo, and grading; pass `brandId`.
- Read-only questions about a video ("what does the transcript say?") go to `autonomous_edit` too and don't trigger an export.
