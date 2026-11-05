# Muse Connector Submission Package — Levea — AI Video Editor (LiveCore AI)

Everything needed to submit the Levea connector at **https://platform.muse.ai** → *Submit a connector*.
Section numbers map to the official Connector Guidelines (platform.muse.ai/docs). Fields marked
`[VERIFY]` state facts only the owner can confirm — check them before submitting; everything
else is paste-ready.

---

## 0. Readiness status

| Requirement | Status |
|---|---|
| MCP server (25 tools) | ✅ Published: npm `levea-mcp-server`, registry `io.github.brajendrak00068/levea-mcp-server` |
| Hosted Streamable HTTP transport (multi-tenant, per-request auth) | ✅ In production via misc-service `src/routes/mcp.routes.ts` (serves this package's 25 tools); `levea-mcp-http-server` binary added for self-host parity |
| **Public hosted endpoint** | ✅ **LIVE** — `https://api.livecore.ai/api/v1/misc/mcp` (Streamable HTTP; OAuth 2.1 + API-key Bearer; RFC 9728 challenge verified 2026-11-05) |
| OAuth 2.1 | ✅ Built-in authorization server (`McpOAuthService.ts`), scope `levea`; read-only-scope note in §5 |
| Backend API | ✅ Live: `https://api.livecore.ai/api/v1/misc/openclaw/v1/*` |
| Per-user auth | ✅ `LEVEA_API_KEY` → `Authorization: Bearer <key>`; no shared key in hosted mode (scoped config never reads env) |
| Async job pattern (§1.1 "preserve progress") | ✅ `jobId`→`check_job_status`, `taskId`→`check_task_status`, `status:"running"`→`get_active_task`, `awaiting_approval`→`planDecision` |
| Tool read/write/sensitive classification (§3.2, §5.6) | ✅ Documented in §4 below |
| Connector icon 512×512 | ⚠️ `icon.png` is 1024×1024 — export a 512×512 copy |
| Test account + demo (§5.5) | ❌ Owner creates (see §5) |
| Data-processing questionnaire (§5.3) | ⚠️ Drafted in §3 — owner verifies `[VERIFY]` items |
| Business verification (§5.2) | ❌ Human-only (see §2) |

---

## 1. Endpoint — already live (no deployment needed)

The hosted MCP endpoint runs in production today (misc-service `src/routes/mcp.routes.ts`,
serving this package's 25 tools — no forked tool list):

```
POST https://api.livecore.ai/api/v1/misc/mcp   (Streamable HTTP, stateless)
Auth: OAuth 2.1 + PKCE (built-in authorization server) or Authorization: Bearer <LEVEA_API_KEY>
```

Verify the OAuth challenge (expected: 401 + RFC 9728 `WWW-Authenticate`):

```bash
curl -i -X POST https://api.livecore.ai/api/v1/misc/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Optional self-host parity: the `levea-mcp-http-server` binary (`src/http-server.ts`,
`npm run start:http`) runs the same tool surface anywhere (`PORT` / `HOST` /
`LEVEA_MCP_PATH` env; unauthenticated health at `GET /health`). **Not needed for the
Muse submission** — submit the production URL above.

---

## 2. §5.1 Connector overview (paste-ready)

**Connector name:** Levea — AI Video Editor
**Company:** LiveCore AI
**Website:** https://livecore.ai
**MCP endpoint:** `https://api.livecore.ai/api/v1/misc/mcp` (Streamable HTTP, stateless — already live)
**Authentication:** OAuth 2.1 sign-in (preferred — Muse opens the Levea sign-in in the browser) or API key: users generate a personal key at https://livecore.ai and connect with it (`Authorization: Bearer <key>`). One click, free.

**Intended users.** Creators, podcasters, marketers, and businesses who need finished video
without editing skills — from short-form social clips to full YouTube-ready productions.

**Supported tasks.** Muse delegates a natural-language goal; Levea plans, executes, verifies,
and exports end-to-end:

- Turn long recordings (podcasts, webinars, interviews) into vertical clips and reels
- Captions with 60+ professional templates, B-roll, music, sound effects, beat sync
- Vertical reframe with speaker tracking, multi-cam edits, silence/filler cleanup
- AI voiceover and dubbing, color grading, motion graphics, chroma key, face/object blur
- Cloud MP4 export with per-platform presets; project, asset, brand-kit, and template
  management; render/job status polling

**Example Muse prompts.**

- "Turn my 60-minute podcast into 10 viral reels."
- "Edit this video with professional transitions and kinetic typography."
- "Find the best moments and generate vertical clips."
- "Add captions, B-roll, music and sound effects."
- "Create a complete YouTube-ready video."

**Value beyond the browser (§1.2).** A browser cannot edit video. Levea is an autonomous
editing agent: Muse hands it one sentence and receives a verified, rendered MP4 URL plus
job IDs for long renders. Progress is preserved across long operations — edits that outlive
a request return a resumable `running` status with polling tools, and destructive edits can
pause for plan approval (`requirePlanApproval`) before executing.

**Account / plan / regional restrictions.** Requires a Levea account (free tier available).
Usage limits follow the user's plan. `[VERIFY: any regional restrictions, or "none".]`

---

## 3. §5.2 Business verification (owner checklist)

- [ ] Legal entity name, address, and supporting evidence `[VERIFY]`
- [ ] Authorized brand assets — export `icon.png` (1024×1024) to **512×512**
- [ ] Privacy policy URL + product terms URL, both publicly accessible `[VERIFY: URLs]`
- [ ] Support contact and security contact `[VERIFY: emails]`
- [ ] Named developer responsible for maintenance `[VERIFY]`
- [ ] Accept Muse Connector Terms + Connector Policies (effective 2026-09-18) — **human sign-off**

Keep every field consistent with the company website and listing (§5.2 requires it).

---

## 4. §5.3 Data-processing questionnaire (draft answers)

**What data the connector accesses.** The user's text prompts, media the user uploads
(video/audio/images) or references, project/scene state, brand kits, caption templates,
account identifiers (user ID; API key used only as a Bearer credential), and derived
artifacts (transcripts, render outputs, job statuses).

**Why.** Each item is accessed only to fulfill the user's editing request and to provide,
maintain, secure, and support the connector (§4.2 of the guidelines).

**Protection.** TLS in transit. `[VERIFY: encryption at rest for media + DB]`.
Per-user data isolation; least-privilege access; secrets never logged (the hosted MCP
server logs only method/route/status/latency — never headers or bodies).

**Sharing / subprocessors.** `[VERIFY: list — e.g. cloud hosting, LLM planning providers,
TTS/music providers, render infra. State that each receives only what the request needs,
with no broader rights (Terms §4.3(e)).]`

**Retention.** User data is retained while the user's account/projects exist and only as
long as needed to fulfill requests. `[VERIFY: exact windows for media, transcripts,
render outputs, logs.]`

**Deletion.** Users delete projects, assets, brand kits, and templates through the
connector itself (`delete_*` tools) or via account deletion. When a user revokes Muse
access (API key revoked), no further access is possible; data is deleted or made
inaccessible per the privacy policy (Terms §4.3(f)). `[VERIFY: account-deletion path +
SLA]`

**Secondary uses.** None. No sale of user data, no unrelated advertising, no profiling,
**no model training on user data** (guidelines §4.2). `[VERIFY: privacy policy states this
verbatim]`

**Incident response.** Security incidents involving user data are reported to Meta
(vendor-incident@meta.com) within 48 hours (Terms §4.3(b), guidelines §4.8).
`[VERIFY: internal runbook names an owner]`

---

## 5. §5.4 Integration credentials & tool documentation

**Endpoint:** `https://api.livecore.ai/api/v1/misc/mcp` — MCP over Streamable HTTP,
stateless (POST only; GET/DELETE → 405 by design).
**Auth:** OAuth 2.1 + PKCE via the built-in authorization server (protected-resource
metadata at `/.well-known/oauth-protected-resource/api/v1/misc/mcp`; RFC 9728 challenge
on 401) — preferred — or `Authorization: Bearer <LEVEA_API_KEY>`; alternates
`x-levea-api-key` header / `?apiKey=` query for URL registries. Test credentials: see §6.
**Scopes:** single OAuth scope `levea` covering the tools below. Read-only scope option
(guidelines §3.1): not offered today. Mitigation for review: Muse asks on first use for
every write and on every use for sensitive writes, and destructive edits additionally
support plan approval. `[VERIFY: ship a levea.readonly scope before submission, or
answer this in review.]`
**Rate limits:** `[VERIFY: current per-key limits]`. Long-running operations use the async
job pattern instead of repeated calls; clients are instructed to poll, never re-invoke.

### Status & error handling (§1.1, §4.7)

- Mutating edits return a final `videoUrl`, or `jobId`/`taskId` + `status:"running"` for
  long work — poll `check_job_status` / `check_task_status`; never re-invoke to "check progress".
- `status:"awaiting_approval"` (plan-approval mode) — resume with `planDecision:"approve"`.
- Quoted vs. confirmed: a result is only reported complete with a terminal job status and
  `videoUrl`; `verificationReport.status:"verified"` means the rendered frames passed checks.
- 401/403 = bad/expired key (do not retry — regenerate); 5xx/network = retry once with
  backoff. All failures return `isError:true` with a structured `error`.

### Tool classification (§3.2 / §5.6 — annotate in the portal when §5.6 ships)

**Reads (10)** — retrieve information, no state change (full side-effect notes in the
table below). **Writes (11)** — create/change state. **Sensitive writes (4)** — the
irreversible `delete_*` tools.

| Tool | Class | Side effects |
|---|---|---|
| `editor_health` | Read | none; unauthenticated |
| `list_projects` / `get_project` | Read | none |
| `list_assets` | Read | none |
| `list_caption_templates` / `list_brand_kits` / `get_brand_kit` | Read | none |
| `check_job_status` / `check_task_status` / `get_active_task` | Read | none |
| `autonomous_edit` | **Write** | plans + executes a full edit; may auto-queue an export job; supports `requirePlanApproval` pause-before-execute |
| `autonomous_edit_streaming` | **Write** | same as above, with per-step progress notifications |
| `queue_edit` | **Write** | fire-and-forget edit; returns `taskId` |
| `create_project` | **Write** | creates a project |
| `create_brand_kit` / `update_brand_kit` | **Write** | brand kit state |
| `save_caption_template` / `save_current_caption_template` / `apply_caption_template` | **Write** | template state / applies to project |
| `asset_upload_url` | **Write** | issues a signed PUT URL; upload creates a stored asset |
| `transcribe_asset` | **Write** | creates a transcript artifact |
| `delete_project` | **Sensitive write** | irreversible deletion of project + scenes |
| `delete_asset` | **Sensitive write** | irreversible deletion of media |
| `delete_brand_kit` | **Sensitive write** | irreversible deletion |
| `delete_caption_template` | **Sensitive write** | irreversible deletion |

- No payment, purchase, messaging, or publishing tools exist in this connector, so no
  transaction (§4.7) or send/share sensitive-write categories apply. The four `delete_*`
  tools are the only irreversible actions and are designated **sensitive writes** — they
  require user approval on every use, which matches Muse's HITL model (§3.3).
- Tool descriptions are factual; none steer Muse, conceal side effects, or request
  unapproved actions (§3.2).

---

## 6. §5.5 Test account & demo (owner creates; keep accessible through review)

1. Create a dedicated account (e.g. `muse-review@livecore.ai`) on a plan that can run the
   full demo below `[VERIFY: plan]`.
2. Generate its API key; store it as the test credential in the submission form.
3. Seed it: one 30–60 min talking-head/podcast video, 2–3 short B-roll clips, one brand
   kit, one saved caption template. `[VERIFY: uploaded]`
4. Demo script for reviewers (each maps to documented behavior):
   - "Turn my 60-minute podcast into 3 viral reels with captions." → `autonomous_edit`
     (or `queue_edit` + `check_task_status` for the long render) → MP4 URLs
   - "Add captions with the hormozi template to my latest project." → `list_caption_templates`
     → `apply_caption_template` / `autonomous_edit`
   - "Apply my brand kit and export a vertical version." → `list_brand_kits` → `autonomous_edit`
     with `brandId`
   - Destructive-path demo: "Delete the project named X." → `delete_project` — must surface
     as a **sensitive write** approval in Muse
   - Approval-flow demo: `autonomous_edit` with `requirePlanApproval:true` → returns plan +
     `awaiting_approval`; approve via `planDecision:"approve"`
5. Note for reviewers: full edits with export take minutes, not seconds — that is expected;
   status tools report progress (`§1.1` progress-preservation).

---

## 7. Compliance notes (Terms + Policies — points reviewers will probe)

- **Bounded action range (Policies §1.3):** `autonomous_edit` is non-deterministic in
  planning but bounded in execution — it can only invoke a server-side allowlist of
  canonical editing actions; no shell, filesystem, or raw-renderer access is exposed.
- **Biometric rule (Policies §1.7):** face tracking/face blur are framing- and
  privacy-features; they never identify individuals. No biometric identification exists
  anywhere in the connector.
- **HITL mapping:** destructive in-edit operations pause for plan approval
  (`requirePlanApproval`); the four `delete_*` tools are sensitive writes needing approval
  every use. Approval scope is respected — no action is taken beyond what was approved (§3.4).
- **No prohibited content facilitation:** the editor refuses illegal/harmful requests
  server-side `[VERIFY: link to acceptable-use policy]`.
- **Uptime & defect duty (Terms §4.1):** support contact + maintenance owner named in §2.
- **Data handling:** see §4 — no training, no secondary use, deletion on revocation,
  48-hour incident notice.

## 8. Review & discovery (what to expect)

- Three stages: risk assessment → per-tool review (only approved tools ship) → end-to-end
  QA with manual review; sensitive-write approval-every-time is explicitly tested (§6).
- Status is portal-only; Meta does not answer status emails (§5.7).
- Discovery: approved connectors appear in Muse agent discovery + **Settings → Connectors**;
  featuring is editorial and follows usefulness/completion/reliability/maintenance (§7).

---

### One-page summary of what's left

1. ~~Deploy the endpoint~~ — already live at `https://api.livecore.ai/api/v1/misc/mcp` (verified 2026-11-05).
2. Owner: create test account + seed media (§6).
3. Owner: verify every `[VERIFY]` in §2–§5 (mostly legal/privacy facts + the read-only-scope call).
4. Owner: confirm the 512×512 icon (`icon-512.png`, exported from `icon.png`).
5. Owner: sign in at https://platform.muse.ai (Meta/Muse account), paste §2, §4, §5, upload icon + test credentials, accept Terms, submit.
