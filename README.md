<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-light.png">
    <img alt="Levea AI Video Editor" src="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png" width="340" />
  </picture>
</p>

# Levea — Prompt-First AI Video Editor (MCP Server & Cloud Production Harness)

> **Prompt-to-video editing without manual timelines.** Levea is an agentic AI video production platform that turns natural-language creative direction, transcripts, and source footage into fully structured, editable video projects. An **open-source MCP client wrapper** connects your local AI agent (Claude Desktop, Claude Code, Cursor, Cline, OpenClaw, Hermes) to our **cloud GPU production harness**—executing frame-accurate cuts, 40+ kinetic caption styles, verified motion graphics (HyperFrames), Google Cloud TTS voiceovers, active-speaker reframing, and cloud-rendered MP4 exports without taxing your local machine.

[![npm](https://img.shields.io/npm/v/levea-mcp-server?label=npm%20levea-mcp-server)](https://www.npmjs.com/package/levea-mcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-levea--mcp--server-orange)](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server)
[![ClawHub Plugin](https://img.shields.io/badge/ClawHub-Plugin-blue)](https://clawhub.ai/plugins/openclaw-ai-video-editor)
[![ClawHub Skill](https://img.shields.io/badge/ClawHub-Skill-orange)](https://clawhub.ai/skills/levea-ai-video-editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

<p align="left">
  <a href="https://www.claudeai.directory/launches/levea" target="_blank" rel="noopener">
    <img src="https://www.claudeai.directory/badge/levea?theme=dark" alt="Levea - Listed on Claude AI Directory" width="220" height="54" />
  </a>
  &nbsp;&nbsp;
  <a href="https://chatgpt.com/gpts" target="_blank" rel="noopener">
    <img src="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/chatgpt/chatgpt-badge.svg" alt="Levea - Available on ChatGPT Store" width="220" height="54" />
  </a>
</p>

---

## ⚡ The Levea Philosophy: Prompt-to-Project

Unlike traditional one-shot AI video generators that output locked, un-editable pixels, Levea maintains a fully structured, multi-layer **project and timeline (Scene IR)** containing assets, text, masks, audio, and brand kits. 

- **Frontier LLMs for Planning:** We use probabilistic Frontier LLMs solely for planning, semantic analysis, and parameter parsing.
- **Cloud-Accelerated Production Harness:** Heavy computation (Vulkan rendering, GPU WhisperX transcription, active-speaker face tracking, and HyperFrames motion graphics) executes on our remote cloud GPU cluster. You get instant 4K and vertical reel exports without melting your local laptop CPU or installing CUDA.
- **Open-Source Client, Hosted Engine:** The client-side MCP server wrapper (`levea-mcp-server`), OpenClaw plugins, and skills are open-source (MIT). They connect to our hosted video production engine via API key. You can generate an API key with free starter credits at [livecore.ai](https://livecore.ai/).

---

## 🏗️ Platform Architecture

Levea separates probabilistic creative reasoning from deterministic project execution:

```text
                     Creative Intent + Source Media
                                  │
                                  ▼
               Probabilistic Multimodal Intelligence
                      (Gemini / Frontier LLMs)
                                  │
                                  ▼
               CanonicalActionIR (179 Typed Actions)
                                  │
                                  ▼
                        CanonicalPlanCompiler
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
              Workflow DAG                   Scene IR
        (Task Dependencies & Gating)   (Timeline & Layer Hierarchy)
                    └─────────────┬─────────────┘
                                  │
                                  ▼
               Deterministic Video-Production Harness
                   ├── Perception Engine (Face Tracking, Active Speaker, Shot Cuts)
                   ├── Timeline and Scene Graph (Tracks, Layers, Geometry)
                   ├── Media Operators (Silence Cuts, Slip/Slide, Ripple, Split-Screen)
                   ├── Caption & Typography Engine (39 MSDF Fonts, 39 Templates, Kinetic Word Sync)
                   ├── Animation & Motion Physics (Damped Spring Solvers, 17 Blend Modes)
                   ├── Audio Mastering (EBU R128 Loudness, Google Cloud TTS, Auto-Duck)
                   ├── Composition & Asset Execution
                   │   ├── HyperFrames — procedural charts, audio waveforms, cards, 3D
                   │   ├── Vulkan/WebGPU — GPU shaders, primitives, final compositing
                   │   ├── Lottie — authored vector animations
                   │   └── Veo / Imagen 3 — generated supporting media
                   ├── Gated Executor (gatedExecute Atomic Mutations)
                   ├── Project Versioning (Immutable Scene History)
                   └── Export Pipeline (Hardware-Accelerated / Vulkan MP4)
                                  │
                                  ▼
                  Verification → Bounded Repair → Editable Scene
                                                    ├── Return Scene JSON
                                                    ├── Queue Media Work
                                                    └── Optional Multi-Platform Export
```

### 1. Multimodal planning
The planning layer interprets user prompts, transcripts, visual references, and timeline boundaries. It compiles raw natural language into a highly optimized, typed **Workflow DAG** of sequential and parallel editing operations. The hosted planner currently utilizes Gemini through Google AI and Vertex AI.

### 2. Workflow DAG and Scene IR (Intermediate Representation)
These represent the dual brain-body architecture of Levea:
- The **Workflow DAG** maps the editing tasks, dependencies, gating, verifiers, and asset-generation jobs.
- The **Scene IR** is the serializable media schema representing the complete timeline: canvas dimensions, tracks, layers, custom transitions, effects, and assets.

Separating intent from execution makes edits fully inspectable, repeatable, and independently repairable without transferring project ownership to an LLM.

### 3. Deterministic Production Harness
Typed production operators execute the plan against the scene graph. The native renderer compiles Scene compositions through native Vulkan and browser WebGPU paths, subsequently compositing them with verified motion graphics produced by HyperFrames (which handles rich editorial layouts, data charts, stat cards, and diagrams).

### 4. Versioning and Export
All revisions are saved in a durable, linear undo/redo history backed by immutable scene payloads, preventing state corruption during multi-step iterations. Export is optional—Levea can return the updated editable scene, queue asset rendering, deliver an MP4, or bundle assets for multi-platform delivery.

---

## 🛠️ Dual-Path Quickstart (Get Started in 60 Seconds)

Whether you are an AI developer looking to integrate automated editing into your agent loops, or a content creator building an automated faceless channel, Levea has a native path for you.

### 🧑‍💻 Path A: For Developers & AI Engineers (The MCP Route)

Expose Levea as a client-side Model Context Protocol (MCP) server stdio wrapper (`levea-mcp-server`) in your favorite AI editors (Cursor, Cline, Windsurf, or Claude Desktop).

#### 1. Get an API Key
Sign up at [livecore.ai](https://livecore.ai/) and generate a Levea API key.

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
| **Hermes** | Register `levea-mcp-server` as an MCP server using the bundled [`hermes-levea/mcp.json`](./hermes-levea/mcp.json). |
| **OpenClaw** | Install via ClawHub: `openclaw plugins install clawhub:openclaw-ai-video-editor` or add via CLI `openclaw mcp add levea --command "npx -y levea-mcp-server" --env LEVEA_API_URL=https://api.livecore.ai --env LEVEA_API_KEY=...`. |

---

### 🎨 Path B: For Creators & Marketers (The OpenClaw Route)

Deploy Levea as an autonomous editing agent directly inside the OpenClaw workspace.

1. **Install the Plugin:** Search for `openclaw-ai-video-editor` on ClawHub and install it to gain system-level execution, asset upload UI, and rendering support.
2. **Install the Skill:** Subscribe to `levea-ai-video-editor` on ClawHub Skills directory to give your agent professional editorial taste, system instructions, and pacing rules.
3. **Run your first edit:**
   > *"Review my vertical video, remove the opening silence, auto-apply Hormozi-style captions with highlighted keywords, add subtle background music, and export the Reels-ready MP4."*

---

## 🧩 OpenClaw Integration: Plugin vs. Skill

Levea is built for modular agent platforms. When deploying Levea inside platforms like OpenClaw or Hermes, we split execution capabilities from cognitive strategies:

- **The Plugin (`openclaw-ai-video-editor`):** Acts as the **physical body**. It exposes the core MCP tool surface, registers tool schemas, manages API keys, sets up SSE progress pipelines, and handles physical file uploads and rendering hooks.
- **The Skill (`levea-ai-video-editor`):** Acts as the **cognitive mind**. It is a prompt-engineered, context-aware instruction set (system prompts and few-shot creative templates) that teaches the agent how to act as a professional director—enforcing brand rules, safe zones, timing pacing, and layout aesthetics.

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
| *"Remove the background — no green screen"* | AI background removal via Robust Video Matting (RVM) alpha matte on any footage. |
| *"Swap my background for a city skyline — no green screen"* | AI matte isolates subject cleanly, compositing the new background behind. |
| *"Remove all silences and filler words, add background music"* | Cleans audio track (cuts `um`, `uh`, `like`), adds ducked music bed under speech. |
| *"Auto-zoom on whoever's talking"* | Active-speaker detection + dynamic zoom-follow framing. |
| *"Caption this and highlight every time they say 'launch'"* | Auto-captions + keyword emphasis (scaling / glow / pulse). |
| *"Find every clip where Alex appears"* | Cross-asset facial identity search using AI facial embeddings. |
| *"Add narration in a cloned voice over the intro"* | Voice cloning + Google Cloud TTS overlay + auto-ducking. |
| *"Caption this Hormozi-style with karaoke word highlighting"* | Word-synced karaoke captions — active word fills and underlines in sync with speech. |
| *"Generate B-roll over the product mention"* | AI B-roll generation + placement at the exact timestamp. |
| *"Color grade this like a Netflix doc"* | Cinematic LUT color grade with contrast and film-look curve. |
| *"Slow-mo the climax, freeze on the reveal"* | Speed change (`0.5×` slow-mo) + freeze-frame hold on key action. |
| *"Reframe to vertical but don't crop the lower-third captions"* | Caption-safe 9:16 reframe (detects on-screen text regions and reframes around them). |
| *"Pull the key stats from this and animate them as charts"* | Transcript-driven SVG charts (bars, lines, donuts) + stat-callout motion graphics via HyperFrames. |
| *"Sync these 3 camera angles and cut between them on the active speaker"* | Multi-cam audio cross-correlation sync + automatic angle switching. |
| *"Blur the license plates and bleep the swearing"* | Privacy redaction (face and moving object blur) + transcript profanity cleanup. |

---

## ⚡ Levea vs. Legacy Editors

| Capability | Legacy (Premiere, DaVinci, CapCut, Descript) | Levea Agentic Editor & Production Harness |
| :--- | :--- | :--- |
| **Interface** | Drag, drop, keyframe by hand on a manual timeline | One natural-language prompt; the agent plans and finishes the edit |
| **Auto-analysis on upload** | Manual scene detection + subtitles | Faces, active speakers, shot cuts, and on-screen text regions detected automatically |
| **"Make this viral"** | You manually hunt for hooks, crop, splice, and align | Single preset — vertical 9:16 + captions + silences + face tracking |
| **Cross-asset search** | Filename search | "Find every clip where Alex appears" using AI facial embeddings across your library |
| **Background replace** | Key out green screen or draw rotoscope masks by hand | One call — Robust Video Matting (RVM) handles any footage without a green screen |
| **Broadcast-grade audio** | Manual loudness metering + compression + EQ | Auto LUFS loudness-normalized (EBU R128), true-peak limited, music ducked under speech |
| **Editorial reasoning** | You listen and hunt for the climax | Agent surfaces narrative peaks and high-retention moments |
| **Verification & Repair** | You eyeball it and manually re-render | Deterministic verifiers run after execution; auto-repairs bounded failures |
| **Multi-platform export** | One render per aspect ratio | TikTok + Reels + Shorts + YouTube in one pass |
| **Extensibility** | Plugins call external binaries | 179 typed canonical actions orchestrated through a deterministic Workflow DAG |

---

## 🎬 Creator & Dev Use Cases

| Use Case / Request | Typical Autonomous Production Path | Organic Keywords |
| --- | --- | --- |
| **Faceless Channel Generator** | Segment transcript, plan layout, overlay B-roll, generate AI background music, and render. | `faceless-video`, `auto-reels`, `short-form-video` |
| **CapCut Auto-Cap Alternative** | Run whisper transcription, highlight keywords, style fonts, align timing, and apply animation presets. | `auto-captions`, `video-subtitles`, `kinetic-typography` |
| **Shorts & Reels Highlights** | Extract high-engagement hooks, crop canvas to vertical 9:16 safe zones, and apply motion graphics. | `viral-clips`, `clip-generator`, `tiktok-video`, `youtube-shorts` |
| **Corporate Interview Polish** | Cut long silence gaps, bleep profanity, apply color grades, and add lower third speaker graphics. | `silence-removal`, `audio-cleanup`, `lower-thirds` |
| **Green Screen & Backdrop Swap** | Isolate speaker matte, layer background photo/video, align depth tracks, and composite. | `chroma-key`, `green-screen`, `background-removal` |
| **Multi-Cam Active Speaker Cuts** | Synchronize dual camera angles, run diarization, and automatically cut to the active speaker. | `multi-cam-sync`, `active-speaker`, `video-automation` |

---

## ⚙️ Robust Verification & Repair Containment

To ensure that AI planning errors never result in broken compositions or corrupt files, Levea operates a closed-loop verification and repair containment pipeline.

```text
User correction
      ↓
Semantic-node reference resolution
      ↓
Typed repair patch
      ↓
Repair-policy validation
      ↓
Affected-subgraph invalidation
      ↓
Partial recompilation and execution
      ↓
Verification
      ↓
Atomic replacement of prior version
```

- **Internal Verifier-Driven Repair:** Levea currently supports verifier-driven bounded repair for supported typed failures. Verifier failures identify the unsatisfied invariant, repair begins from the last verified scene revision, and every repaired result is verified again before it is committed.
- **User-Directed Semantic Repair:** User-directed repair operates at the level of user-visible semantic nodes rather than low-level infrastructure tasks. Where a node type supports natural-language repair, Levea resolves the user’s reference—such as “the second chart,” “the last title,” or “the graphic after the pricing section”—to a stable semantic node and compiles the requested change into a typed patch.
- **Subgraph Invalidation:** The repair system then determines which dependent planning, asset, composition, rendering, and verification nodes are affected. Only that subgraph is invalidated and executed again; unrelated verified work is preserved. User language never directly mutates arbitrary scene JSON or internal execution tasks.
- **Bounded Budgets:** Natural-language node repair is available only for semantic node types that expose stable identity, editable fields, and a repair policy. All repair attempts remain bounded by action, attempt, cost, and time budgets.
- **Asynchronous Completion Verification:** A workflow may return a pending or partial result while optional media jobs continue. A result is considered fully verified only after all required artifact jobs complete and their outputs pass verification.

---

## 📂 Capability Status

Availability of specific tracks varies by deployment, active model tiers, and account quotas.

### Supported Production Paths
- **Project and timeline state:** Full NLE track and clip operations (insert, overwrite, lift, extract, ripple delete/trim, slip, slide, freeze frame, reverse), multi-track management, nesting containers, and durable linear undo/redo.
- **Captions and motion graphics:** automatic captions, word timing, keyword emphasis, 41+ caption templates (Hormozi, Minimal-Pro, Karaoke, Typewriter...), lower thirds, title cards, charts, counters, and diagrams through verified HyperFrames motion composites, supported native fallbacks, verified Lottie assets, and procedural animation.
- **Layout and perception:** multi-cam synchronization and active-speaker cuts, scene and shot cut analysis, face detection and tracking, cross-clip face identity search, on-screen text-region detection, safe zones, and explicit-region tracking or masking.
- **Compositing:** chroma key, masks, blend modes (17 modes), adjustment layers, alpha-matte background replacement (Robust Video Matting), and GPU volumetric shaders (smoke, fire, glitch, portal, lightning).
- **Audio:** silence and filler-word cleanup, word-level muting, crossfades, EQ, denoise, ITU-R BS.1770 / EBU R128 loudness normalization, Google Cloud TTS voiceover, speech-aware ducking, musical beat sync (`pacing_beat_sync`), and AI stem separation (`separate_stems`).
- **Autonomous Directing:** automated cold-open hook extraction, podcast polish macros, contextual B-roll placement, auto lower thirds, and slideshow generation.
- **Verification:** typed task contracts, structural validation, perceptual checks, requirement tracking, bounded repair, and partial-success reporting.

### Model- or Deployment-Dependent
- Generated video, images, B-roll, music, sound effects, voiceover, and voice cloning.
- Neural alpha matting and background replacement quality.
- OCR **recognition** of visible text.

---

## 📂 MCP Tool Surface

The MCP server exposes one high-level editing entry point plus typed management and polling tools:

| Group | Tools | Description |
| --- | --- | --- |
| **Edit** | `autonomous_edit`, `autonomous_edit_streaming`, `queue_edit` | Single-entry edit prompts, SSE progress streaming, and asynchronous queuing. |
| **Job Polling** | `check_job_status`, `check_task_status`, `get_active_task` | Track rendering, B-roll generation, tracking status, and active tasks. |
| **Caption Templates** | `list_caption_templates`, `apply_caption_template`, `save_caption_template` | CRUD operations for 41+ styling templates (Hormozi, Minimal-Pro, typewriter...). |
| **Brand Kits** | `list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit` | Manage brand colors, fonts, logos, speaker voice clones, and grading rules. |
| **Projects** | `list_projects`, `get_project`, `create_project` | Project workspace management. |
| **Assets** | `asset_upload_url`, `list_assets`, `transcribe_asset` | Request signed upload URLs, list assets, and request fast Whisper transcriptions. |
| **Diagnostics** | `editor_health` | Unauthenticated network sanity probe. |

---

## 🔮 Organic SEO FAQ for Developers & Creators

#### How does Levea compare to generic video generators like Sora, Veo, or Runway?
Generic generative video models (Sora, Runway, Veo) output raw, locked pixels. You cannot edit a layer, adjust caption typography, swap background music, or correct a word timing afterward. Levea is a **full-featured timeline editor** that builds structured project layers. It uses generative models (like Omni/Veo/Imagen) only as optional asset generation plugins, keeping your editing pipeline fully editable, inspectable, and deterministic.

#### Is Levea safe to use in enterprise productions?
Yes. Every mutation runs inside a secure, gated environment (`GatedExecutor`). High-level action contracts ensure that LLMs cannot inject arbitrary mutations or bypass security profiles. If you configure `requirePlanApproval: true`, the system will halt and present the creative plan to your team for approval before executing any edits or rendering assets.

#### What coding and agent environments does Levea support?
Levea integrates natively with **Model Context Protocol (MCP)** hosts like Claude Desktop, Cursor, Cline, Windsurf, and Claude Code. For standalone agent systems, Levea exposes structured packages for **OpenClaw** and **Hermes**.

#### Can I use custom brand fonts, logos, and specific caption templates?
Absolutely. Using our **Brand Kits API and tools**, you can declare custom typography scales, palette hex codes, logo image references, and custom voice prints. The planning model reads these rules and automatically enforces them across the timeline during the composition pass.

---

## 🔗 Links & Resources

- **Levea Studio and API Keys:** [livecore.ai](https://livecore.ai/)
- **npm MCP Server Wrapper:** [`levea-mcp-server`](https://www.npmjs.com/package/levea-mcp-server)
- **MCP Registry:** [`io.github.brajendrak00068/levea-mcp-server`](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server)
- **OpenClaw Plugin Page:** [`openclaw-ai-video-editor`](https://clawhub.ai/plugins/openclaw-ai-video-editor)
- **OpenClaw Skill Page:** [`levea-ai-video-editor`](https://clawhub.ai/skills/levea-ai-video-editor)
- **Detailed Agent Integration Guide:** [AGENTS.md](./AGENTS.md)
- **MCP Folder Documentation:** [mcp-server/README.md](./mcp-server/README.md)

**Support & Contact:** `brajendrak00068@gmail.com`

---

## License

[MIT](./LICENSE)
