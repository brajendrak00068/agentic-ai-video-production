<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-light.png">
    <img alt="Levea AI Video Editor" src="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png" width="340" />
  </picture>
</p>

# Levea — Prompt-First AI Video Editor (MCP Server & Cloud Production Studio)

> **Prompt-to-video editing without manual timelines.** Describe the edit in plain language; Levea plans it, edits a real multi-layer project, checks the result on the rendered frames, and exports the MP4 in up to **4K UHD (60fps)**. An **open-source MCP client** connects your AI agent (Claude Desktop, Claude Code, Cursor, Cline, Gemini CLI, OpenClaw, Hermes, ChatGPT) to our **cloud GPU video engine** powered by **dedicated cloud computer-vision & perception models**: real-time 3D camera & depth-of-field bokeh, 368 procedural GPU VFX shaders, 3D camera solve, frame-accurate cuts, 216 kinetic caption templates, 2D and 3D motion graphics reviewed by an AI critic, a licensed music and sound-effects library, voiceovers, and active-speaker reframing — with nothing heavy running on your machine.

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

## 🚀 30-Second Quick Connect (Claude · ChatGPT · Claude Code · Cursor · OpenClaw · Hermes)

| Where You Work | How to Connect Levea (Copy & Paste) |
| :--- | :--- |
| **Claude.ai (Web / Desktop / Mobile)** | **Settings → Connectors → Add custom connector** → Paste **`https://api.livecore.ai/api/v1/misc/mcp`** → Sign in with OAuth 2.1 (zero install). |
| **ChatGPT (Web / Desktop Connectors)** | **Settings → Connectors → Create** → MCP Server URL: **`https://api.livecore.ai/api/v1/misc/mcp`** (OAuth 2.1 + PKCE automatic). Or use [`chatgpt/openapi.json`](./chatgpt/openapi.json) for Custom GPT Actions. |
| **Claude Code (CLI / IDE)** | Run `/plugin marketplace add brajendrak00068/agentic-ai-video-production` then `/plugin install levea-video-editor` (or `claude mcp add --transport http levea https://api.livecore.ai/api/v1/misc/mcp`). |
| **Claude Desktop (1-Click `.mcpb`)** | Download [`levea-mcp-server-0.7.4.mcpb`](https://github.com/brajendrak00068/agentic-ai-video-production/releases/latest/download/levea-mcp-server-0.7.4.mcpb) and double-click to install in Claude Desktop. |
| **Cursor / Windsurf / Cline** | Add remote MCP **`https://api.livecore.ai/api/v1/misc/mcp`** (OAuth 2.1) or stdio `npx -y levea-mcp-server` with `LEVEA_API_KEY` from [livecore.ai](https://livecore.ai/?openclaw=1). |
| **OpenClaw / ClawHub** | `openclaw plugins install clawhub:openclaw-ai-video-editor` + `clawhub install levea-ai-video-editor` |
| **NousResearch Hermes** | `hermes plugins install levea-video-editor && hermes plugins enable levea-video-editor` |
| **Agent Skills CLI (`npx skills`)** | `npx skills add brajendrak00068/agentic-ai-video-production` |

### Why Use Levea Inside Claude Code / Cursor Instead of Local `ffmpeg`, Python, or Standalone HTML/DOM Video Tools?

In Claude Code, an agent can run local `ffmpeg` scripts or render standalone HTML/CSS animations in headless Chrome. Here is the practical difference — and **where Levea goes further** (it runs full 2D/3D motion graphics *inside* its cloud GPU NLE timeline alongside computer vision and GPU video compositing; for pure code-driven motion design, a hand-written HTML/GSAP/Three.js composition is still more flexible):

| Capability | Raw `ffmpeg` / MoviePy (Local CLI) | Standalone HTML/DOM Video Tools (Local Headless Chrome) | **Levea MCP (`livecore.ai` Cloud GPU NLE + Motion Graphics)** |
| :--- | :--- | :--- | :--- |
| **Best For** | Simple container remuxing or fixed-coordinate trims | Standalone code-driven motion graphics, HTML decks & website promos | **Real footage NLE editing + real-time 3D/VFX + motion graphics + podcasts + 4K delivery** |
| **Real-Time 3D Camera & Volumetric Shaders** | ❌ 2D pixel filters only; no 3D camera, depth-of-field, or volumetric lighting | ⚠️ Browser DOM/WebGL limited by headless Chrome CPU/GPU readback bottlenecks | ✅ **Real-time 3D GPU engine**: physical 3D camera (`FOV`, aperture DOF bokeh, focus pull), 3D volumetric & raymarched shaders, god rays, anamorphic flares, ACES Filmic tone mapping & 3D particles |
| **4K UHD Cloud Export (up to 60fps)** | ⚠️ CPU encoding 4K melts laptop and takes hours | ❌ Headless Chrome DOM screenshot capture OOMs or crawls at 4K | ✅ **Cloud GPU streaming compositor**: native **1080p, 2K & 4K (`3840×2160`) UHD** exports at up to **60fps** |
| **9:16 Active-Speaker Reframe** | ❌ No face tracking: you compute a fixed crop by hand (`crop=ih*9/16:ih`), so a moving speaker drifts out of frame | ❌ DOM/CSS has no per-frame face or mouth landmark detector | ✅ **68-point face & active-mouth tracking** per frame + auto 2-up split-screen |
| **Cloud Computer Vision Models** | ❌ Zero neural vision; blind to faces, hands, depth, objects & burned-in text | ❌ Browser DOM cannot run vision models on video streams | ✅ **Dedicated cloud vision models**: face/speaker re-ID, 68-point face landmarks, full-body pose & hand tracking, video depth, hair-accurate AI matting, dense point tracking, scene OCR, shot detection, watermark inpainting, optical-flow slow-mo, 4× super-resolution & lip-sync |
| **3D Camera Tracking & Hand Tracking** | ❌ None | ❌ Browser DOM cannot solve 3D camera motion or track hands/masks on video | ✅ **3D camera solve**, world-space 3D layer pinning, hand palm tracking, 2D region tracker, non-destructive stabilizer (smoothed camera path, border-hiding zoom, rolling-shutter correction) & AI person mattes |
| **Green Screen & GPU VFX Compositing** | ❌ Basic `chromakey` leaves green halos; no 3D LUT/bokeh pipeline | ❌ Headless Chrome captures DOM screenshots; no native video shader pipeline | ✅ **Cloud GPU compositor**: Keylight-grade despilled keying, depth bokeh, 368 GPU VFX presets, 168 transitions, `.cube` 3D LUTs & optical-flow motion blur |
| **Kinetic Captions (216 Templates)** | ❌ Flat static `.srt` / `drawtext` that collides with faces | ⚠️ Must hand-code CSS per video; no automatic face/chin collision solver | ✅ **216 GPU kinetic templates** (`hormozi`, `mrbeast`, `karaoke`) + measured **face/chin & TikTok safe-zone solver** |
| **Multicam Podcast & Broadcast Audio** | ❌ `silencedetect` clips word tails; no multicam speaker switching | ❌ Not an audio/multicam NLE; `<video>` tags in headless Chrome desync on long multi-track cuts | ✅ **Waveform multicam sync**, ASR word-boundary cuts, filler removal, speech-aware auto-ducking, `-14 LUFS` streaming masters, stem separation & lip-synced dubbing |
| **Motion Graphics** | ❌ None | ✅ Full HTML/CSS/GSAP/Three.js compositions | ✅ **Included natively** — 2D/3D motion graphics plus After Effects shape layers (Trim Paths, Repeaters), composited *over* real tracked footage |
| **Human Final Polish (GUI)** | ❌ Edit the command and re-encode to nudge one word | ❌ Must edit HTML/CSS code and re-render headless Chrome frames | ✅ **1-Click `livecore.ai` Web Studio**: scrub multi-source timelines, drag captions, or swap templates without re-rendering |
| **Where It Runs** | Laptop only (CPU-heavy) | Laptop only (requires Node, Chromium, `ffmpeg`, GBs of local disk) | **Everywhere**: Claude.ai Web/Mobile, ChatGPT, Claude Code, Cursor, Grok Bot, OpenClaw, Hermes (100% cloud GPU) |

---

## ⚡ The Levea Philosophy: Prompt-to-Project

Unlike traditional one-shot AI video generators that output locked, un-editable pixels, Levea maintains a fully structured, multi-layer **editable project and timeline** containing video tracks, audio, text, masks, 3D camera rigs, motion graphics, and brand kits.

- **Editable Multi-Track Projects:** Every edit updates a persistent multi-layer timeline with full revision history: undo/redo, named checkpoints, restore to any saved version, and side-by-side variants, so you can refine any cut, caption, 3D camera move, or shader in follow-up prompts or open the project in the web studio.
- **Cloud GPU 3D Rendering & 4K Export:** Heavy computation (real-time 3D camera & shader rendering, ACES Filmic color pipeline, transcription, computer-vision models for active-speaker face tracking and 3D camera solve, 2D/3D motion graphics, and broadcast audio mastering) runs on our remote cloud GPU cluster. You get **1080p, 4K (`3840×2160`), (`7680×4320`) UHD** exports at up to 60fps without melting your local laptop CPU or installing CUDA.
- **Open-Source Client, Hosted Engine:** The client-side MCP server wrapper (`levea-mcp-server`), OpenClaw plugins, and skills are open-source (MIT). They connect to our hosted video production engine with OAuth 2.1 sign-in or an API key. Create a free account at [livecore.ai](https://livecore.ai/).

---

## 🌐 Where to Use Levea (Every Client, Same Project)

Every Levea client connects to the same cloud editor and shares the same project workspace ([edit contract](./contract/edit-contract.json)). Start an edit from Claude, Cursor, ChatGPT, OpenClaw, Hermes, or Telegram, and open the exact same project in the web studio:

| Client / Channel | How to Use |
|---|---|
| **Web studio** | [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=github&utm_medium=readme&utm_campaign=agentic-ai-video-production) |
| **Telegram bot** | [@Levea_editing_bot](https://telegram.me/Levea_editing_bot) — edit from your phone and link to your Levea account |
| **Levea HTTP API** | [API reference](./mcp-server/README.md#api-reference) (`https://api.livecore.ai/api/v1/misc/openclaw/v1/*`) |
| **`levea-mcp-server` (stdio)** | [npm](https://www.npmjs.com/package/levea-mcp-server) · [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server) (`npx -y levea-mcp-server`) |
| **Hosted MCP (zero install)** | `https://api.livecore.ai/api/v1/misc/mcp` — OAuth 2.1 sign-in or `Authorization: Bearer <key>` |
| **Claude Code plugin** | [`claude-plugin/`](./claude-plugin) — `/plugin install levea-video-editor --marketplace brajendrak00068/agentic-ai-video-production` |
| **Claude.ai connector** | Add `https://api.livecore.ai/api/v1/misc/mcp` as a custom connector (OAuth 2.1) |
| **ChatGPT app & Custom GPT** | Connect `https://api.livecore.ai/api/v1/misc/mcp` ([`chatgpt-plugin/`](./chatgpt-plugin)) or use [`chatgpt/`](./chatgpt) (OpenAPI spec + instructions) |
| **Cursor plugin** | [`.cursor-plugin/marketplace.json`](./.cursor-plugin/marketplace.json) — add this repo as a plugin marketplace in Cursor |
| **Gemini CLI extension** | [`gemini-extension.json`](./gemini-extension.json) — `gemini extensions install https://github.com/brajendrak00068/agentic-ai-video-production` |
| **Grok Bot** | Add `https://api.livecore.ai/api/v1/misc/mcp` by URL — see [Use inside Grok Bot](#-use-inside-grok-bot) |
| **Mistral Le Chat** | Add `https://api.livecore.ai/api/v1/misc/mcp` as a Le Chat connector |
| **OpenClaw plugin** | [ClawHub](https://clawhub.ai/plugins/openclaw-ai-video-editor) (`openclaw plugins install clawhub:openclaw-ai-video-editor`) |
| **Hermes plugin** | [`hermes-plugin/`](./hermes-plugin) (Python) · [`hermes-levea/`](./hermes-levea) (MCP bundle) |

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

Two hosts bundle this hosted server for one-step installs:

- **Gemini CLI extension** — this repo is a Gemini extension ([`gemini-extension.json`](./gemini-extension.json)):
  ```bash
  gemini extensions install https://github.com/brajendrak00068/agentic-ai-video-production
  ```
- **Cursor plugin** — add this repo as a plugin marketplace in Cursor (it reads [`.cursor-plugin/marketplace.json`](./.cursor-plugin/marketplace.json)), then install `levea-video-editor`.

### 🤖 Use inside Grok Bot

Grok Bot can add an MCP server by URL, and the hosted server speaks the exact contract it expects (Streamable HTTP, OAuth 2.1 with RFC 7591 dynamic client registration). Tell your Bot:

> **"Add the Levea MCP server: `https://api.livecore.ai/api/v1/misc/mcp`"**

(or use **Connect apps → add an MCP server by URL**). A browser opens to sign in to your Levea account — then every Levea tool (`autonomous_edit`, `queue_edit`, direct canonical actions, job polling, caption templates, brand kits, projects, assets) is available to that Bot, and edits land in the same projects you see in the web studio. Clients that cannot do OAuth can use `Authorization: Bearer <your Levea API key>` instead.

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

1. **Install the Plugin:** Search for `openclaw-ai-video-editor` on ClawHub and install it. It adds the edit, queue, discovery, and status tools.
2. **Install the Skill:** Add `levea-ai-video-editor` from ClawHub Skills so your agent knows when and how to call the tools.
3. **Run your first edit:**
   > *"Review my vertical video, remove the opening silence, auto-apply Hormozi-style captions with highlighted keywords, add subtle background music, and export the Reels-ready MP4."*

---

## 🧩 How Skills Work & How to Use Your Own Custom Skills

Levea is built around **Skills (`SKILL.md`)** at three levels — so your agent always edits with professional craft rules, and you can define your own reusable editing playbooks:

### 1. 100+ Built-In Production Craft Skills (On-Demand via MCP)

Levea ships with **100+ production craft playbooks** covering short-form hooks, podcast repurposing, documentary montage, color grading & LUT finishing, kinetic caption typography, 2D/3D motion graphics, VFX keying & optics, broadcast audio mastering (`-18 LUFS` ducking), and lip-synced dubbing.

- **In Mode A (`autonomous_edit`):** Levea automatically selects and applies the matching craft skills for your prompt and footage.
- **In Mode B (Direct Agent Control):** Your agent can search, load, and follow any built-in craft skill directly in its own context window before calling `execute_action` or `execute_batch`:
  1. **`search_skills`** — search all 100+ craft playbooks by keyword or category (e.g. `query: "captions"`, `"color"`, `"podcast"`, `"montage"`).
  2. **`load_skill`** — load the full `SKILL.md` playbook and its bundled resource list for one or more `skill_id`s.
  3. **`read_skill_resource`** — read specific reference tables or templates (`references/...`, `templates/...`) belonging to a skill.

### 2. 12 Pre-Built Client Skills for Your Agent (`skills/*`)

This repository includes 12 ready-to-install agent skills under [`skills/`](./skills) that teach local agents when and how to invoke Levea:

| Skill | Focus |
|---|---|
| [`levea-ai-video-editor`](./skills/levea-ai-video-editor/SKILL.md) | Full end-to-end editing (Mode A & Mode B) |
| [`viral-clips-generator`](./skills/viral-clips-generator/SKILL.md) | Multi-clip viral highlight extraction from long recordings |
| [`tiktok-reels-shorts-editor`](./skills/tiktok-reels-shorts-editor/SKILL.md) | 16:9 → 9:16 active-speaker vertical reframing & hooks |
| [`auto-captions-subtitles`](./skills/auto-captions-subtitles/SKILL.md) | 216 word-synced caption templates, translations & dubbing |
| [`multicam-podcast-video-editor`](./skills/multicam-podcast-video-editor/SKILL.md) | Waveform multicam sync & active-speaker switching |
| [`silence-removal-audio-cleanup`](./skills/silence-removal-audio-cleanup/SKILL.md) | Word-boundary silence/filler cuts, voiceover, speech-aware ducking & `-14 LUFS` mastering |
| [`ai-b-roll-motion-graphics`](./skills/ai-b-roll-motion-graphics/SKILL.md) | Contextual B-roll cutaways, charts, lower thirds & callouts |
| [`after-effects-motion-graphics`](./skills/after-effects-motion-graphics/SKILL.md) | Shape layers (Trim Paths, Repeaters), Bezier paths & 3D titles |
| [`vfx-compositing-keying`](./skills/vfx-compositing-keying/SKILL.md) | Keylight green-screen keying, AI mattes, depth bokeh, LUTs & 368 VFX |
| [`shaderfx-effects`](./skills/shaderfx-effects/SKILL.md) | Write your own WGSL GPU filters, transitions & generators (ShaderFX ABI v2) |
| [`motion-tracking-stabilization`](./skills/motion-tracking-stabilization/SKILL.md) | 2D region tracking, hand palm attachment, 3D camera solve & warp stabilizer |

**Install all 12 skills in one command:**
```bash
# Claude Code, Cursor, Codex, OpenCode, Gemini CLI
npx skills add brajendrak00068/agentic-ai-video-production

# OpenClaw / ClawHub
clawhub install levea-ai-video-editor
```

### 3. How to Create & Use Your Own Custom Skills (`SKILL.md`)

You can write your own custom **`SKILL.md`** to lock in your channel's house style, brand kit (`brandId`), preferred caption template (`captionTemplatePreset`), reference video style (`style_reference_url`), and exact step-by-step editing recipe.

**Where to save your custom skill:**
- **Claude Code:** `.claude/skills/my-show-style/SKILL.md` (project) or `~/.claude/skills/my-show-style/SKILL.md` (personal)
- **Cursor:** `.cursor/skills/my-show-style/SKILL.md` or `.cursor/rules/my-show-style.mdc`
- **OpenClaw:** `~/.openclaw/skills/my-show-style/SKILL.md` (or `<workspace>/skills/my-show-style/SKILL.md`)
- **Hermes:** `~/.hermes/skills/my-show-style/SKILL.md`
- **OpenCode:** `~/.config/opencode/skills/my-show-style/SKILL.md`

**Example Custom `SKILL.md` (Copy & Customize):**

```markdown
---
name: my-show-style
description: "Edit videos in our channel's signature 9:16 house style using Levea MCP."
---

# My Show House-Style Video Edit

When the user asks to edit a clip in our house style:

1. **Load built-in craft guidance (optional):**
   Call `load_skill` with `skill_id: "caption-typography"` to combine Levea's typography rules with our house rules below.

2. **Option A — One-Call Autonomous Edit (`autonomous_edit`):**
   Call `autonomous_edit` with:
   - `brandId`: `"brand_your_kit_id"`
   - `captionTemplatePreset`: `"hormozi"`
   - `style_reference_url`: `"https://your-cdn.com/reference-reel.mp4"`
   - `prompt`: "Cut silences >0.4s and filler words, reframe to 9:16 keeping the active speaker centered, add Hormozi captions in the lower safe zone, add a lower-third title card at 0:02, duck upbeat background music under speech, and export 1080p MP4."

3. **Option B — Deterministic Step-by-Step Recipe (`execute_batch` → `render_preview` → `EXPORT_VIDEO`):**
   - Call `execute_batch` on `project_id` with our exact sequence (steps run in order on one scene and commit once; if a step fails nothing is committed):
     1. `REMOVE_SILENCES` (`min_silence_duration: 0.4`, `padding: 80`) — `padding` is in milliseconds
     2. `CONFIGURE_CANVAS` (`aspect_ratio: "9:16"`)
     3. `VERTICAL_REFRAME` (`mode: "track_face"`)
     4. `COLOR_GRADE` (`color_preset: "warm"`, `contrast: 1.08`, `saturation: 1.05`)
     5. `GENERATE_CAPTIONS` (`style: "reel-hormozi-punch"`)
     6. `GENERATE_MUSIC` (`mood: "upbeat"`, `mix_role: "under_dialogue"`)
     7. `AUTO_DUCK` (`mode: "music_under_speech"`, `target_loudness_lufs: -14`)
   - Send the batch with `dry_run: true` first: every step's parameters are checked against its schema in under a second and nothing runs. An unknown parameter, a value outside its list or a wrong type refuses the whole batch with `INVALID_PARAMS` and every problem listed (with "did you mean" suggestions); declared aliases are corrected and reported in `corrected_params`. Exact names and values: `get_action_schema` (it accepts a list of actions) and the `search_tools` catalogs (`color_presets`, `captions`).
   - Send calls one after another and wait for each answer: two edits on the same `project_id` at once fail with `PROJECT_REVISION_CONFLICT`.
   - Call `render_preview` at `timestamps: [1.5, 5.0, 10.0]` to visually inspect the GPU-rendered JPEG frames and verify captions do not overlap faces.
   - Call `execute_action` with `action: "EXPORT_VIDEO"` to deliver the final MP4.

4. **Pro path for edits that pick or reorder content (shorts, highlights, recuts):**
   seed once → read `source_map` (the whole source, not a transcript page) → `PLAN_EDITORIAL_CUT` (+ `HOOK_CANDIDATES` for the opening) → `ASSEMBLE_PICTURE_EDIT` → `checkpoint { label: "story-cut" }` → finishing batch with `dry_run: true`, then for real → `VERIFY_EDIT` (`depth: "editorial"`) → `EXPORT_VIDEO`. If a finishing step makes it worse, `UNDO` or `restore_version { label: "story-cut" }` instead of patching on top; try alternative openings as variants (`fork_variant`, `compare_variants`, `promote_variant`).
```

**Keep the skill on your Levea account (any client, any machine):** call `save_skill { path: "~/.claude/skills/my-show-style" }` from the local `npx levea-mcp-server` (or pass the text as `skill_md` from a hosted client). It is stored as `user/my-show-style` and appears first in `search_skills`; `load_skill` and `read_skill_resource` work on it, and `delete_skill` removes it. Frontmatter can set `apply: always` (used on every edit you run), and default `brand_id`, `caption_template` and `style_reference_url` (a request's own values win). Pass `skills: ["user/my-show-style"]` on `autonomous_edit` / `queue_edit` for skills that are not `apply: always`. Limits: 50 skills, a 48k-character playbook, 12 bundled text files.

Once saved, simply tell your agent: *"Edit `https://.../episode12.mp4` using `my-show-style`"* — your agent reads your custom `SKILL.md` and drives Levea with your exact rules every time.

---

## 🧩 OpenClaw Integration: Plugin vs. Skill

Levea is built for modular agent platforms. When deploying Levea inside platforms like OpenClaw or Hermes, we split execution capabilities from cognitive strategies:

- **The Plugin (`openclaw-ai-video-editor`):** the **tools**. It registers the edit, direct action, skill discovery, queue, and status tools with their schemas, manages the API key, and streams progress.
- **The Skill (`levea-ai-video-editor` — or your own custom `SKILL.md`):** the **instructions**. It tells the agent when to use Levea, which parameters or house-style rules to pass, and how to handle approvals, visual preview checks, long-running edits, and follow-ups.

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
| *"Pull the key stats from this and animate them as charts"* | Transcript-driven SVG charts (bars, lines, donuts) + animated stat-callout motion graphics. |
| *"Sync these 3 camera angles and cut between them on the active speaker"* | Multi-cam audio cross-correlation sync + automatic angle switching. |
| *"Blur the license plates and bleep the swearing"* | Privacy redaction (face and moving object blur) + transcript profanity cleanup. |
| *"Turn this YouTube video into a 30-second reel with motion graphics that never cover his face"* | Hook-first trim, face-tracked 9:16 reframe, word captions, motion graphics placed clear of every face, ducked music. |
| *"Make a 15-second 3D animation of a little robot racing a deadline"* | An original 3D character film with camera moves, lighting, music, and sound design, reviewed by an AI critic before delivery. |
| *"Add upbeat music from the library and a whoosh on every cut"* | Licensed music fitted to the video length, sound effects placed on the cuts, voice-aware ducking. |
| *"Speed-ramp into the jump and use J-cuts between speakers"* | Speed ramps / time remap and J/L, match, and smash cuts. |
| *"Push the camera in slowly with a little parallax"* | Keyframed 3D camera moves with depth-based parallax. |
| *"Match the color of the second camera to the first"* | Auto color and shot-to-shot color matching, plus film looks, film burn, and lens flares. |
| *"Dub this into Spanish in my voice and lip-sync it"* | Translated dub in a cloned voice, lip-synced to the speaker's mouth. Mouth-to-audio sync is measured and verified, and the dub is checked by listening to it (right language, intelligible). Lines that had to be shortened to fit are reported. |
| *"Put the price tag in her hand and keep it there"* | Hand tracking: the overlay follows the palm, can grow and shrink with the hand, and hides while the hand is out of view. |
| *"Mix these four songs into one continuous DJ set"* | Beat-matched, harmonically mixed program: each track's tempo and musical key are measured, tracks are time-stretched and key-shifted (Camelot wheel) so they mix. |
| *"Cut a reel from this explainer and keep the slides readable"* | Slides, diagrams, and designed graphics are cropped to their content and shown with a headline on a matched background instead of a tiny letterboxed strip. |

---

## ⚡ Levea vs. Legacy Editors

| Capability | Legacy (Premiere, DaVinci, CapCut, Descript) | Levea Agentic Video Editor |
| :--- | :--- | :--- |
| **Interface** | Drag, drop, keyframe by hand on a manual timeline | One natural-language prompt or direct tool call; the agent finishes the edit |
| **Auto-analysis on upload** | Manual scene detection + subtitles | Faces, active speakers, shot cuts, and on-screen text regions detected automatically |
| **"Make this viral"** | You manually hunt for hooks, crop, splice, and align | Single preset — vertical 9:16 + captions + silences + face tracking |
| **Face search** | Filename search | "Find every clip where Alex appears" across the clips in your project |
| **Background replace** | Key out green screen or draw rotoscope masks by hand | One call — an AI alpha matte handles any footage without a green screen |
| **Broadcast-grade audio** | Manual loudness metering + compression + EQ | Auto LUFS loudness-normalized (EBU R128), true-peak limited, music ducked under speech |
| **Editorial reasoning** | You listen and hunt for the climax | Agent surfaces narrative peaks and high-retention moments |
| **Verification & Repair** | You eyeball it and manually re-render | `autonomous_edit` checks every edit on the rendered frames, repairs failures automatically and returns a typed verification report; with direct tools your agent runs `VERIFY_EDIT` (depth `editorial` adds a rendered critic) and `EXPORT_VIDEO` applies a safe polish pass first |
| **Multi-platform export** | One render per aspect ratio | TikTok + Reels + Shorts + YouTube in one pass |
| **Extensibility** | Plugins call external binaries | 39 MCP tools unlocking 195 editing actions, 28 inspection tools, and 100+ craft skills |

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

- **Every step is verified when it runs:** checks such as "the layer exists", "the timing matches the request", "no graphic covers a face", or "captions stay in sync". A failed check names what was expected and what was found.
- **Automatic repair fixes what failed:** it applies targeted fixes and verifies again until the check passes or the request budget runs out, without destroying the user's own layers or breaking earlier steps.
- **A final review looks at the rendered frames** of the finished edit and can make further fixes.
- **The agent inspects the result the way an editor would:** it watches the rendered video, listens to the rendered audio (is the dub in the right language, intelligible, on-content?), reads color scopes (crushed blacks, clipped whites, flat saturation), previews the frame inside the TikTok / Reels / Shorts interface to check nothing sits under the app's buttons, and measures lip sync on dubbed footage.
- **The result says what happened:** `verificationReport.status` is `verified` only when that final review approved the edit; `unverified` means no verdict was reached (the edit is kept, never reported as verified), with every failed check and what repair tried.
- **Corrections are a follow-up prompt** with the same `project_id`. Every revision is saved, so a change can be undone.

---

## 📂 Capability Status

Availability of specific tracks varies by deployment, active model tiers, and account quotas.

### Supported Production Paths
- **Project and timeline state:** Full NLE track and clip operations (insert, overwrite, lift, extract, ripple delete/trim, slip, slide, freeze frame, reverse), multi-track management, nesting containers, and durable version history: undo/redo, multi-step `revert_steps`, named checkpoints (`checkpoint`, plus automatic ones after assembly, after first finishing and before export), `restore_version` to any saved version or checkpoint (the abandoned redo branch is kept), and variants (`fork_variant` → edit with `variant` → `compare_variants` with a rendered judge → `promote_variant`). Async jobs (music, B-roll, voiceover) never write into a scene a restore moved off, and restore receipts list what the newer versions left behind.
- **Captions:** automatic captions, word timing, keyword emphasis, 216 caption templates (Hormozi, Spotlight, Karaoke, Typewriter, phrase lockups, two-line podcast looks, …), animated word entrances and burn-aways, and Latin, Indic, Arabic, Cyrillic, and Greek text.
- **Motion graphics:** lower thirds, title cards (59 templates), real 3D extruded bevelled titles, charts, counters, flow diagrams, collage layouts, any-layer behind-the-subject occlusion, native After Effects shape layers (arc-length Trim Paths, Repeaters, shape modifiers — pucker & bloat, zig zag, wiggle paths, round corners, offset paths), spatial Bezier motion paths with auto-orient, graph-editor velocity/influence easing, echo motion trails, and full motion-graphic films (2D motion design and 3D character films with camera, lighting, music, and sound design). Every graphic is placed clear of faces and reviewed by an AI critic before it ships.
- **Editing techniques:** speed ramps, time remap, and posterize time, J/L, match, twitch, and smash cuts, keyframed 3D camera moves with depth parallax, non-destructive warp stabilization (smooth camera path + border-hiding auto-scale), AI outpainting to new aspect ratios, eye-contact correction, face retouch, style packages, and 168 transitions.
- **Layout and perception:** multi-cam synchronization and active-speaker cuts, scene and shot cut analysis, face detection and tracking, face identity search across a project's clips, on-screen text-region **detection and OCR recognition**, safe zones, 2D feature-region tracking (position, rotation, and scale), live null parenting, planar corner-pinning, monocular 3D camera solve, and hand tracking (attach a sticker, label, or prop to a hand's palm).
- **Compositing and color:** Keylight-grade screen color key (with despill, clip black/white, softness, shrink/grow), Lab/YUV/RGB color range key, dedicated spill suppression, SVG Bezier masks, feathered/inverted mattes, track mattes, blend modes (all 29 After Effects modes), adjustment layers, ordered multi-effect stacks (up to 4 chained effects per layer), alpha-matte background replacement, on-screen text / logo / watermark removal, auto color and shot matching, monotone cubic curves, CMYK per-range selective color, 5-point levels, LUTs (including your own `.cube` 1D/3D files), After Effects two-tone threshold glow, depth-map-driven camera lens blur (polygonal iris bokeh), optical lens flares, and 368 procedural VFX presets (film burn, bloom, rain, smoke, fire, glitch, portal, lightning, …).
- **Audio:** a reviewed, licensed music and sound-effects library, sound design (effects on cuts and beats, room tone), music fitted to the video length, silence and filler-word cleanup, word-level muting, crossfades, EQ, denoise, EBU R128 loudness normalization, voiceover, **voice cloning** and voice conversion, speech-aware ducking, beat- and drop-synced edits, measured music structure (sections and drops), musical key detection, **DJ mixes** (beat-matched, harmonic track-to-track mixing), vocal / instrumental separation, and **lip-synced dubbing** (translated voice in the speaker's cloned voice, with measured mouth-to-audio sync).
- **Autonomous Directing:** automated cold-open hook extraction, hook-first trims to a target length, podcast polish macros, contextual B-roll placement, auto lower thirds, slideshow generation, and reels cut from explainer videos with slides and diagrams cropped to their content.
- **Sources and delivery:** public video links (including Google Drive files and folders) checked before planning (Drive files that hit Google's download quota are fetched in the background instead of failing), and MP4 export in every platform aspect ratio.
- **Verification:** checks on the rendered frames, requirement tracking, the agent watching and listening to the rendered result (color scopes, platform-UI preview, audio-content and lip-sync checks), brand kits with hard enforcement (off-palette colors fail the check and are repaired), an automatic repair loop, plan approval (`requirePlanApproval` + `planDecision`), and a typed `verificationReport` on every result.

### Model- or Deployment-Dependent
- Generated video, images, B-roll, music, sound effects, voiceover, and voice cloning quality/availability vary by model tier and quota (all are wired as canonical actions in production).
- Neural alpha matting and background replacement quality.
- Lip-sync dubbing quality (a lip-sync step passes only on its measured mouth-to-audio sync).
- **CJK caption rendering:** right-to-left shaping ships in production; CJK glyph coverage depends on font fallback.

---

## 📂 MCP Tool Surface (39 Annotated Tools Unlocking All 195 Canonical Actions, 28 Read Tools & 100+ Craft Skills)

The MCP server (`levea-mcp-server`, 39 tools) exposes **both** high-level goal delegation (`autonomous_edit`) **and** direct progressive-discovery & execution (`search_tools`, `get_action_schema`, `execute_action`, `execute_batch`, `render_preview`, `search_skills`, `load_skill`, `read_skill_resource`), alongside typed management and polling tools. The OpenClaw and Hermes plugins expose the same dual-mode editing and discovery surface.

| Group | Tools | Description |
| --- | --- | --- |
| **Mode A: Goal Delegation** | `autonomous_edit`, `autonomous_edit_streaming`, `queue_edit` | Send a natural-language brief; Levea's autonomous editing agent inspects the footage, edits, verifies on rendered frames, and exports. |
| **Mode B: Universal Direct Canonical Suite (195 Actions, 28 Read Tools & 100+ Skills)** | `search_tools`, `get_action_schema`, `execute_action`, `execute_batch`, `render_preview`, `search_skills`, `load_skill`, `read_skill_resource` | Discover any of the 195 canonical actions, 28 read tools, and 100+ editing craft skills on demand, execute single actions or atomic batches (with automatic safe-zone checks, timeline reconciliation, and async asset completion), and inspect real GPU-composited JPEG screenshots (`render_preview`, like `ffmpeg` frame grabs) without calling `autonomous_edit`. |
| **Job Polling** | `check_job_status`, `check_task_status`, `get_active_task` | Track rendering, generation jobs, and the active task of a project. |
| **Caption Templates** | `list_caption_templates`, `apply_caption_template`, `save_caption_template`, `save_current_caption_template`, `delete_caption_template` | Manage styling templates (216 built-in: Hormozi, Spotlight, Karaoke, …); `list_caption_templates` returns the exact ids. |
| **Brand Kits** | `list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit`, `delete_brand_kit` | Manage brand colors, fonts, logos, voice tone, and grading rules. |
| **Projects** | `list_projects`, `get_project`, `create_project`, `delete_project` | Project workspace management. |
| **Assets** | `asset_upload_url`, `list_assets`, `delete_asset`, `transcribe_asset` | Signed upload URLs, asset listing and deletion, and transcription. |
| **History & Variants** (via `execute_action` / `execute_batch`) | `UNDO`, `REDO`, `list_versions`, `scene_diff`, `restore_version`, `checkpoint`, `fork_variant`, `list_variants`, `compare_variants`, `promote_variant`, `delete_variant` | Every committed call is a saved version: step back one (`UNDO`), jump to a revision or checkpoint label (`restore_version`, undoable, no confirmation), name versions (`checkpoint`; automatic after assemble / first finishing / before export), and try alternatives side by side (`fork_variant` → edit with `variant` → `compare_variants { judge: true }` → `promote_variant`). |
| **Your Skills** | `save_skill`, `delete_skill` | Save your own `SKILL.md` (with bundled files) to your Levea account; it shows up in `search_skills` / `load_skill` from every client. |
| **ShaderFX** | `create_shader_effect`, `list_shader_effects`, `apply_shader_effect`, `delete_shader_effect` | Write your own WGSL GPU filters, transitions and generators and apply them to layers. |
| **Diagnostics** | `editor_health` | Unauthenticated connectivity check. |

### When to Use Mode A (`autonomous_edit`) vs. Mode B (`execute_action` / `execute_batch` / `render_preview`)

| Scenario | Best Mode | Why |
|---|---|---|
| Broad creative brief / full video from prompt | **Mode A (`autonomous_edit`)** | Autonomous editing agent + 100+ craft skills handle decomposition, pacing, and verification in 1 call |
| Exact parameter tweak, custom timestamp math, or local-file-driven script | **Mode B (`execute_action` / `execute_batch`)** | Edits apply in about a second with no planner LLM in the loop and deterministic control over all 195 actions (generation, judges and listening/watching reads take longer and use models) |
| Visual QA loop (like Claude Code `ffmpeg` frame check) | **Mode B (`render_preview` → `execute_action`)** | Returns real GPU-composited JPEG screenshots (`frames[]` + MCP `image` blocks) so your agent can visually verify and nudge layers |
| Heavy first draft + surgical fine-tuning | **Hybrid (Mode A → Mode B)** | Fast first draft via `autonomous_edit`, instant pixel-level polish via `execute_action` / `render_preview` |

Every edit result carries a `verificationReport` (`verified`, `rejected`, `unverified`, or `not_applicable`, plus each requirement that failed its check and what repair tried) and `qualityNotes`.

---

## 🔮 FAQ

#### How does Levea compare to generic video generators like Sora, Veo, or Runway?
Generic generative video models (Sora, Runway, Veo) output raw, locked pixels. You cannot edit a layer, adjust caption typography, swap background music, or correct a word timing afterward. Levea is a **full-featured timeline editor** that builds structured project layers. It uses generative models only as optional asset generation steps, keeping your editing pipeline fully editable, inspectable, and deterministic.

#### Is Levea safe to use for client and enterprise work?
It is designed for it. Every mutation runs through a typed operation engine, and every action the planner or the repair loop chooses is authorized against the request before it runs, so an LLM cannot inject arbitrary mutations. If you set `requirePlanApproval: true`, the system halts and returns the creative plan for approval; resend with `planDecision: "approve"` (or an `editedPlan`) to run it.

#### What coding and agent environments does Levea support?
Levea integrates natively with **Model Context Protocol (MCP)** hosts like Claude Desktop, Cursor, Cline, Windsurf, Claude Code, and the Gemini CLI (via the bundled extension). For standalone agent systems, Levea exposes structured packages for **OpenClaw** and **Hermes**.

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
