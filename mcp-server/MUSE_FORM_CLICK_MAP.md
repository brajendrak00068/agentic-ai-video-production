# Muse Submission Form — Complete Click Map (Levea — AI Video Editor)

Field-by-field actions for https://platform.muse.ai/submission, built from Meta's
official Connector Guidelines §5 and Terms (verified 2026-11-05). Structure follows
the documented stages; if the live form shows a field not listed here, paste just
that field into chat and it gets mapped on the spot.

Legend: ✅ = check/enable · ⬜ = leave off · ⌨️ = paste value · ⚠️ = resolve the
`[VERIFY]` in MUSE_CONNECTOR_SUBMISSION.md first.

---

## Step 0 — have these open before you start (5 min)

- `mcp-server/icon-512.png` (512×512 icon, already exported)
- Test account: email + API key + seeded media (MUSE doc §6, step 0)
- Privacy policy URL: `https://www.livecore.ai/privacy` ⚠️
- Terms of service URL ⚠️
- Support email: `brajendra@livecore.ai` ⚠️

---

## Stage A — Connector overview

| Element | Action | Value |
|---|---|---|
| Connector name | ⌨️ | `Levea — AI Video Editor` |
| Company | ⌨️ | `LiveCore AI` |
| Product website | ⌨️ | `https://livecore.ai` |
| Short description | ⌨️ | `Autonomous AI video editor. Say the edit — Levea plans, executes, verifies, and exports the finished video. Podcast-to-reels, captions, B-roll, music, vertical reframe, voiceover, and cloud MP4 export from one sentence.` |
| Long description / what it does | ⌨️ | Paste the full "Supported tasks" + "Value beyond the browser" block from MUSE doc §2 |
| Example prompts (5) | ⌨️ | `Turn my 60-minute podcast into 10 viral reels.` / `Edit this video with professional transitions and kinetic typography.` / `Find the best moments and generate vertical clips.` / `Add captions, B-roll, music and sound effects.` / `Create a complete YouTube-ready video.` |
| Icon upload | ⌨️ | `mcp-server/icon-512.png` |
| Category (if asked) | ⌨️ | Closest to Creativity/Productivity/Video — pick from live options ⚠️ |
| **Payments / transactions opt-in** | ⬜ **OFF** | No in-connector checkout. Edits consume the user's Levea plan on livecore.ai. Enabling this is a false declaration (Terms accuracy duty + §4.7 transaction rules would apply). |
| Contact name / work email | ⌨️ | `brajendra@livecore.ai` ⚠️ |
| Support contact | ⌨️ | same ⚠️ |
| Privacy policy URL | ⌨️ | `https://www.livecore.ai/privacy` ⚠️ |
| Terms URL | ⌨️ | ⚠️ |

## Stage B — Technical specifications

| Element | Action | Value |
|---|---|---|
| **Connection type** | ✅ | **Existing MCP** — NOT "Raw API". This is the single most important pick. |
| MCP endpoint | ⌨️ | `https://api.livecore.ai/api/v1/misc/mcp` |
| Transport (if asked) | ⌨️ | `Streamable HTTP (stateless)` |
| MCP/API documentation URL | ⌨️ | `https://github.com/brajendrak00068/agentic-ai-video-production/blob/main/mcp-server/README.md` ⚠️ (or the repo AGENTS.md link) |
| **Authentication methods** | ✅ check BOTH | **OAuth with PKCE** ✅ + **API keys** ✅. (OAuth metadata auto-discovered via the endpoint's RFC 9728 challenge; RFC 7591 dynamic registration at `/api/v1/misc/oauth/register` — no manual client credentials.) |
| Other auth | ⬜ | none |
| Account / plan / regional restrictions | ⌨️ | `Requires a Levea account (free tier available). Usage limits follow the user's plan. No regional restrictions.` ⚠️ (last sentence) |
| Tool classifications (if a section exists — §5.6 says portal annotation is "coming soon", otherwise they go in the docs) | ⌨️ | Paste the table from MUSE doc §5: **10 Read** (editor_health, list_projects, get_project, list_assets, list_caption_templates, list_brand_kits, get_brand_kit, check_job_status, check_task_status, get_active_task) · **11 Write** (autonomous_edit, autonomous_edit_streaming, queue_edit, create_project, create_brand_kit, update_brand_kit, apply_caption_template, save_caption_template, save_current_caption_template, asset_upload_url, transcribe_asset) · **4 Sensitive writes** (delete_project, delete_asset, delete_brand_kit, delete_caption_template — irreversible deletes, approval every use) |

## Data-processing questionnaire (§5.3)

Answer each question from MUSE doc §4 (draft answers written for you). Resolve the
⚠️ items BEFORE typing: subprocessors list, encryption-at-rest confirmation,
retention windows, account-deletion path/SLA, and confirm the privacy policy
contains the **no-training / no-secondary-use** sentence verbatim. Do not write
"never used for training" or "auto-deleted" anywhere unless your implementation
guarantees it — Meta reviews accuracy against the privacy policy.

## Business verification (§5.2)

| Element | Action |
|---|---|
| Legal entity name + evidence | ⌨️ ⚠️ owner only |
| Authorized brand assets | ⌨️ icon-512.png (+ wordmark if asked) |
| Support + security contacts | ⌨️ ⚠️ (security contact receives the 48h incident notices) |
| Developer responsible for maintenance | ⌨️ ⚠️ named person |
| Keep details consistent with website + listing | ✅ (their explicit rule) |

## Test credentials + demo (§5.5)

| Element | Action | Value |
|---|---|---|
| Test account sign-in / credential | ⌨️ | Test account API key (from §6 step 0) — no MFA, works immediately |
| Sign-in instructions | ⌨️ | `Connect with Authorization: Bearer <test key> — no further setup. Account is pre-seeded: one 30–60 min podcast video, 2–3 B-roll clips, one brand kit, one saved caption template, one project.` |
| Demo instructions | ⌨️ | Paste the 5-step reviewer script from MUSE doc §6 (viral-reels edit → caption template → brand kit + vertical export → delete_project sensitive-write approval → requirePlanApproval flow). Add the note: full edits take minutes; `status:"running"` + polling tools is the designed behavior. |
| Keep account accessible through review | ✅ | don't rotate the key, don't delete seeded media |

## Stage C — Review and submit

| Element | Action |
|---|---|
| "All information is true and accurate" | ✅ — ONLY after every ⚠️ above is resolved (Terms §2.1 makes accuracy your legal representation) |
| "Authorized to submit the product and brand assets" | ✅ (you are) |
| "Approval is not guaranteed" acknowledgment | ✅ |
| **Accept Muse Connector Terms + Policies** | ✅ — read first; binding duties: keep uptime/fix defects (§4.1), 48h incident notice to vendor-incident@meta.com (§4.3b), delete user data on revocation (§4.3f), no secondary use / no training (§4.2 policies), audit cooperation (§4.4) |
| **SUBMIT** | 👆 **your click** — this is the legal act; everything above is preparation for it |

---

## After the click

- Status: portal-only (§5.7); Meta does not answer status emails.
- Review: risk assessment → per-tool review → end-to-end QA (they will exercise the
  test account, including a sensitive-write approval on a `delete_*` tool).
- If a tool is rejected or a question lands: MUSE doc §8 + the compliance notes in §7
  have the fix path for everything they typically flag.
