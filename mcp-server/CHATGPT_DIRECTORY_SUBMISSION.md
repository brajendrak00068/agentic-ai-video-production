# ChatGPT Directory Submission Package — Levea — AI Video Editor (LiveCore AI)

Everything needed to submit Levea as a plugin in the **ChatGPT + Codex universal
directory** via the plugin submission portal (platform.openai.com/plugins).
Requirements verified against OpenAI's live docs (developers.openai.com/plugins),
2026-11-05. `[VERIFY]` = fact only the owner can confirm — check before submitting.

Companion doc: `MUSE_CONNECTOR_SUBMISSION.md` (Meta Muse connector — same endpoint,
same tools, ~85% shared material).

---

## 0. Readiness status

| Requirement | Status |
|---|---|
| Public MCP endpoint (universal URL — one endpoint for all users) | ✅ **LIVE** — `https://api.livecore.ai/api/v1/misc/mcp` (Streamable HTTP, stateless) |
| OAuth for MCP | ✅ OAuth 2.1 + PKCE; **RFC 7591 dynamic client registration** (`/api/v1/misc/oauth/register`), RFC 8414 + RFC 9728 well-known metadata, `/openai-apps-challenge` endpoint already in prod |
| API-key auth for review test creds (no MFA) | ✅ `Authorization: Bearer <key>` — keys never need SMS/email codes |
| Tool annotations (`readOnlyHint` / `destructiveHint` / `openWorldHint`) | ✅ All 25 tools annotated (`src/server.ts` `TOOL_ANNOTATIONS`); enforced at server build — a tool without annotations throws |
| Logo | ✅ `icon-512.png` (512×512) `[VERIFY: portal's exact logo spec]` |
| Organization verification | ❌ Human — see §1 |
| `api.apps.write` permission | ❌ Human — see §1 |
| Privacy policy URL | ⚠️ `https://www.livecore.ai/privacy` (linked from README) `[VERIFY]` |
| Test account + prompts | ⚠️ Drafted in §5 — owner creates the key |
| Response-field audit (privacy trap) | ⚠️ Checklist drafted in §4 — run before submitting |

---

## 1. Prerequisites (human, ~15 minutes, before touching the portal)

1. **Organization verification** — OpenAI Platform Dashboard → org settings →
   complete **business verification** under the exact publish name (**LiveCore AI**).
   Enforced during review; an unverified name is an automatic rejection.
2. **Permissions** — org owners automatically hold `api.apps.write` / `api.apps.read`;
   grant them to any non-owner who will manage the submission (Dashboard → roles).
3. **Data residency** — submit from a project with **global** data residency;
   EU-residency projects cannot submit MCP plugins.
4. Have at hand: `icon-512.png`, privacy policy URL, terms URL, support email,
   the test account's API key (§5, step 0).

---

## 2. Portal flow + paste-ready values

Portal: **platform.openai.com/plugins** → create plugin → add MCP server details.

**Step 1 — MCP server.**

```
MCP Server URL:  https://api.livecore.ai/api/v1/misc/mcp
                 (universal URL — do NOT choose Template)
```

- **Authentication: OAuth.** Discovery is automatic: the endpoint's 401 carries the
  RFC 9728 protected-resource challenge → authorization-server metadata (RFC 8414) →
  dynamic client registration (RFC 7591) — no manual client credentials should be
  needed. `[VERIFY: if the portal requires a static client_id/secret, register a
  client via POST /api/v1/misc/oauth/register and paste those credentials.]`
- **Review test credentials:** provide the test account's **API key** (§5 step 0).
  Keys need no MFA, satisfying the "no further configuration" rule.
  `[VERIFY: exactly how the portal wants the key delivered — connection setting or
  credential field.]`

**Step 2 — Scan Tools.** Verify the import matches §3 exactly (25 tools, titles,
annotations, schemas, instructions). If anything is stale or wrong: fix the server,
deploy, **Scan Tools again**, then submit. Justifications must match the advertised
annotations — never argue a tool is "functionally read-only" against a
`readOnlyHint: false` advertisement (their docs call this out explicitly).

**Step 3 — Submission form.**

```
Plugin name:        Levea — AI Video Editor
Company:            LiveCore AI
Website:            https://livecore.ai
Privacy policy:     https://www.livecore.ai/privacy          [VERIFY]
Terms:              [VERIFY URL]
Support email:      brajendra@livecore.ai                    [VERIFY monitored]
Logo:               icon-512.png (512×512)
Localization:       English                                  [VERIFY portal options]
Payments:           No in-connector checkout; edits consume the user's
                    Levea plan on livecore.ai                [VERIFY disclosure wording]
```

**Short description (paste-ready):**

> Autonomous AI video editor. Say the edit — Levea plans, executes, verifies, and
> exports the finished video. Podcast-to-reels, captions, B-roll, music, vertical
> reframe, voiceover, and cloud MP4 export from one sentence.

**Long description (paste-ready):**

> Levea is an autonomous AI video-production platform. Delegate complete editing
> workflows in natural language: turn long podcasts and interviews into vertical
> reels with captions; add professional transitions, kinetic typography, B-roll,
> music and sound effects; reframe to 9:16 with speaker tracking; clean up silence
> and filler words; generate AI voiceover; color grade; and export platform-ready
> MP4s. Long renders run as trackable jobs with status polling until the export is
> ready. Destructive operations are approval-gated, and every result carries a
> verification report. Requires a Levea account (free tier available).

**Step 4 — confirmations + Submit for review.** One version in review at a time per
MCP integration; to amend, **Cancel Review** and resubmit the same draft. Status by
email + portal. If rejected: the email names the failed checks — fix and resubmit
(§7 playbook); appeals go by replying to that email.

Optional (not required for v1): package **skills** (repeatable workflows such as
"podcast-to-reels") with the plugin later for better discovery and UX. `[OPTIONAL]`

---

## 3. Annotation justification table (what Scan Tools imports and reviewers grade)

Source of truth: `src/server.ts` `TOOL_ANNOTATIONS` (2026-11-05). "—" = hint absent.

| Tool | Title | readOnly | destructive | openWorld | Why the hints match behavior |
|---|---|---|---|---|---|
| `autonomous_edit` | Edit video | false | true | true | Mutates the project and can cut/replace/remove content irreversibly within the edit; fetches arbitrary public media URLs (YouTube, CDN) so it reaches the open web. Safeguard: `requirePlanApproval` pauses before execution. |
| `autonomous_edit_streaming` | Edit video (live progress) | false | true | true | Same behavior with per-step progress events. |
| `queue_edit` | Queue video edit | false | true | true | Same behavior, asynchronous (`taskId` → `check_task_status`). |
| `check_job_status` | Check job status | true | — | false | Polls a render/generation job in the caller's own account. |
| `check_task_status` | Check task status | true | — | false | Polls a queued edit in the caller's account. |
| `get_active_task` | Get active task | true | — | false | Reads the project's in-flight task. |
| `list_caption_templates` | List caption templates | true | — | false | Lists built-in + the caller's saved templates. |
| `apply_caption_template` | Apply caption template | false | false | false | Restyles captions in a project; reversible by re-applying another template. |
| `save_caption_template` | Save caption template | false | false | false | Creates/updates a named template owned by the caller. |
| `save_current_caption_template` | Save current captions as template | false | false | false | Saves the project's caption styling as a template. |
| `delete_caption_template` | Delete caption template | false | true | false | Irreversible deletion of a saved template. |
| `list_brand_kits` | List brand kits | true | — | false | Reads the caller's brand kits. |
| `get_brand_kit` | Get brand kit | true | — | false | Reads one brand kit. |
| `create_brand_kit` | Create brand kit | false | false | false | Adds a new kit; overwrites nothing. |
| `update_brand_kit` | Update brand kit | false | **true** | false | **Overwrites an existing kit in place — the previous definition is not recoverable.** Deliberately destructive-annotated; expect reviewers to probe this one. |
| `delete_brand_kit` | Delete brand kit | false | true | false | Irreversible deletion. |
| `list_projects` | List projects | true | — | false | Reads the caller's projects. |
| `get_project` | Get project | true | — | false | Reads one project. |
| `create_project` | Create project | false | false | false | Creates an empty project. |
| `delete_project` | Delete project | false | true | false | Irreversible deletion of project + scenes. |
| `asset_upload_url` | Get asset upload URL | false | false | false | Issues a signed PUT URL; the upload creates a stored asset in the caller's account (bounded — no open-world reach). |
| `list_assets` | List assets | true | — | false | Reads the caller's media gallery. |
| `delete_asset` | Delete asset | false | true | false | Irreversible deletion of media. |
| `transcribe_asset` | Transcribe asset | false | false | false | Creates a transcript artifact for an asset already in the caller's account. |
| `editor_health` | Check editor health | true | — | false | Unauthenticated connectivity probe; returns backend health only. |

Reads intentionally omit `destructiveHint` (absence = not destructive). If OpenAI's
scanner prefers an explicit `false`, add it to the `read()` helper, redeploy, rescan.
`[VERIFY after first Scan Tools]`

---

## 4. Response-field audit (the privacy-policy trap — named rejection reason #3)

Their reviewers run realistic requests, list **every user-related field the server
returns** (including nested and debug payloads), and reject on anything not disclosed
in your privacy policy. Rule: **remove rather than disclose** where possible.

- [x] **`raw` backend payloads are NOT surfaced in tool output** — verified in
  `src/server.ts` (only `raw.type` is read for outcome mapping). Re-verify after any
  server change before rescanning.
- [ ] Enumerate `structuredContent` per tool group: edit results (`reply`,
  `workingMemory`, `verificationReport`, `quality`, `modelsUsed`, `videoUrl`,
  `jobId`), management CRUD objects (project/asset/brand/template fields), job/task
  status objects. Check each for internal identifiers (trace/session/request IDs,
  internal account IDs, debug timing) — strip what the user doesn't need. `[VERIFY]`
- [ ] No secrets ever in responses (API keys, tokens, signed internals). `[VERIFY]`
- [ ] Export URLs (`videoUrl`, `zip_url`): signed with expiry or public? Disclose
  how they're protected. `[VERIFY]`
- [ ] Privacy policy explicitly enumerates: prompts, uploaded media + media URLs,
  transcripts, project/scene metadata, render outputs, job/task statuses, account
  identifiers — with purposes, retention windows, subprocessors, and the
  **no-training** statement. `[VERIFY owner]`
- [ ] Dry-run their procedure: connect in ChatGPT dev mode with the test key, run 5
  realistic prompts, diff returned fields against the privacy-policy list. Fix
  mismatches on the server (preferred) or in the policy — never leave a field
  unexplained.

---

## 5. Test prompts + expected responses (form field)

Rejection reason #2 is "test cases did not produce correct results," so expected
results are worded to be unambiguous. **Note for reviewers (include in the form):**
a mutating edit plans + executes + exports and takes minutes; long edits may first
return `status: "running"` with a `taskId` — that is a *correct* response, and
`check_task_status` then tracks it to completion.

**Step 0 (owner, before filling the form):** create a dedicated test account
(`chatgpt-review@livecore.ai` `[VERIFY name]`), generate its API key, seed it: one
short talking-head video asset, one saved caption template, one brand kit, one
project named `ChatGPT Review Demo`.

| # | Prompt | Expected result |
|---|---|---|
| 1 | "What caption templates are available?" | `list_caption_templates` → list incl. built-in slugs (e.g. hormozi, karaoke, viral-pop) plus the saved template |
| 2 | "Show my projects" | `list_projects` → includes `ChatGPT Review Demo` |
| 3 | "Create a project called ChatGPT Review Sandbox" | `create_project` → confirmation with a project id |
| 4 | "I need to upload a video — give me an upload URL" | `asset_upload_url` → signed PUT URL + asset id |
| 5 | "Make a vertical clip with captions from my demo video" | `autonomous_edit` (or `queue_edit` → `taskId`) → completes or returns `running` + `taskId`; `check_task_status` tracks to terminal; final result carries a `videoUrl` |
| 6 | "Check the status of job \<id from #5\>" | `check_job_status` → one of queued/processing/completed/failed with progress |
| 7 | "Apply the hormozi caption style to my project" | `apply_caption_template` → confirmation; project captions restyled |
| 8 | "Delete the project ChatGPT Review Sandbox" | `delete_project` → destructive action; confirmation that the project was deleted |
| 9 | (no credential) any tool call | 401 with OAuth `WWW-Authenticate` challenge; with a bad key → guided re-auth error (no crash, no retry loop) |
| 10 | "Edit my demo video, but show me the plan first" | `autonomous_edit` with plan approval → `awaiting_approval` + plan; approving resumes execution |

---

## 6. After approval — the maintenance contract (OpenAI continuous review)

- **Tool metadata is a versioned contract.** OpenAI periodically re-scans your live
  server: deleted tools disappear from the listing immediately; new tools appear
  after automated checks; changed tools keep the old published definition until the
  update passes. Keep existing input schemas working while an update is held —
  roll back a breaking server deploy rather than waiting for review.
- **Origin is immutable per plugin** (`scheme`/`hostname`/`port`). Moving hosts =
  new plugin. Path-only changes ride the normal new-version flow.
- **Resubmissions** need release notes; each starts a fresh review.
- Plugins can be removed for inactivity/instability — keep `/api/v1/misc/mcp`
  healthy and monitored.
- Press/launch announcements: coordinate with press@openai.com first (their rule).

---

## 7. Rejection playbook (their four named reasons → our prep)

| Named rejection | Our preparation |
|---|---|
| Can't connect with the provided URL/credentials | API key (no MFA), works off our networks; test from a non-company network before submitting `[VERIFY]` |
| Test cases failed | §5 wording; run every prompt in ChatGPT dev mode first and paste observed-true expected results |
| Privacy policy doesn't disclose returned data | §4 audit — strip fields server-side first, disclose what remains |
| Annotation hints don't match behavior | §3 table; to change a classification, change the annotation in `TOOL_ANNOTATIONS`, redeploy, **Scan Tools** again — never justify against the advertisement |

---

## 8. One-page checklist

1. Owner: business-verify the OpenAI org as **LiveCore AI**; confirm `api.apps.write`; use a **global** data-residency project.
2. Owner: create test account + API key + seed data (§5 step 0).
3. Owner: verify every `[VERIFY]` — privacy/terms URLs, portal logo spec, payments wording, OAuth client-credential handling.
4. Run the §4 response-field audit; fix server-side first.
5. Portal: create plugin → MCP URL → OAuth → Scan Tools → verify against §3 → fill form (§2) → submit.
6. On rejection: the email names the failed checks — fix via §7 and resubmit (or appeal by reply).
