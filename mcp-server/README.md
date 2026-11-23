# Levea MCP Server

> **An autonomous agentic video editor.** Send a sentence. Get a finished video. No timelines, no keyframes, no plugin chains. Open-source MCP client connecting local AI agents (Claude, Cursor, Cline) to our cloud GPU video production harness.

[![npm](https://img.shields.io/npm/v/levea-mcp-server?label=npm%20levea-mcp-server)](https://www.npmjs.com/package/levea-mcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-levea--mcp--server-orange)](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server)

> **Beta.** The agent can make mistakes. Preview every output before publishing or sharing. For high-stakes or irreversible edits, pass `requirePlanApproval: true` so the agent stops after planning and waits for your approval before anything runs.

---

## Why Use Levea Instead of Local `ffmpeg`, Python, or Standalone HTML/DOM Video Tools?

Levea goes further across the whole workflow: it runs **2D and 3D motion graphics** *inside* its cloud **GPU NLE timeline**, alongside computer vision and GPU video shaders:

| Capability | Raw `ffmpeg` / MoviePy (Local CLI) | Standalone HTML/DOM Video Tools (Local Headless Chrome) | **Levea MCP (`livecore.ai` Cloud GPU NLE + Motion Graphics)** |
| :--- | :--- | :--- | :--- |
| **Real-Time 3D Camera & Volumetric Shaders** | ❌ 2D pixel filters only; no 3D camera, depth-of-field, or volumetric lighting | ⚠️ Browser DOM/WebGL limited by headless Chrome CPU/GPU readback bottlenecks | ✅ **Real-time 3D GPU engine**: physical 3D camera (`FOV`, aperture DOF bokeh, focus pull), 3D volumetric & raymarched shaders, god rays, anamorphic flares, ACES Filmic tone mapping & 3D particles |
| **4K UHD Cloud Export (up to 60fps)** | ⚠️ CPU encoding 4K melts laptop and takes hours | ❌ Headless Chrome DOM screenshot capture OOMs or crawls at 4K | ✅ **Cloud GPU streaming compositor**: native **1080p, 2K & 4K (`3840×2160`) UHD** exports at up to **60fps** |
| **Cloud Computer Vision Models** | ❌ Zero neural vision; blind to faces, hands, depth, objects & burned-in text | ❌ Browser DOM cannot run vision models on video streams | ✅ **Dedicated cloud vision models**: face/speaker re-ID, 68-point face landmarks, full-body pose & hand tracking, video depth, hair-accurate AI matting, dense point tracking, scene OCR, shot detection, watermark inpainting, optical-flow slow-mo, 4× super-resolution & lip-sync |
| **9:16 Active-Speaker Reframe** | ❌ No face tracking: you compute a fixed crop by hand (`crop=ih*9/16:ih`), so a moving speaker drifts out of frame | ❌ DOM/CSS has no per-frame face or mouth landmark detector | ✅ **68-point face & active-mouth tracking** per frame + auto 2-up split-screen |
| **3D Camera Tracking & Hand Tracking** | ❌ None | ❌ Browser DOM cannot solve 3D camera motion or track hands/masks on video | ✅ **3D camera solve**, world-space 3D layer pinning, hand palm tracking, 2D region tracker, non-destructive stabilizer (smoothed camera path, border-hiding zoom, rolling-shutter correction) & AI person mattes |
| **Green Screen & GPU VFX Compositing** | ❌ Basic `chromakey` leaves green halos; no 3D LUT/bokeh pipeline | ❌ Headless Chrome captures DOM screenshots; no native video shader pipeline | ✅ **Cloud GPU compositor**: Keylight-grade despilled keying, depth bokeh, 368 GPU VFX presets, 168 transitions, `.cube` 3D LUTs & optical-flow motion blur |
| **Kinetic Captions (216 Templates)** | ❌ Flat static `.srt` / `drawtext` that collides with faces | ⚠️ Must hand-code CSS per video; no automatic face/chin collision solver | ✅ **216 GPU kinetic templates** (`hormozi`, `mrbeast`, `karaoke`) + measured **face/chin & TikTok safe-zone solver** |
| **Multicam Podcast & Broadcast Audio** | ❌ `silencedetect` clips word tails; no multicam speaker switching | ❌ Not an audio/multicam NLE; `<video>` tags in headless Chrome desync on long multi-track cuts | ✅ **Waveform multicam sync**, ASR word-boundary cuts, filler removal, `-18 LUFS` auto-ducking, stem separation & lip-synced dubbing |
| **Motion Graphics** | ❌ None | ✅ Full HTML/CSS/GSAP/Three.js compositions | ✅ **Included natively** — 2D/3D motion graphics plus After Effects shape layers (Trim Paths, Repeaters), composited *over* real tracked footage |
| **Human Final Polish (GUI)** | ❌ Edit the command and re-encode to nudge one word | ❌ Must edit HTML/CSS code and re-render headless Chrome frames | ✅ **1-Click `livecore.ai` Web Studio**: scrub multi-source timelines, drag captions, or swap templates without re-rendering |

---

## Contents

1. [Quickstart](#quickstart) — running in 60 seconds
2. [What it does](#what-it-does) — say it, get it
3. [Capability surface](#capability-surface) — the full toolset
4. [Goals & briefs](#goals--briefs) — from one line to a full creative brief
5. [API reference](#api-reference) — endpoints, request/response, streaming, async
6. [Who it's for](#who-its-for) · [vs. legacy editors](#vs-legacy-editors) · [Safety](#safety--limits) · [Media](#supported-media)
7. [Links & channels](#links--channels)

---

## Quickstart

The portable interface is the **[`levea-mcp-server`](https://www.npmjs.com/package/levea-mcp-server)** MCP server — one server, every MCP client (Claude Desktop, Claude Code, Cursor, Cline, OpenClaw, Hermes), one tool surface, one backend contract, so nothing drifts per platform.

**1. Get an API key** — sign up at **[livecore.ai](https://livecore.ai/?openclaw=1&utm_source=npm&utm_medium=mcp-server&utm_campaign=levea-mcp-server)** and generate a Levea API key.

**2. Add the MCP server** — the same `npx` line works for every MCP client:

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

**3. Use it** — say to your AI: *"Use the levea tool to generate 5 viral clips from this video, add captions, reframe vertical."* The agent picks the tool, fills the prompt; the editor plans → executes → exports. A full edit takes minutes, not seconds; see [Safety & limits](#safety--limits) for long edits.

### Per-client setup

| Client | How |
|---|---|
| Claude Desktop / Cursor / Cline | Add the `levea` block above to `mcpServers` — see the [`levea-mcp-server`](https://www.npmjs.com/package/levea-mcp-server) docs |
| Claude Code | `claude mcp add levea -e LEVEA_API_URL=https://api.livecore.ai -e LEVEA_API_KEY=... -- npx -y levea-mcp-server` |
| OpenClaw | The ClawHub plugin `openclaw-ai-video-editor` (chat-native) **or** `openclaw mcp add levea --command "npx -y levea-mcp-server" --env LEVEA_API_URL=https://api.livecore.ai --env LEVEA_API_KEY=...` |
| Hermes | Register `levea-mcp-server` as an MCP server in your Hermes config |

> **This package on npm:** `npx -y levea-mcp-server` — no global install needed.

### Hosted endpoint — no install

Clients that connect to a remote MCP server by URL (Smithery, Claude / ChatGPT connectors, Cursor remote servers, Grok Bot) can skip `npx` entirely:

```
URL:    https://api.livecore.ai/api/v1/misc/mcp      (Streamable HTTP, stateless)
Auth:   OAuth 2.1 with PKCE (S256) + Dynamic Client Registration (RFC 7591) — no API key required
Scope:  levea  (vendor-advertised in RFC 9728 & RFC 8414 metadata)
        or Header: Authorization: Bearer your-key-from-livecore.ai (optional fallback for non-OAuth clients)
```

| OAuth 2.1 / MCP Auth Endpoint | Value |
|---|---|
| **MCP Server URL** | `https://api.livecore.ai/api/v1/misc/mcp` |
| **Protected Resource Metadata (RFC 9728)** | `https://api.livecore.ai/.well-known/oauth-protected-resource/api/v1/misc/mcp` |
| **Authorization Server Metadata (RFC 8414)** | `https://api.livecore.ai/.well-known/oauth-authorization-server` |
| **Dynamic Client Registration (RFC 7591)** | `https://api.livecore.ai/api/v1/misc/oauth/register` |
| **Authorization Endpoint** | `https://api.livecore.ai/api/v1/misc/oauth/authorize` |
| **Token Endpoint** | `https://api.livecore.ai/api/v1/misc/oauth/token` |
| **Advertised OAuth Scope** | `levea` (`scopes_supported: ["levea"]`, `code_challenge_methods_supported: ["S256"]`) |
| **Account & Pricing** | Free tier available (3 cloud edits/month, 720p export, watermark) + paid plans at https://livecore.ai |

Same tools, same backend. OAuth-capable clients (Cursor, Grok Bot, Claude.ai, ChatGPT) register dynamically and open the Levea browser sign-in flow automatically with the `levea` scope — **no API key or client ID is needed** for both listing tools and running video edits. Non-OAuth clients can pass `Authorization: Bearer <LEVEA_API_KEY>` (or `?apiKey=...`). Every request is authenticated; an unauthenticated call returns `401` with `WWW-Authenticate: Bearer realm="levea", resource_metadata="https://api.livecore.ai/.well-known/oauth-protected-resource/api/v1/misc/mcp", scope="levea"`.

Every client calls the **same backend**: this MCP server, the hosted endpoint, the OpenClaw and Hermes plugins, and the ChatGPT action share one tool contract.

### Two hosts — don't confuse them

| Host | Use |
|---|---|
| **https://api.livecore.ai** | Functional API. Set as `LEVEA_API_URL`. The client appends `/api/v1/misc/openclaw/v1/execute` automatically — never put a full path here. |
| **https://livecore.ai** | API-key portal (UI). Get your key here. Do **not** use as `LEVEA_API_URL`. |

> Env vars are `LEVEA_API_URL` / `LEVEA_API_KEY`.

### Tools the AI sees (39 Annotated Tools Unlocking All 195 Canonical Actions, 28 Read Tools & 100+ Craft Skills)

**Two complementary editing modes plus typed state-management and polling** — so any agent can either delegate a full creative brief to Levea's autonomous editing agent (**Mode A: `autonomous_edit`**) or drive any of the **195 canonical actions**, **28 read/inspection tools**, and **100+ editing craft skills** directly with GPU screenshot inspection (**Mode B: `search_tools` → `execute_action` / `execute_batch` → `render_preview` → `EXPORT_VIDEO`**).

| Group | Tools |
|---|---|
| **Mode A: Goal Delegation** (1 entry point, 3 variants) | `autonomous_edit` (primary, JSON) · `autonomous_edit_streaming` (SSE — per-step progress) · `queue_edit` (async fire-and-forget) |
| **Mode B: Universal Direct Canonical Suite** (195 actions, 28 read tools & 100+ skills) | `search_tools` · `get_action_schema` · `execute_action` · `execute_batch` · `render_preview` (returns real GPU-composited JPEG screenshots as MCP `image` blocks, like `ffmpeg` frame grabs) · `search_skills` · `load_skill` · `read_skill_resource` |
| **ShaderFX (custom GPU shaders)** | `create_shader_effect` · `list_shader_effects` · `apply_shader_effect` · `delete_shader_effect` — write WGSL `fn fx(c: FxCtx) -> vec4<f32>` filters (read the footage via `src()`), transitions (`clip_a()` / `clip_b()`) and generators; validated server-side with line/column errors, saved to a reusable library with typed params. ABI v3: named textures, feedback trails, multi-pass, data buffers and instanced particles / sprites. Contract + examples: [`skills/shaderfx-effects`](https://github.com/brajendrak00068/agentic-ai-video-production/tree/main/skills/shaderfx-effects/SKILL.md) or `load_skill shaderfx-effects` |
| Job / task polling | `check_job_status` · `check_task_status` · `get_active_task` |
| Caption templates | `list_caption_templates` · `apply_caption_template` · `save_caption_template` · `save_current_caption_template` · `delete_caption_template` (216 built-in + your saved) |
| Brand kits | `list_brand_kits` · `get_brand_kit` · `create_brand_kit` · `update_brand_kit` · `delete_brand_kit` (palette · fonts · logo · voice · gradeBias · enforcement) |
| Projects | `list_projects` · `get_project` · `create_project` · `delete_project` |
| Assets | `asset_upload_url` (signed PUT) · `list_assets` · `delete_asset` · `transcribe_asset` |
| Diagnostics | `editor_health` |

Every direct tool call (`execute_action` / `execute_batch`) includes automatic parameter validation, async asset completion, safe-zone checks, timeline reconciliation, and layout de-stacking.

### How Skills Work & How to Use Your Own Custom Skills (`SKILL.md`)

1. **100+ Built-In Craft Skills (`search_skills` → `load_skill` → `read_skill_resource`):**
   - In **Mode A (`autonomous_edit`)**, Levea automatically loads the right craft skills for your prompt.
   - In **Mode B**, your agent can call `search_skills` (e.g. `query: "captions"`, `"color"`, `"podcast"`), call `load_skill` to pull the full `SKILL.md` craft playbook into its context, and call `read_skill_resource` to inspect reference guides or templates before running `execute_action` / `execute_batch`.
2. **12 Installable Client Skills (`npx skills add brajendrak00068/agentic-ai-video-production`):**
   - Ready-made `SKILL.md` packages in [`skills/`](https://github.com/brajendrak00068/agentic-ai-video-production/tree/main/skills) (`levea-ai-video-editor`, `viral-clips-generator`, `tiktok-reels-shorts-editor`, `auto-captions-subtitles`, `multicam-podcast-video-editor`, `silence-removal-audio-cleanup`, `ai-b-roll-motion-graphics`, `after-effects-motion-graphics`, `vfx-compositing-keying`, `motion-tracking-stabilization`, `shaderfx-effects`).
3. **Bring Your Own Custom `SKILL.md`:**
   - Drop a custom `SKILL.md` into `.claude/skills/<name>/SKILL.md` (Claude Code), `.cursor/skills/<name>/SKILL.md` (Cursor), `~/.openclaw/skills/<name>/SKILL.md` (OpenClaw), or `~/.hermes/skills/<name>/SKILL.md` (Hermes).
   - Encode your channel's `brandId`, `captionTemplatePreset` (e.g. `hormozi`), `style_reference_url`, and either a house-style `autonomous_edit` prompt template (Mode A) or an exact `execute_batch` + `render_preview` action sequence (Mode B). Your agent can even call `load_skill` inside your custom skill to combine Levea's built-in craft rules with your own house rules.

4. **Upload Your Skill to Your Levea Account (`save_skill`) — the editor edits in your style:**
   - `save_skill({ path: "~/.claude/skills/my-style" })` (local `npx levea-mcp-server`: reads `SKILL.md` and its text files such as `references/*.md`) or `save_skill({ skill_md: "---\nname: my-style\n…" })` (any client) saves it as `user/my-style`.
   - Frontmatter: `name`, `description`, `tags`, `actions` (canonical names), `apply: always` (applied to **every** `autonomous_edit` / `queue_edit` you run), and the style those edits default to where the request sets none: `brand_id`, `caption_template`, `style_reference_url`.
   - Use it: `autonomous_edit({ prompt, skills: ["user/my-style"] })` (or nothing at all with `apply: always`) — the editing agent gets your playbook in full on every step; in your own loop, `load_skill({ skill_id: "user/my-style" })`. `search_skills` lists your skills first (`mine: true`: only yours); `delete_skill` removes one. Limits: 50 skills, 48k-character playbook, 12 text resources.

5. **History, checkpoints & variants (direct tools):** every committed call is a saved version. `UNDO` / `REDO` step one version; `restore_version { revision | label }` jumps to any version or checkpoint (undoable, no confirmation); `checkpoint { label }` names one (automatic ones after assemble, after the first finishing pass and before export); `fork_variant` → edit with `variant: "<id>"` → `compare_variants { a, b, judge: true }` → `promote_variant` tries alternatives side by side without touching the main scene. Late generation jobs (`pendingJobs`) attach with `APPLY_PENDING { task_ids, wait_for_completion: true }`.

→ For agent-integration details (Mode A vs. Mode B, custom skills, the 5-phase NLE Playbook, schemas, async semantics, error handling), see **[AGENTS.md](https://github.com/brajendrak00068/agentic-ai-video-production/blob/main/AGENTS.md)**.

---

## What it does

Say it in plain language; the agent plans and finishes the edit.

| You ask | It does |
|---|---|
| "Turn this into 5 viral clips with captions and vertical reframe" | Picks the best moments, cuts, captions, reframes, exports |
| "Cut a 60-second highlight from this 2-hour podcast" | Identifies narrative peaks, trims, packages with captions |
| "Make this TikTok-ready" | Vertical 9:16 reframe + captions + silence removal + emphasis kit |
| "Export for TikTok, Reels, Shorts, YouTube, and Instagram" | One pass, all aspect ratios in one bundle |
| "Replace the green screen with a beach, keep the speaker centered" | Chroma key + background composite + motion tracking in one call |
| "Remove the background — no green screen" | AI background removal via alpha matte (any footage) |
| "Swap my background for a city skyline — no green screen" | AI matte removes the subject cleanly, then composites the new background behind |
| "Remove all silences and filler words, add background music" | Cleans the audio track, adds ducked music under speech |
| "Auto-zoom on whoever's talking" | Active-speaker detection + dynamic zoom-follow framing |
| "Caption this and highlight every time they say 'launch'" | Auto-captions + keyword emphasis (scaling / glow / pulse) |
| "Find every clip where Alex appears" | Face identity search across the project's clips |
| "Add narration in a cloned voice over the intro" | Voice cloning + TTS overlay + auto-ducking |
| "Caption this Hormozi-style with karaoke word highlighting" | Word-synced karaoke captions — active word fills + underlines in time with speech |
| "Generate B-roll over the product mention" | AI B-roll generation + placement at the right timestamp |
| "Color grade this like a Netflix doc" | Color grading with cinematic preset |
| "Slow-mo the climax, freeze on the reveal" | Speed change (slow-mo / fast-forward) + freeze-frame |
| "Reframe to vertical but don't crop the lower-third captions" | Caption-safe 9:16 reframe (detects on-screen text regions and reframes around them) |
| "Pull the key stats from this and animate them as charts" | Transcript-driven charts + stat-callout motion graphics |
| "Sync these 3 camera angles and cut between them on the active speaker" | Multi-cam sync + automatic angle switching |
| "Blur the license plates and bleep the swearing" | Privacy redaction + profanity cleanup |

---

## Capability surface

The full toolset behind the prompt. Everything below is reachable from natural language — mix and match in a single sentence.

### 🔍 Read & inspect
- **Scene state** — timeline / layer / scene structure, schema introspection
- **Search** — asset gallery (type, duration, name); transcript (keyword, semantic, timestamp)
- **Vision** — CV frame analysis (object, face, scene); on-screen text-region detection (locates chyrons / lower-thirds / burned-in captions so reframing avoids covering them)
- **Intelligence** — narrative peaks, speaker diarization, sentiment, pacing
- **Jobs** — async job status polling

### ✂️ Structural editing
- **Layers** — insert / update / replace / delete (video, audio, image, text, shape, solid, adjustment, group, light, vfx, visualizer, lottie)
- **Timing** — trim, split, retime (slow-mo 0.5×, fast-forward 2×, freeze-frame), reverse, stabilize
- **Arrange** — reposition, sequence, snap to transcript word boundaries
- **Assemble** — multi-cam sync + automatic angle switching, montage assembly (shot discovery + sequencing from source footage), slideshow generation, chapter markers, SRT import
- **Safety** — gap healing, audio normalize, duration reconcile (pre-export pass), multi-step undo / redo

### 🎬 Visual editing
- **Color grade** — brightness, contrast, saturation, hue, lift/gamma/gain, monotone cubic RGB curves, CMYK per-hue selective color, 5-point histogram levels, LUT / film-look presets (including your own `.cube` 1D/3D files), auto color, shot-to-shot color matching, vignette, chromatic aberration
- **VFX & optics** — 368 procedural VFX presets + ordered multi-effect stacks (up to 4 chained effects per layer), depth-map-driven camera lens blur (polygonal iris bokeh + highlight bloom), optical lens flares, After Effects two-tone threshold glow, layer echo motion trails, film burn, bloom, rain, dust, smoke, fire, explosion, lightning, snow, glitch, scanlines, grain, slit-scan, glassmorphism, bokeh, portal, …
- **Transitions** — 168 named transitions (wipes, whips, twitch cut hits, light-band reveals, glitches, CRT power-off, …)
- **Editing techniques** — speed ramps, time remap, and posterize time, J/L, match, and smash cuts, non-destructive warp stabilization (smooth camera path + border-hiding auto-scale), AI outpainting to a new aspect ratio, eye-contact correction, face retouch
- **Composite** — Keylight-grade screen color key (with despill, clip black/white, softness, shrink/grow), Lab/YUV/RGB color range key, spill suppression, AI background removal (alpha matte), custom SVG Bezier masks, feathered/inverted mattes, track mattes (`alpha`, `inv_alpha`, `luma`, `inv_luma`), and universal behind-subject occlusion
- **Blend & opacity** — all 29 After Effects blend modes (multiply, screen, overlay, color dodge / burn, classic dodge / burn, linear burn / light, vivid / pin light, hard mix, difference, exclusion, subtract, divide, hue / saturation / color / luminosity, additive) + per-layer & group opacity
- **Shape & transform** — native shape layers with arc-length Trim Paths, After Effects Repeater (per-copy offset/scale/rotation, opacity ramp), shape modifiers (pucker & bloat, round corners, zig zag, wiggle paths, offset paths), clip shapes (circle, dome, star, hexagon, polygon), crop, 3D rotation / perspective, spatial Bezier motion paths with auto-orient, and graph-editor velocity/influence easing
- **Lighting** — up to 8 scene lights illuminating 3D-transformed layers
- **Reframe & layout** — caption-safe vertical reframe (9:16) + vertical montage, split screen (top/bottom, L/R, PiP, grid)
- **Track** — 2D feature-region tracking (position, rotation, scale), live null parenting, planar corner-pinning, monocular 3D camera solve, face tracking with zoom-follow, hand tracking (an overlay follows the palm), branding overlays
- **Camera** — keyframed 3D camera moves (push-in, orbit, drift) with depth-based parallax

### 📊 Motion graphics & data viz
*Every graphic is placed clear of faces and reviewed by an AI critic before it reaches the timeline:*
- **Data** — transcript-driven charts (bar, line, pie), stat callouts, animated counters
- **Lower-thirds & cards** — lower-thirds, 59 title / chapter / graphic templates, real 3D extruded bevelled titles (with PBR materials, environment lighting, and camera moves), checklists, keyword pills
- **Diagrams** — flowcharts, timelines, geo callouts
- **Layouts** — collage layouts, any-layer behind-the-subject occlusion, sticker cut-outs
- **Films** — standalone motion-graphic films from one sentence: 2D motion design and 3D character films with camera moves, lighting, music, and sound design
- **CTAs** — animated subscribe / call-to-action buttons

### 💬 Captions & text
- **Generate** — auto-captions from the transcript
- **Style** — 216 built-in templates (Hormozi, Spotlight, Karaoke, phrase lockups, two-line podcast looks, …), or an AI director that picks/generates one at runtime
- **Scripts** — Latin, Indic, Arabic, Cyrillic, and Greek text
- **Animate** — per-word animations (typewriter, slide, fade, scale, rotate, bounce, flip, swing, elastic, blur, glitch, wave — each with a matching exit)
- **Typography** — crisp scalable glyphs (MSDF), stroke / outline, drop shadow, gradient fill, background pill / box, per-word karaoke fill + underline
- **Shape** — curved text paths (circle, wave, custom SVG), Lottie playback control

### 🎵 Audio
- **Clean up** — remove silences, breaths, filler words; word-level mute/cut
- **Mix** — auto-duck (sidechain music vs voice), loudness (LUFS) normalize + true-peak limiting, denoise, crossfade, EQ presets (bass-boost, vocal-clarity, warm, bright), vocal / instrumental separation
- **Library** — a reviewed, licensed music and sound-effects library; music fitted to the video length; sound design (effects on cuts and beats, room tone)
- **Generate** — SFX, music (mood/genre/BPM), voiceover (TTS or cloned voice), voice conversion
- **Dub** — translated dubs in a cloned voice, lip-synced to the speaker with measured mouth-to-audio sync; the dub is verified by listening to it (language, intelligibility)
- **DJ mix** — several tracks as one beat-matched, harmonically mixed program (tempo and musical key measured per track); music structure (sections, drops) measured from the audio
- **Sync** — external master audio alignment (timecode / explicit offset)
- **Visualize** — waveforms (bars, wave, circular)

### 🔒 Privacy & cleanup
- **Faces** — blur all faces or background-only
- **Regions** — privacy redaction (blur / cover)
- **Language** — profanity cleanup (mute / bleep)
- **Layout** — safe-zone repair

### ✨ Async generation
- **Video** — AI video / B-roll (duration + aspect)
- **Images** — AI images (single or batch at timestamps), generative image edit, auto-thumbnail extraction
- **Audio** — AI music (prompt + duration + mood + genre + BPM), AI voiceover (TTS or cloned voice library)

### 🚀 High-level presets
- **Viral** — vertical + captions + silence removal + tracking + word emphasis
- **Cinematic director** — dynamic zooms + cinematic grade + mood camera moves
- **Emphasis system** — keyword detection + coordinated scaling / glow / pulse
- **Pacing optimizer** — filler + silence + low-energy removal for retention

### 📦 Export
- **MP4** — single file (resolution / codec / quality tier)
- **Viral-clip batch** — auto-segmented short-form, packaged as a ZIP
- **Multi-platform pack** — TikTok + Reels + Shorts + YouTube + Instagram in one pass

### ✅ Also shipped
- On-screen text, logo, and watermark removal
- On-screen text recognition (OCR), enabling find-and-replace on burned-in text

---

## Goals & briefs

`autonomous_edit` accepts anything from a five-word command to a five-hundred-word creative brief.

**1. Direct commands** — a single edit, single result. The [What it does](#what-it-does) examples above are all direct commands.

**2. Open-ended goals** — hand the agent a *goal* instead of a command; it inspects the asset, then proposes a plan:

```text
"Watch this and tell me how to make it more engaging for TikTok"
"Look at the first 30 seconds and suggest 3 ways to hook the viewer"
"Review this footage and propose edits to tighten the pacing"
```

Pair these with `requirePlanApproval: true` for propose-only mode — the agent stops after planning and waits for your approval (see [Plan approval](#plan-approval)).

**3. Full creative briefs** — multi-step orchestrations executed end-to-end. The agent plans the edit, executes each step, verifies the result on the rendered frames, and exports every requested format. Use SSE to watch each step land in real time.

<details>
<summary>Example brief (~20 actions composed in one planned run)</summary>

> Transform this video into a viral social media documentary. Start by trimming the first 3 seconds and last 5 seconds to remove dead air. Apply a cinematic color grade with warm tones and high contrast. Generate auto-captions with bold yellow text and black outline, positioned bottom center. Add a dynamic zoom-in on the main subject during the first 10 seconds. Insert 3 contextual b-roll clips where the speaker mentions visual concepts. Apply face tracking to keep the subject centered when converting to vertical 9:16 for TikTok and Reels. Add an upbeat background track that matches the energy, with auto-ducking when the speaker talks. Remove all silence gaps longer than 0.5 seconds. Apply a subtle vignette. Add my logo watermark top-right at 80% opacity. Generate a custom thumbnail from the most expressive frame with bold "MUST WATCH" text. Create an animated subscribe button that appears at 5 seconds and pulses. Add whoosh SFX for transitions. Apply noise reduction. Split at 30 seconds to insert a 2-second transition. Add animated counter overlays for key statistics. Blur background faces for privacy. Export in 1080p for YouTube plus optimized TikTok, Reels, and Shorts versions with platform-specific aspect ratios.

</details>

No timeline UI, no per-step API calls, no glue code on your side.

---

## API reference

Base URL: `{LEVEA_API_URL}` (production: `https://api.livecore.ai`). Auth on every request:

```http
Authorization: Bearer {LEVEA_API_KEY}
```

All paths are under `/api/v1/misc/openclaw`.

| Endpoint | Purpose |
|---|---|
| `POST /v1/execute` | Run `autonomous_edit` (the main entry point) |
| `POST /v1/queue-edit` | Fire-and-forget async edit |
| `GET  /v1/jobs/{jobId}` · `GET /v1/task-status/{taskId}` | Poll async render / generation jobs |
| `GET  /v1/projects/{id}/active-task` | The project's in-flight task, if any |
| `GET  /v1/tools` · `GET /v1/health` | List tool names · health check |
| `/v1/brands` · `/v1/projects` · `/v1/assets/*` | Brand-kit / project / asset CRUD — list · get · create · update · delete |
| `/v1/caption-templates` (+ `/apply`, `/save-current`) | Caption-template CRUD + apply |

Each management group above is also exposed as a typed MCP tool (see [Tools the AI sees](#tools-the-ai-sees)).

> `LEVEA_API_URL` is the bare host `https://api.livecore.ai` — not a full path, not `livecore.ai`, and not the in-product `/api/v1/misc/editor/` route.

### Request

Every edit goes through one tool — `autonomous_edit`. Pass a natural-language description; the agent plans, executes, verifies, and exports. No tool list to memorize, no structured params to learn.

```bash
curl -sS -X POST "$LEVEA_API_URL/api/v1/misc/openclaw/v1/execute" \
  -H "Authorization: Bearer $LEVEA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "autonomous_edit",
    "params": {
      "prompt": "Make this a TikTok-ready viral clip: vertical reframe, bold captions, remove silences, motion-track the speaker, and export."
    },
    "project_id": "my-project"
  }'
```

`prompt` is the only required field. Everything else is optional:

<!-- edit-contract:start (generated from contract/edit-contract.json — edit that file, then run node scripts/sync-contract.mjs) -->
| Field | What it does |
|---|---|
| `prompt` | Description of the video edit to perform, in the user's own words. (**required**) |
| `project_id` | Project identifier returned by a prior call; reuse it for every follow-up edit on the same video. |
| `video_url` | Public source video URL when starting a new project. |
| `assets` | Input media (video, image, audio) as public HTTP/HTTPS URLs. |
| `scene` | Existing scene/timeline state to continue editing (advanced). |
| `captionTemplatePreset` | Caption template id to apply: a builtin slug (e.g. `hormozi`, `viral-pop`, `karaoke`) or a saved template id. With the MCP server, `list_caption_templates` lists the exact ids; elsewhere, name the look in the prompt. |
| `captionTemplateMode` | How to apply `captionTemplatePreset`: one of `add`, `recreate`, `style`, `translate`, `clear`, `remove_fillers`. |
| `requirePlanApproval` | When `true`, pause after planning and return `workingMemory` for the user to approve. |
| `workingMemory` | State returned by a paused plan-approval call; send it back to resume. |
| `editedPlan` | The user's edited version of a plan returned by an approval pause. |
| `planDecision` | Set to `"approve"` to approve the plan from an approval pause; resend it with that response's `workingMemory`. |
| `attachedImages` | Reference image URLs for planning (style, branding). |
| `style_reference_url` | A reference video whose editing style the result should match (pacing, captions, framing, zooms, transitions, grade). |
| `skills` | Your own saved skills (save_skill) to apply to this edit, as "user/<slug>" ids. Skills saved with apply: always are applied to every edit without being named. |
| `flaggedIssues` | Specific problems the user flagged that this run must fix. |
| `brandId` | Brand kit to apply to this call. |
| `projectBrandId` | Default brand kit for the project; persists across calls. |
| `core_only` | Return only rendering-essential scene fields (smaller responses). |
<!-- edit-contract:end -->

### Response

```json
{
  "type": "success | partial_success",
  "tool": "autonomous_edit",
  "success": true,
  "partial": false,
  "status": "completed | failed | awaiting_approval",
  "scene": { },
  "reply": "Human-readable summary of what changed",
  "message": "Short status message",
  "videoUrl": "https://.../output.mp4",
  "jobId": "12345",
  "viral_clips": [ ],
  "zip_url": "https://.../clips.zip",
  "activeTasks": [ ],
  "pendingAsyncJobs": [ ],
  "verificationPassed": true,
  "verificationIssues": [],
  "verificationReport": { "status": "verified", "repairs": [], "counts": { "failedVerification": 0, "repairsAttempted": 0 } },
  "qualityNotes": [],
  "quality": {
    "score": 0.94,
    "stepsTotal": 7,
    "stepsFailed": 0,
    "hasExportedMedia": true,
    "mediaReachable": true
  },
  "processingTime": 12.3,
  "workingMemory": { }
}
```

`jobId` is the numeric `task_id` (a string of digits), not a `task_`-prefixed value. `quality` is a calibrated post-run score block; `partial` is the top-level partial-success flag (mirrors `type: "partial_success"`).

### SSE streaming

Set `Accept: text/event-stream` or `?stream=true`. Notable event types:

| Event | Meaning |
|---|---|
| `heartbeat` | 15s keepalive |
| `status` · `phase` | Phase / status transitions |
| `thought` · `reasoning_chunk` | Per-step reasoning visibility |
| `tool_call` · `tool_result` | Action started / finished |
| `background_job_completed` | Async job done |
| `success` / `partial_success` / `awaiting_approval` | Terminal payload |
| `error` | Terminal failure |

### Async job lifecycle

Generation actions return immediately with a `jobId`. Poll until terminal:

```bash
JOB_ID=$(jq -r '.jobId // .activeTasks[0].intent.job_id' /tmp/result.json)
while true; do
  STATUS=$(curl -sS "$LEVEA_API_URL/api/v1/misc/openclaw/v1/jobs/$JOB_ID" \
    -H "Authorization: Bearer $LEVEA_API_KEY" | jq -r '.status')
  echo "Status: $STATUS"
  case "$STATUS" in completed|succeeded|failed|error|cancelled) break;; esac
  sleep 5
done

curl -sS "$LEVEA_API_URL/api/v1/misc/openclaw/v1/jobs/$JOB_ID" \
  -H "Authorization: Bearer $LEVEA_API_KEY" | jq '.result'
```

### Auto-export

After any **mutating** tool call that changed the scene (including partial successes), if no export is already queued the route auto-fires one **synchronously** — so the response carries a real `videoUrl`. Read-only and conversational `autonomous_edit` calls do **not** trigger auto-export.

### Plan approval

Pass `requirePlanApproval: true` to make the agent stop after planning. It returns `status: "awaiting_approval"` + populated `workingMemory`. Resume by sending the same `workingMemory` with `planDecision: "approve"` (or an approval prompt such as `yes`, `approve`, `go`), optionally with an `editedPlan`. To change the plan instead, send a new prompt with the same `workingMemory`.

### Verification report

Every edit result carries `verificationReport`: `status` is `verified` (approved on the rendered frames), `rejected`, `unverified` (no verdict could be reached; the edit is kept but never reported as verified), or `not_applicable`, plus every task that failed its check, what the repair loop tried, and whether it was repaired. `qualityNotes` lists advisory notes.

---

## Who it's for

| Audience | What they get |
|---|---|
| **Creators & influencers** | Long videos → TikToks / Reels / Shorts · auto-captions · viral-clip generation · AI thumbnails |
| **Podcasters** | Video-podcast highlights · audiograms · multi-cam editing · silence + filler-word removal |
| **Marketers & agencies** | Ad creation at scale · social-first repurposing · brand-overlay automation · multi-platform exports |
| **Educators & course creators** | Tutorial editing · auto-chapters · title / chapter cards · auto-captions · word-level emphasis |
| **YouTubers** | Long-form → Shorts pipeline · thumbnail generation · intro/outro automation · chapter markers |
| **Sales & SaaS** | Product demos · walkthrough highlights · cloned-voice narration |
| **Event teams** | Webinar / conference highlights · multi-cam stitching · speaker spotlight reels |
| **Faith & community** | Sermon clips for social · message highlights · multi-platform packaging |

---

## vs. legacy editors

| | Legacy (Premiere, DaVinci, CapCut, Descript) | Levea MCP Server |
|---|---|---|
| **Interface** | Drag, drop, keyframe by hand | One sentence; the agent does the rest |
| **Auto-analysis on upload** | Manual scene detection + subtitles | Faces, speakers, shots, on-screen text regions, mattes detected automatically |
| **"Make this viral"** | You build the workflow | Single preset — vertical + captions + silences + tracking |
| **Face search** | Filename search | "Find every clip where Alex appears" across the project's clips |
| **Background replace** | Key out, find background, composite | One call |
| **Broadcast-grade audio** | Manual loudness metering + EQ | Auto LUFS loudness-normalized + true-peak limited, music auto-ducked under speech |
| **Editorial reasoning** | You decide the climax | Agent surfaces narrative peaks and reaction moments |
| **Verification** | You eyeball it | Verifier runs after execution; auto-repairs on failure |
| **Multi-platform export** | One render per ratio | TikTok + Reels + Shorts + YouTube + Instagram in one pass |
| **Extensibility** | Plugins call external binaries | Typed tools called by name |

This isn't an editor with AI features bolted on — it's an autonomous agent that finishes the edit for you.

---

## Safety & limits

- **Beta** — outputs can be wrong. Preview every result before sharing. For irreversible workflows, pass `requirePlanApproval: true` to inspect and approve the plan first.
- OAuth or API-key authentication on every request.
- Destructive actions (mass deletes, clears) require explicit confirmation params.
- Output is verified after execution; auto-repairs on failure.
- Concurrent identical requests are deduplicated server-side.
- Rate-limited per account. Read-only questions take seconds; a simple edit with export takes a few minutes; a full edit with motion graphics, music, and export can take 10–20 minutes.
- Long edits outlive a single MCP request: `autonomous_edit` waits up to 5 minutes (`LEVEA_REQUEST_TIMEOUT_MS`) and `autonomous_edit_streaming` up to 30 (`LEVEA_STREAM_TIMEOUT_MS`), then return `status: "running"` with the `project_id`; the edit keeps running, and `get_active_task` follows it. For full edits, `queue_edit` + `check_task_status` is the most robust path.

---

## Supported media

| | Formats |
|---|---|
| **Video in** | MP4, MOV, WebM (HTTP/HTTPS URLs, YouTube URLs, gallery IDs) |
| **Image in** | JPG, PNG, WebP |
| **Audio in** | MP3, WAV, M4A, AAC (or extracted from video) |
| **Output** | MP4 (export), ZIP (viral clips / multi-platform bundles) |
| **Long sources** | Long podcasts and webinars are supported; short-form requests are trimmed to the hook first, so heavy processing runs only on the kept segment |
| **Recommended resolution** | 1080p or 4K; canvas configurable per project |

---

## Links & channels

| Channel | Identifier / link |
|---|---|
| npm (MCP server) | [`levea-mcp-server`](https://www.npmjs.com/package/levea-mcp-server) |
| MCP Registry | `io.github.brajendrak00068/levea-mcp-server` ([registry](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server)) |
| ClawHub plugin | [`openclaw-ai-video-editor`](https://clawhub.ai/plugins/openclaw-ai-video-editor) |
| ClawHub skill (agentic) | [ai-agentic-video-editor](https://clawhub.ai/brajendrak00068/skills/ai-agentic-video-editor) |
| ClawHub skill (Levea brand) | [levea-ai-video-editor](https://clawhub.ai/brajendrak00068/skills/levea-ai-video-editor) |
| Sign up + API keys | [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=npm&utm_medium=mcp-server&utm_campaign=levea-mcp-server) |
| API base | `https://api.livecore.ai` |

> Versions aren't pinned here — `npx -y levea-mcp-server` and the ClawHub listing always pull the latest, and the linked npm / ClawHub pages show the current version. You never need a specific number.

**Support** — setup help, integration questions, or issue reports: [brajendra@livecore.ai](mailto:brajendra@livecore.ai) or [GitHub issues](https://github.com/brajendrak00068/agentic-ai-video-production/issues).

**Privacy & telemetry** — edits send your prompt, source URLs, and project ids to the Levea API. The client also sends a tiny anonymous usage ping (event name, client version, whether a key is set; never prompts, media, or keys). Turn it off with `LEVEA_TELEMETRY=off`. See the [privacy policy](https://www.livecore.ai/privacy).

**License** — MIT
