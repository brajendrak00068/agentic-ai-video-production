<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-light.png">
    <img alt="Levea AI Video Editor" src="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png" width="340" />
  </picture>
</p>

# Levea — Prompt-First AI Video Editor (MCP Server & Cloud Production Harness)

> **Prompt-to-video editing without manual timelines.** Describe the edit in plain language; Levea plans it, edits a real multi-layer project, checks the result on the rendered frames, and exports the MP4. An **open-source MCP client** connects your AI agent (Claude Desktop, Claude Code, Cursor, Cline, OpenClaw, Hermes, ChatGPT) to our **cloud GPU production harness**: frame-accurate cuts, 60+ caption templates, 2D and 3D motion graphics reviewed by an AI critic, a licensed music and sound-effects library, voiceovers, and active-speaker reframing, with nothing heavy running on your machine.

[![npm](https://img.shields.io/npm/v/levea-mcp-server?label=npm%20levea-mcp-server)](https://www.npmjs.com/package/levea-mcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-levea--mcp--server-orange)](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server)
[![ClawHub Plugin](https://img.shields.io/badge/ClawHub-Plugin-blue)](https://clawhub.ai/plugins/openclaw-ai-video-editor)
[![ClawHub Skill](https://img.shields.io/badge/ClawHub-Skill-orange)](https://clawhub.ai/brajendrak00068/skills/levea-ai-video-editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

<p align="left">
  <a href="https://www.claudeai.directory/launches/levea" target="_blank" rel="noopener">
    <img src="https://www.claudeai.directory/badge/levea?theme=dark" alt="Levea - Listed on Claude AI Directory" width="220" height="54" />
  </a>
</p>

---

## 🧭 How Levea Routes Your Request

Every request is first classified into **one production type**, from your prompt *and* your footage (is there speech? faces? one long recording or many short clips?). Each production type maps to exactly **one production pipeline**, and the pipeline decides which editing craft (director skills) the planner works with. The planner can still load extra skills while it reviews your footage.

| You ask for… (example) | Production type | Pipeline | What it does |
|---|---|---|---|
| "Make a reel showing off our new studio / store / product" (footage with no speaker) | `showcase_montage` | `visual_showcase_montage` | Music-driven reveal montage where the footage is the hero: best moments per clip, uneven shots cut to the music, designed transitions, no text over the subject unless you ask |
| "Clean up this talking-head video, cut the ums and silences" | `talking_head_cleanup` | `talking_head_cleanup` | Dialogue cleanup, pacing, captions and finishing |
| "Turn this podcast episode into clips" (needs speech) | `podcast_clips` | `podcast_repurposing` | Podcast cleanup and social clip repurposing |
| "Edit this two-camera interview" | `multicam_interview` | `multicam_interview` | Multi-camera sync and active-speaker editing |
| "Add a teaser hook at the start of this episode" | `cold_open` | `cold_open_production` | Cold-open / teaser-hook assembly |
| "Make a 30 s vertical short with captions" | `social_short` | `social_short_generation` | Vertical, captioned social short |
| "Add motion graphics that explain what I'm saying" | `motion_graphics_overlay` | `motion_graphics_enhancement` | Transcript-grounded motion graphics over your footage |
| "Make a 20 s animated explainer / title sequence" | `motion_graphics_film` | `motion_graphics_film` | A standalone motion-graphics film |
| "Create a product demo video for this app / site" | `product_demo` | `product_demo` | Product demo with generated assets and motion design |
| "Make a documentary-style montage from this archive" | `documentary_montage` | `documentary_montage` | Evidence-grounded documentary montage |
| "Dub this video into Hindi" | `localization_dub` | `localization_dubbing` | Localized voice, captions and timing checks |
| "Grade, mix and deliver this final cut" | `final_finishing` | `final_finishing_delivery` | Final grade, mix, verification and delivery |
| "Assemble a rough cut from this footage" | `rough_cut` | `rough_cut` | Transcript-aware structural rough cut |

**Good to know**
- **Your footage counts, not just your words.** "Launch reel for our new *podcast* studio" over silent clips of an empty set is a **showcase**, not podcast clipping, because a podcast pipeline needs speech.
- **Links in your prompt get a role.** A URL is classified as footage to import, a style reference, **your brand's site (used for palette and tone, not shown on screen unless you ask)** or a website to show.
- **Want a specific pipeline?** Say so in plain words ("treat this as a documentary montage"); the classifier reads it.

---

## ⚡ The Levea Philosophy: Prompt-to-Project

Unlike traditional one-shot AI video generators that output locked, un-editable pixels, Levea maintains a fully structured, multi-layer **project and timeline (Scene IR)** containing assets, text, masks, audio, and brand kits. 

- **Frontier LLMs for Planning:** We use probabilistic Frontier LLMs solely for planning, semantic analysis, and parameter parsing.
- **Cloud-Accelerated Production Harness:** Heavy computation (Vulkan rendering, GPU transcription, active-speaker face tracking, and HyperFrames motion graphics) executes on our remote cloud GPU cluster. You get 4K and vertical reel exports without melting your local laptop CPU or installing CUDA.
- **Open-Source Client, Hosted Engine:** The client-side MCP server wrapper (`levea-mcp-server`), OpenClaw plugins, and skills are open-source (MIT). They connect to our hosted video production engine with OAuth sign-in or an API key. Create a free account and API key at [livecore.ai](https://livecore.ai/).

---

## 🏗️ Platform Architecture

Levea separates probabilistic creative reasoning from deterministic project execution: a language model decides *what* to do, as a typed plan; deterministic code decides *how*, changes the project, and checks the result.

```text
        Creative Intent + Source Media (video links, transcript, references)
                                  │
                                  ▼
          Production Pipeline + Director Skills
          (reel, podcast, documentary, motion graphics, …)
                                  │
                                  ▼
        Multimodal Planner (frontier LLM: prompt, transcript, frames, scene)
                                  │
                                  ▼
                Typed Action Plan (186 canonical actions)
                                  │
                                  ▼
     Plan Compiler (schema validation, parameter binding, dependency order)
                                  │
                                  ▼
          Workflow DAG (tasks, dependencies, gates, verifiers)
                                  │
                                  ▼
      Execution Harness ── typed, audited operations ──▶ Scene IR
      │                                                (timeline, tracks, layers;
      │                                                 every revision saved)
      ├── Perception: transcript, faces, active speaker, shot cuts, on-screen text
      ├── Editing: cuts, ripple, slip/slide, reframe, multicam, speed ramps
      ├── Captions: 60+ templates, word-level sync, Latin/Indic/Arabic/Cyrillic/Greek
      ├── Audio: licensed music + SFX library, sound design, EBU R128, ducking, voiceover
      ├── Motion graphics (HyperFrames): 2D motion design, 3D character films, charts
      ├── Generation jobs: images, B-roll video, music, voice (async artifacts)
      └── Rendering (Vulkan / WebGPU): 160+ transitions, ~100 GPU effect presets
                                  │
                                  ▼
      Verification: each task's checks, then a final review of the rendered frames
              │  fails                                  ▲
              └──▶ Repair loop: typed fixes, re-verified ┘
                                  │ passes (or budget spent: reported, never hidden)
                                  ▼
      Editable Scene + verification report ──▶ MP4 / multi-platform export
```

### How the clients connect

Every Levea client reaches the same editor on the Levea backend. The agent clients are thin wrappers over one HTTP API, with the same edit fields (one shared [edit contract](./contract/edit-contract.json)); the web studio and the Telegram bot have their own routes into the same editor. Pick whichever fits your tools:

```text
                 Levea editor (one edit pipeline, same result everywhere)
                                          ▲
           ┌──────────────────────────────┼──────────────────────────┐
           │                              │                          │
 Levea API                         Web studio route           Telegram route
 /api/v1/misc/openclaw/v1/*        /api/v1/misc/editor/*      /api/v1/misc/telegram/*
 (execute, queue-edit, jobs,              ▲                          ▲
  task-status, projects, assets, …)       │                          │
           ▲                       Levea web studio           Telegram bot
           │                       (livecore.ai)              (@Levea_editing_bot)
   ┌───────┴─────────┬────────────────┬──────────────┐
   │                 │                │              │
levea-mcp-server  OpenClaw plugin  Hermes plugin  ChatGPT action
(npm, stdio MCP)  (ClawHub)        (Python)       (OpenAPI)
 ▲
Hosted MCP: /api/v1/misc/mcp
(the same server, run by Levea; OAuth sign-in or API key)
 ▲
Claude Code plugin · Claude connector · ChatGPT app · Cursor / any remote-MCP client
```

All paths start with `https://api.livecore.ai`.

- **MCP clients** (Claude Desktop, Cursor, Cline, Windsurf) run `levea-mcp-server` locally with an API key, or connect to the **hosted MCP** URL with no install.
- **OpenClaw**, **Hermes**, and the **ChatGPT action** call the API directly.
- **Telegram:** message [@Levea_editing_bot](https://telegram.me/Levea_editing_bot) to edit from your phone. Link it to your Levea account from the sign-in page ("Try on Telegram").
- **Skills** (ClawHub, the Claude Code plugin) are instructions for the agent; they do not run code.

### 1. Pipelines and planning
Each request is matched to a production pipeline (a short-form reel, a podcast cut, a documentary montage, a motion-graphic film, …) whose director skills give the planner its craft rules. The planner reads the prompt, the transcript, sampled frames, and the current scene, and emits a **typed action plan**: canonical actions with typed parameters, never free-form scene edits.

### 2. Compilation, Workflow DAG and Scene IR
The **plan compiler** validates every action against its schema, binds parameters, and orders the work into a **Workflow DAG** of tasks, dependencies, gates, and verifiers. Tasks change the **Scene IR** (the serializable project: canvas, tracks, layers, transitions, effects, assets) only through typed, audited operations, so every edit is inspectable and repeatable, and the project never belongs to the language model.

### 3. Execution Harness
Typed operators run on the cloud GPU cluster: perception, editing, captions, audio, and rendering through native Vulkan (export) and browser WebGPU (preview) from one shared scene-preparation path. Motion graphics come from HyperFrames: editorial layouts, data charts, stat cards, diagrams, and short 3D character films with their own camera, lighting, music, and sound design. Every motion graphic is reviewed by an AI critic against a craft checklist and revised before it reaches the timeline.

### 4. Versioning and Export
All revisions are saved in a durable, linear undo/redo history backed by immutable scene payloads, preventing state corruption during multi-step iterations. Export is optional—Levea can return the updated editable scene, queue asset rendering, deliver an MP4, or bundle assets for multi-platform delivery.

---

## 🛠️ Dual-Path Quickstart (Get Started in 60 Seconds)

Whether you are an AI developer looking to integrate automated editing into your agent loops, or a content creator building an automated faceless channel, Levea has a native path for you.

### 🟣 Claude Code plugin (one command)

Install Levea as a Claude Code plugin. It bundles the hosted Levea MCP server (OAuth sign-in, nothing to run locally) and a Levea editing skill:

```
/plugin install levea-video-editor --marketplace brajendrak00068/agentic-ai-video-production
```

Or from your shell:

```bash
claude plugin marketplace add brajendrak00068/agentic-ai-video-production
claude plugin install levea-video-editor@levea
```

On first use, run `/mcp`, select **levea**, and sign in to your Levea account in the browser. Then describe the edit, for example: *"Cut a 30-second vertical clip from https://example.com/talk.mp4 with word-by-word captions and export an MP4."*

### 🌐 Hosted MCP (no install)

Any MCP client that supports remote servers can connect to the hosted endpoint directly:

```
https://api.livecore.ai/api/v1/misc/mcp
```

It speaks Streamable HTTP and signs you in with **OAuth 2.1** (the client opens a browser to your Levea account). Clients that cannot do OAuth can send `Authorization: Bearer <your Levea API key>` instead.

### 🧑‍💻 Path A: For Developers & AI Engineers (The MCP Route)

Expose Levea as a client-side Model Context Protocol (MCP) server stdio wrapper (`levea-mcp-server`) in your favorite AI editors (Cursor, Cline, Windsurf, or Claude Desktop).

#### 1. Get an API Key
Sign up at [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=github&utm_medium=readme&utm_campaign=agentic-ai-video-production) and generate a Levea API key.

#### 2. Register the MCP Server
Add the following configuration block to your editor's MCP settings:

```jsonc
{
  "mcpServers": {
    "levea": {
      "command": "npx",
      "args": ["-y", "levea-mcp-server"],
      "env": {
        "LEVEA_API_URL": "https://api.livecore.ai",
        "LEVEA_API_KEY": "your-key-from-livecore.ai"
      }
    }
  }
}
```

*Note: `LEVEA_API_URL` should point to the bare host domain `https://api.livecore.ai`. The client-side wrapper handles endpoint appending automatically.*

| Client | Setup Commands / Instructions |
| --- | --- |
| **Cursor & Windsurf** | Go to Settings -> Features -> MCP -> Add New MCP Server. Set type to `command` and insert the config above. |
| **Cline** | Open settings, scroll to MCP, and add the config to the Cline MCP settings file. |
| **Claude Code** | Run: `claude mcp add levea -e LEVEA_API_URL=https://api.livecore.ai -e LEVEA_API_KEY=... -- npx -y levea-mcp-server` |
| **Claude Desktop** | Add the server block to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). |
| **Hermes** | Native plugin: [`hermes-plugin/`](./hermes-plugin) (`hermes plugins install levea-video-editor && hermes plugins enable levea-video-editor`). Or register `levea-mcp-server` as an MCP server using the bundled [`hermes-levea/mcp.json`](./hermes-levea/mcp.json). |
| **OpenClaw** | Install via ClawHub: `openclaw plugins install clawhub:openclaw-ai-video-editor` or add via CLI `openclaw mcp add levea --command "npx -y levea-mcp-server" --env LEVEA_API_URL=https://api.livecore.ai --env LEVEA_API_KEY=...`. |

---

### 🎨 Path B: For Creators & Marketers (The OpenClaw Route)

Deploy Levea as an autonomous editing agent directly inside the OpenClaw workspace.

1. **Install the Plugin:** Search for `openclaw-ai-video-editor` on ClawHub and install it. It adds the edit, queue, and status tools.
2. **Install the Skill:** Add `levea-ai-video-editor` from ClawHub Skills so your agent knows when and how to call the tools.
3. **Run your first edit:**
   > *"Review my vertical video, remove the opening silence, auto-apply Hormozi-style captions with highlighted keywords, add subtle background music, and export the Reels-ready MP4."*

---

## 🧩 OpenClaw Integration: Plugin vs. Skill

Levea is built for modular agent platforms. When deploying Levea inside platforms like OpenClaw or Hermes, we split execution capabilities from cognitive strategies:

- **The Plugin (`openclaw-ai-video-editor`):** the **tools**. It registers the edit, queue, and status tools with their schemas, manages the API key, and streams progress.
- **The Skill (`levea-ai-video-editor`):** the **instructions**. It tells the agent when to use Levea, which parameters to pass, and how to handle approvals, long-running edits, and follow-ups. The editorial craft itself (pipelines, director skills, verification) runs on the Levea backend.

*We recommend installing **both** to unlock the full power of autonomous editing with a professional finish.*

---

## 🎬 What It Does: Say It in Plain Language

Say it in plain language; Levea plans, executes, and finishes the complete edit:

| You ask | It does |
| --- | --- |
| *"Turn this into 5 viral clips with captions and vertical reframe"* | Identifies narrative peaks, cuts clips, applies bold captions, reframes to 9:16 vertical, and exports. |
| *"Cut a 60-second highlight from this 2-hour podcast"* | Discovers strongest continuous story segment, trims dead air, and packages with captions. |
| *"Make this TikTok-ready"* | Vertical 9:16 reframe + captions + silence removal + keyword emphasis kit. |
| *"Export for TikTok, Reels, Shorts, YouTube, and Instagram"* | One pass, all platform-specific aspect ratios in one package. |
| *"Replace the green screen with a beach, keep the speaker centered"* | Chroma key + background composite + face tracking in one call. |
| *"Remove the background — no green screen"* | AI background removal via an alpha matte on any footage. |
| *"Swap my background for a city skyline — no green screen"* | AI matte isolates subject cleanly, compositing the new background behind. |
| *"Remove all silences and filler words, add background music"* | Cleans audio track (cuts `um`, `uh`, `like`), adds ducked music bed under speech. |
| *"Auto-zoom on whoever's talking"* | Active-speaker detection + dynamic zoom-follow framing. |
| *"Caption this and highlight every time they say 'launch'"* | Auto-captions + keyword emphasis (scaling / glow / pulse). |
| *"Find every clip where Alex appears"* | Face identity search across the clips in your project. |
| *"Add narration in a cloned voice over the intro"* | Voice cloning + TTS overlay + auto-ducking. |
| *"Caption this Hormozi-style with karaoke word highlighting"* | Word-synced karaoke captions — active word fills and underlines in sync with speech. |
| *"Generate B-roll over the product mention"* | AI B-roll generation + placement at the exact timestamp. |
| *"Color grade this like a Netflix doc"* | Cinematic LUT color grade with contrast and film-look curve. |
| *"Slow-mo the climax, freeze on the reveal"* | Speed change (`0.5×` slow-mo) + freeze-frame hold on key action. |
| *"Reframe to vertical but don't crop the lower-third captions"* | Caption-safe 9:16 reframe (detects on-screen text regions and reframes around them). |
| *"Pull the key stats from this and animate them as charts"* | Transcript-driven SVG charts (bars, lines, donuts) + stat-callout motion graphics via HyperFrames. |
| *"Sync these 3 camera angles and cut between them on the active speaker"* | Multi-cam audio cross-correlation sync + automatic angle switching. |
| *"Blur the license plates and bleep the swearing"* | Privacy redaction (face and moving object blur) + transcript profanity cleanup. |
| *"Turn this YouTube video into a 30-second reel with motion graphics that never cover his face"* | Hook-first trim, face-tracked 9:16 reframe, word captions, motion graphics placed clear of every face, ducked music. |
| *"Make a 15-second 3D animation of a little robot racing a deadline"* | An original 3D character film with camera moves, lighting, music, and sound design, reviewed by an AI critic before delivery. |
| *"Add upbeat music from the library and a whoosh on every cut"* | Licensed music fitted to the video length, sound effects placed on the cuts, voice-aware ducking. |
| *"Speed-ramp into the jump and use J-cuts between speakers"* | Speed ramps / time remap and J/L, match, and smash cuts as typed editing techniques. |
| *"Push the camera in slowly with a little parallax"* | Keyframed 3D camera moves with depth-based parallax. |
| *"Match the color of the second camera to the first"* | Auto color and shot-to-shot color matching, plus film looks, film burn, and lens flares. |

---

## ⚡ Levea vs. Legacy Editors

| Capability | Legacy (Premiere, DaVinci, CapCut, Descript) | Levea Agentic Editor & Production Harness |
| :--- | :--- | :--- |
| **Interface** | Drag, drop, keyframe by hand on a manual timeline | One natural-language prompt; the agent plans and finishes the edit |
| **Auto-analysis on upload** | Manual scene detection + subtitles | Faces, active speakers, shot cuts, and on-screen text regions detected automatically |
| **"Make this viral"** | You manually hunt for hooks, crop, splice, and align | Single preset — vertical 9:16 + captions + silences + face tracking |
| **Face search** | Filename search | "Find every clip where Alex appears" across the clips in your project |
| **Background replace** | Key out green screen or draw rotoscope masks by hand | One call — an AI alpha matte handles any footage without a green screen |
| **Broadcast-grade audio** | Manual loudness metering + compression + EQ | Auto LUFS loudness-normalized (EBU R128), true-peak limited, music ducked under speech |
| **Editorial reasoning** | You listen and hunt for the climax | Agent surfaces narrative peaks and high-retention moments |
| **Verification & Repair** | You eyeball it and manually re-render | Every edit is checked on the rendered frames; failures are repaired automatically and reported with a typed verification report |
| **Multi-platform export** | One render per aspect ratio | TikTok + Reels + Shorts + YouTube in one pass |
| **Extensibility** | Plugins call external binaries | 186 typed canonical actions orchestrated through a deterministic Workflow DAG |

---

## 🎬 Creator & Dev Use Cases

| Use case | Typical production path |
| --- | --- |
| **Faceless channel** | Segment the transcript, plan the layout, overlay B-roll, add library or generated music, and render. |
| **Auto-captions** | Transcribe, time every word, highlight keywords, and style with a caption template. |
| **Shorts & Reels highlights** | Find the hook, trim to the target length, reframe to 9:16 around the speaker, add captions and motion graphics. |
| **Interview polish** | Cut long silences, bleep profanity, grade color, and add lower-third speaker graphics. |
| **Green screen & backdrop swap** | Key or matte the speaker, layer a new background photo or video, and composite. |
| **Multicam active-speaker cuts** | Sync camera angles by audio, identify speakers, and cut to whoever is talking. |

---

## ⚙️ Verification & Repair

Levea checks its own work before it reports success.

- **Every task is verified when it runs:** typed checks such as "the layer exists", "the timing matches the request", "no graphic covers a face", or "captions stay in sync". A failed check names the invariant, what was expected, and what was found.
- **A repair loop fixes what failed:** it proposes typed fixes (any canonical action), applies them, and verifies again, until the check passes or the request's time and model-call budget runs out. A fix is refused if the request prohibits it, if it would destroy the user's own layers, or if it would break a task that already passed.
- **A final review looks at the rendered frames** of the finished edit and can make further fixes.
- **The result says what happened:** `verificationReport.status` is `verified` only when that final review approved the edit; `unverified` means no verdict was reached (the edit is kept, never reported as verified), with every failed check and what repair tried.
- **Corrections are a follow-up prompt** with the same `project_id`. Every revision is saved, so a change can be undone.

---

## 📂 Capability Status

Availability of specific tracks varies by deployment, active model tiers, and account quotas.

### Supported Production Paths
- **Project and timeline state:** Full NLE track and clip operations (insert, overwrite, lift, extract, ripple delete/trim, slip, slide, freeze frame, reverse), multi-track management, nesting containers, and durable linear undo/redo.
- **Captions:** automatic captions, word timing, keyword emphasis, 60+ caption templates (Hormozi, Spotlight, Karaoke, Typewriter, phrase lockups, two-line podcast looks, …), animated word entrances and burn-aways, and Latin, Indic, Arabic, Cyrillic, and Greek text.
- **Motion graphics:** lower thirds, title cards, charts, counters, flow diagrams, collage layouts, text behind the subject, and full motion-graphic films (2D motion design and 3D character films with camera, lighting, music, and sound design). Every graphic is placed clear of faces and reviewed by an AI critic before it ships.
- **Editing techniques:** speed ramps and time remap, J/L, match, and smash cuts, keyframed 3D camera moves with depth parallax, AI outpainting to new aspect ratios, eye-contact correction, face retouch, style packages, and 160+ transitions.
- **Layout and perception:** multi-cam synchronization and active-speaker cuts, scene and shot cut analysis, face detection and tracking, face identity search across a project's clips, on-screen text-region **detection and OCR recognition**, safe zones, and explicit-region tracking or masking.
- **Compositing and color:** chroma key, masks, blend modes (29 modes), adjustment layers, alpha-matte background replacement, on-screen text / logo / watermark removal, auto color and shot matching, LUTs (including your own .cube files), and ~100 GPU effect presets (lens flares, film burn, bloom, rain, smoke, fire, glitch, portal, lightning, …).
- **Audio:** a reviewed, licensed music and sound-effects library, sound design (effects on cuts and beats, room tone), music fitted to the video length, silence and filler-word cleanup, word-level muting, crossfades, EQ, denoise, EBU R128 loudness normalization, voiceover, **voice cloning** and voice conversion, speech-aware ducking, beat- and drop-synced edits, and vocal / instrumental separation.
- **Autonomous Directing:** automated cold-open hook extraction, hook-first trims to a target length, podcast polish macros, contextual B-roll placement, auto lower thirds, and slideshow generation.
- **Sources and delivery:** public video links (including Google Drive files and folders) checked before planning, and MP4 export in every platform aspect ratio.
- **Verification:** typed task contracts, checks on the rendered frames, requirement tracking, an automatic repair loop, plan approval (`requirePlanApproval` + `planDecision`), and a typed `verificationReport` on every result.

### Model- or Deployment-Dependent
- Generated video, images, B-roll, music, sound effects, voiceover, and voice cloning quality/availability vary by model tier and quota (all are wired as canonical actions in production).
- Neural alpha matting and background replacement quality.
- **CJK caption rendering:** right-to-left shaping ships in production; CJK glyph coverage depends on font fallback.

---

## 📂 MCP Tool Surface

The MCP server (`levea-mcp-server`, 25 tools) exposes one high-level editing entry point plus typed management and polling tools. The OpenClaw and Hermes plugins expose the five edit and polling tools.

| Group | Tools | Description |
| --- | --- | --- |
| **Edit** | `autonomous_edit`, `autonomous_edit_streaming`, `queue_edit` | Single-entry edit prompts, SSE progress streaming, and asynchronous queuing. |
| **Job Polling** | `check_job_status`, `check_task_status`, `get_active_task` | Track rendering, generation jobs, and the active task of a project. |
| **Caption Templates** | `list_caption_templates`, `apply_caption_template`, `save_caption_template`, `save_current_caption_template`, `delete_caption_template` | Manage styling templates (Hormozi, Spotlight, Karaoke, …); `list_caption_templates` returns the exact ids. |
| **Brand Kits** | `list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit`, `delete_brand_kit` | Manage brand colors, fonts, logos, voice tone, and grading rules. |
| **Projects** | `list_projects`, `get_project`, `create_project`, `delete_project` | Project workspace management. |
| **Assets** | `asset_upload_url`, `list_assets`, `delete_asset`, `transcribe_asset` | Signed upload URLs, asset listing and deletion, and transcription. |
| **Diagnostics** | `editor_health` | Unauthenticated connectivity check. |

Every edit result carries a `verificationReport` (`verified`, `rejected`, `unverified`, or `not_applicable`, plus each requirement that failed its check and what repair tried) and `qualityNotes`.

---

## 🔮 FAQ

#### How does Levea compare to generic video generators like Sora, Veo, or Runway?
Generic generative video models (Sora, Runway, Veo) output raw, locked pixels. You cannot edit a layer, adjust caption typography, swap background music, or correct a word timing afterward. Levea is a **full-featured timeline editor** that builds structured project layers. It uses generative models only as optional asset generation steps, keeping your editing pipeline fully editable, inspectable, and deterministic.

#### Is Levea safe to use for client and enterprise work?
It is designed for it. Every mutation runs through a typed operation engine, and every action the planner or the repair loop chooses is authorized against the request before it runs, so an LLM cannot inject arbitrary mutations. If you set `requirePlanApproval: true`, the system halts and returns the creative plan for approval; resend with `planDecision: "approve"` (or an `editedPlan`) to run it.

#### What coding and agent environments does Levea support?
Levea integrates natively with **Model Context Protocol (MCP)** hosts like Claude Desktop, Cursor, Cline, Windsurf, and Claude Code. For standalone agent systems, Levea exposes structured packages for **OpenClaw** and **Hermes**.

#### Can I use custom brand fonts, logos, and specific caption templates?
Absolutely. Using our **Brand Kits API and tools**, you can declare custom typography scales, palette hex codes, logo image references, and voice tone. The planning model reads these rules and automatically enforces them across the timeline during the composition pass.

---

## 🔗 Links & Resources

- **Levea Studio and API Keys:** [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=github&utm_medium=readme&utm_campaign=agentic-ai-video-production)
- **npm MCP Server Wrapper:** [`levea-mcp-server`](https://www.npmjs.com/package/levea-mcp-server)
- **MCP Registry:** [`io.github.brajendrak00068/levea-mcp-server`](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server)
- **OpenClaw Plugin Page:** [`openclaw-ai-video-editor`](https://clawhub.ai/plugins/openclaw-ai-video-editor)
- **OpenClaw Skill Page:** [`levea-ai-video-editor`](https://clawhub.ai/brajendrak00068/skills/levea-ai-video-editor)
- **Detailed Agent Integration Guide:** [AGENTS.md](./AGENTS.md)
- **MCP Folder Documentation:** [mcp-server/README.md](./mcp-server/README.md)

**How long an edit takes:** read-only questions answer in seconds, a simple edit with export in a few minutes, and a full edit with motion graphics, music, and export in 10–20 minutes. Clients return `status: "running"` with the `project_id` if they stop waiting first; the edit keeps running (see [AGENTS.md](./AGENTS.md)).

**Privacy & telemetry:** edits send your prompt, source links, and project ids to the Levea API ([privacy policy](https://www.livecore.ai/privacy), [terms](https://www.livecore.ai/terms)). The MCP server and OpenClaw plugin also send a tiny anonymous usage ping (event name, client version, whether a key is set; never prompts, media, or keys); turn it off with `LEVEA_TELEMETRY=off`.

**Security:** see [SECURITY.md](./SECURITY.md). **Contributing:** see [CONTRIBUTING.md](./CONTRIBUTING.md).

**Support & Contact:** [brajendra@livecore.ai](mailto:brajendra@livecore.ai) · [GitHub issues](https://github.com/brajendrak00068/agentic-ai-video-production/issues)

---

## License

[MIT](./LICENSE)
