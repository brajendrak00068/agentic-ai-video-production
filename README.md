<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-light.png">
    <img alt="Levea AI Video Editor" src="https://raw.githubusercontent.com/brajendrak00068/agentic-ai-video-production/main/assets/logo-dark.png" width="340" />
  </picture>
</p>

<h1 align="center">Levea — AI Video Editor for Claude, ChatGPT, Cursor & any MCP agent</h1>

<p align="center">
  <b>Edit real footage by talking to your AI agent.</b><br/>
  Cuts, captions, 9:16 reframes, music, color, motion graphics, VFX — rendered on cloud GPUs and exported as MP4.<br/>
  Nothing to install. Every edit is an editable project you can open in the web studio.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/levea-mcp-server"><img src="https://img.shields.io/npm/v/levea-mcp-server?label=npm%20levea-mcp-server" alt="npm"></a>
  <a href="https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server"><img src="https://img.shields.io/badge/MCP%20Registry-levea--mcp--server-orange" alt="MCP Registry"></a>
  <a href="https://clawhub.ai/plugins/openclaw-ai-video-editor"><img src="https://img.shields.io/badge/ClawHub-Plugin-blue" alt="ClawHub Plugin"></a>
  <a href="https://clawhub.ai/brajendrak00068/skills/levea-ai-video-editor"><img src="https://img.shields.io/badge/ClawHub-Skill-orange" alt="ClawHub Skill"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <a href="https://www.claudeai.directory/launches/levea" target="_blank" rel="noopener">
    <img src="https://www.claudeai.directory/badge/levea?theme=dark" alt="Levea - Listed on Claude AI Directory" width="220" height="54" />
  </a>
</p>

---

## 🚀 Start in 60 seconds

**1. Connect.** Pick where you work and paste one line. The hosted server signs you in with OAuth in the browser — no API key, nothing to run locally.

| Where you work | Do this |
| :--- | :--- |
| **Claude.ai / Claude Desktop** | **Settings → Connectors → Add custom connector** → paste `https://api.livecore.ai/api/v1/misc/mcp` |
| **ChatGPT** | **Settings → Connectors → Create** → MCP server URL `https://api.livecore.ai/api/v1/misc/mcp` |
| **Claude Code** | `claude mcp add --transport http levea https://api.livecore.ai/api/v1/misc/mcp` → run `/mcp` → sign in |
| **Claude Code (plugin + skill)** | `claude plugin marketplace add brajendrak00068/agentic-ai-video-production` then `claude plugin install levea-video-editor@levea` |
| **Cursor** | `~/.cursor/mcp.json` → `{"mcpServers":{"levea":{"url":"https://api.livecore.ai/api/v1/misc/mcp"}}}` |
| **Windsurf** | `mcp_config.json` → `{"mcpServers":{"levea":{"serverUrl":"https://api.livecore.ai/api/v1/misc/mcp"}}}` |
| **Cline** | `{"mcpServers":{"levea":{"type":"streamableHttp","url":"https://api.livecore.ai/api/v1/misc/mcp"}}}` |
| **Gemini CLI** | `gemini extensions install https://github.com/brajendrak00068/agentic-ai-video-production` |
| **Grok Bot / Mistral Le Chat** | Add an MCP server by URL: `https://api.livecore.ai/api/v1/misc/mcp` |
| **OpenClaw** | `openclaw plugins install clawhub:openclaw-ai-video-editor` and `clawhub install levea-ai-video-editor` |
| **Hermes** | `hermes plugins install levea-video-editor && hermes plugins enable levea-video-editor` |
| **No MCP at all** | Web studio at [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=github&utm_medium=readme&utm_campaign=agentic-ai-video-production) · Telegram [@Levea_editing_bot](https://telegram.me/Levea_editing_bot) |

> Client can't do OAuth? Send `Authorization: Bearer <your Levea API key>` to the same URL, or use the [local stdio server](#local-stdio-server-fallback). Get a free key at [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=github&utm_medium=readme&utm_campaign=agentic-ai-video-production).

**2. Ask.** Paste this into your agent, with your own video link:

> *"Take https://example.com/talk.mp4, cut it to a 30-second vertical clip with the strongest hook first, remove silences, add word-by-word captions and soft background music, show me a preview frame, then export the MP4."*

**3. Get your video.** The agent returns preview frames while it works and an MP4 link at the end. The same project opens in the [web studio](https://livecore.ai/) if you want to drag a caption or nudge a cut by hand.

---

## 🎬 What you can ask for

| You say | Levea does |
| --- | --- |
| *"Turn this podcast into 5 viral clips"* | Finds the strongest moments, cuts each with a hook first, reframes to 9:16, captions, exports |
| *"Make this TikTok-ready"* | 9:16 active-speaker reframe + captions + silence and filler removal |
| *"Caption this Hormozi-style, highlight 'launch'"* | Word-timed captions from 216 templates, keyword emphasis, kept off faces |
| *"Remove silences and the ums, add music"* | Word-boundary cuts, a licensed music bed, ducked under speech |
| *"Sync these 3 camera angles and cut on whoever's talking"* | Audio-based multicam sync + active-speaker switching |
| *"Swap my background for a city skyline — no green screen"* | AI matte of the speaker composited over the new background |
| *"Grade this like a Netflix doc"* | Cinematic look, contrast curve, shot-to-shot color matching |
| *"Pull the key stats and animate them as charts"* | Transcript-driven charts, counters and callouts placed clear of faces |
| *"Put the price tag in her hand and keep it there"* | Hand tracking: the overlay follows the palm |
| *"Dub this into Spanish in my voice and lip-sync it"* | Translated, voice-cloned dub with measured mouth-to-audio sync |
| *"Blur the license plates and bleep the swearing"* | Object/face blur + transcript-based profanity bleeps |
| *"Make a 15-second 3D animation of a robot racing a deadline"* | An original motion-graphics film with camera moves, music and sound design |
| *"Export for TikTok, Reels, Shorts and YouTube"* | Every aspect ratio in one pass, loudness-mastered per platform |

---

## 🧠 How it works: two ways to drive it

Levea is a cloud non-linear editor (multi-track timeline, GPU compositor, vision and audio models) exposed as MCP tools. Your agent can drive it two ways:

| | **Direct tools** (default) | **Autonomous mode** (opt-in) |
| --- | --- | --- |
| **Who plans the edit** | Your agent (Claude, GPT, …) | Levea's own editing agent |
| **Main tools** | `execute_batch` / `execute_action` (edits, plus read tools like `timeline_view` and `source_map`), `render_preview`, `search_tools` | `autonomous_edit`, `queue_edit` |
| **Best for** | Precise control, step-by-step review, your own house style | "Here's the footage and a brief — just make it" |
| **Speed** | Most edits apply in about a second; generation, judging and export take longer | Minutes (10–20 for a full edit with motion graphics, music and export) |
| **Checking** | Your agent looks at `render_preview` frames and runs `VERIFY_EDIT` | Levea checks the rendered frames, repairs failures and returns a `verificationReport` |

**Turning on autonomous mode:**
- **Hosted endpoint:** currently lists all 39 tools, autonomous mode included (it moves to the direct-tools default in a later release).
- **Local `levea-mcp-server` (0.8.0+):** set `LEVEA_ENABLE_AUTONOMOUS=1`. In the Claude Desktop `.mcpb`, switch on **Enable autonomous mode**.
- **OpenClaw and Hermes plugins:** both modes are always on.

### What a direct-tools edit looks like

Your agent typically needs about four calls:

```jsonc
// 1. Seed a project and look at it
execute_batch { "video_url": "https://example.com/talk.mp4",
                "actions": [{ "action": "timeline_view" }, { "action": "source_map" }] }
// → returns project_id; pass it on every later call

// 2. All edits in one batch, in NLE order (cut → reframe → overlays → audio).
//    Add "dry_run": true first to validate every param in under a second.
execute_batch { "project_id": "…", "actions": [
  { "action": "REMOVE_SILENCES",   "params": { "layer_id": "@primary", "remove_filler_words": true, "crossfade_ms": 20 } },
  { "action": "VERTICAL_REFRAME",  "params": { "aspect_ratio": "9:16", "mode": "track_face" } },
  { "action": "GENERATE_CAPTIONS", "params": { "style": "hormozi", "max_words_per_chunk": 3, "position": "bottom" } },
  { "action": "COLOR_GRADE",       "params": { "color_preset": "teal_orange", "look_intensity": 0.6 } },
  { "action": "GENERATE_MUSIC",    "params": { "prompt": "warm lo-fi 90 BPM", "mix_role": "under_dialogue" } },
  { "action": "AUTO_DUCK",         "params": { "mode": "music_under_speech", "duck_db": -14 } }
]}

// 3. Look at the real GPU-rendered frames
render_preview { "project_id": "…", "timestamps": [1.5, 8, 20] }

// 4. Deliver (loudness mastering and a safe polish pass run automatically)
execute_action { "project_id": "…", "action": "EXPORT_VIDEO", "params": { "quality": "high" } }
// → videoUrl, or a jobId for check_job_status
```

Useful things to know:
- **Start with `timeline_view`.** It returns the whole edit as one short text block: every layer with its times, source range, text, style and position. Re-read it after a batch to see exactly what changed.
- A batch is **atomic**: if a step fails, nothing is saved, unless you pass `allow_partial`.
- **Every call is saved as a version.** `UNDO`, `restore_version`, `checkpoint` and variants (`fork_variant` → `compare_variants` → `promote_variant`) let you try alternatives safely.
- **References save lookups:** `@primary`, `@last`, `@all:caption`, `@end-3`, `@shot:4.start`, `@word:"welcome".end`.
- **For edits that pick or reorder moments** (shorts, highlights, cut-downs), go story-first: `source_map` → `PLAN_EDITORIAL_CUT` → `ASSEMBLE_PICTURE_EDIT`, then finish.
- `search_tools` (with no query) returns the full action list plus an editorial playbook. `get_action_schema` returns the exact parameters for any action.

---

## 🧰 The tool surface

There are **35 MCP tools by default (39 with autonomous mode)**. Through them your agent reaches **195 editing actions**, **28 read and inspection tools**, and **100+ craft skills**.

| Group | Tools |
| --- | --- |
| **Edit & inspect** | `search_tools`, `get_action_schema`, `execute_action`, `execute_batch`, `render_preview` |
| **Autonomous** (opt-in) | `autonomous_edit`, `autonomous_edit_streaming`, `queue_edit`, `get_active_task` |
| **Craft skills** | `search_skills`, `load_skill`, `read_skill_resource`, `save_skill`, `delete_skill` |
| **Jobs** | `check_job_status`, `check_task_status` |
| **Caption templates** | `list_caption_templates`, `apply_caption_template`, `save_caption_template`, `save_current_caption_template`, `delete_caption_template` |
| **Brand kits** | `list_brand_kits`, `get_brand_kit`, `create_brand_kit`, `update_brand_kit`, `delete_brand_kit` |
| **Projects** | `list_projects`, `get_project`, `create_project`, `delete_project` |
| **Assets** | `asset_upload_url`, `list_assets`, `delete_asset`, `transcribe_asset` |
| **ShaderFX** (your own GPU effects in WGSL) | `create_shader_effect`, `list_shader_effects`, `apply_shader_effect`, `delete_shader_effect` |
| **Diagnostics** | `editor_health` |

**Read tools** (run inside `execute_batch` / `execute_action`):
- **Timeline:** `timeline_view`, `list_layers`, `inspect_layer`
- **Sources and footage:** `source_map`, `list_sources`, `search_shots`, `bin_search`, `shot_timeline`, `contact_sheet`, `view_source_frames`
- **Transcripts:** `query_transcript`, `read_source_transcript`
- **Measurements:** `measure_audio`, `measure_picture`, `measure_color`, `music_structure`
- **Watch and listen:** `watch_source_video`, `listen_source_audio`, `watch_timeline`, `hear_mix`, `hear_audio`
- **History and variants:** `list_versions`, `scene_diff`, `scene_changes`, `list_variants`, `compare_variants`

**Preset catalogs** (browse with `search_tools { catalog }`):
- 216 caption templates
- 368 GPU VFX
- 168 transitions
- 61 title-card templates
- color presets and LUTs, fonts, and all 29 After Effects blend modes

---

## 🧩 Skills

**Built-in craft skills (100+).** These are production playbooks for hooks, podcasts, documentary montage, color, captions, motion graphics, VFX and audio mastering. Your agent finds them with `search_skills` and reads them with `load_skill` and `read_skill_resource`. Autonomous mode picks the right ones automatically.

**Client skills in this repo.** They teach your agent when and how to call Levea. Install them all with:

```bash
npx skills add brajendrak00068/agentic-ai-video-production   # Claude Code, Cursor, Codex, OpenCode, Gemini CLI
clawhub install levea-ai-video-editor                         # OpenClaw
```

| Skill | Focus |
|---|---|
| [`levea-ai-video-editor`](./skills/levea-ai-video-editor/SKILL.md) | Full end-to-end editing, both modes (start here) |
| [`ai-video-editor`](./skills/ai-video-editor/SKILL.md) · [`ai-agentic-video-editor`](./skills/ai-agentic-video-editor/SKILL.md) · [`openclaw-ai-video-editor`](./skills/openclaw-ai-video-editor/SKILL.md) | General editing entry points for different hosts |
| [`viral-clips-generator`](./skills/viral-clips-generator/SKILL.md) | Multi-clip highlights from long recordings |
| [`tiktok-reels-shorts-editor`](./skills/tiktok-reels-shorts-editor/SKILL.md) | 16:9 → 9:16 active-speaker reframes and hooks |
| [`auto-captions-subtitles`](./skills/auto-captions-subtitles/SKILL.md) | Word-synced captions, translation, dubbing |
| [`multicam-podcast-video-editor`](./skills/multicam-podcast-video-editor/SKILL.md) | Multicam sync and speaker switching |
| [`silence-removal-audio-cleanup`](./skills/silence-removal-audio-cleanup/SKILL.md) | Silence/filler cuts, voiceover, ducking, loudness |
| [`ai-b-roll-motion-graphics`](./skills/ai-b-roll-motion-graphics/SKILL.md) | B-roll cutaways, charts, lower thirds, callouts |
| [`after-effects-motion-graphics`](./skills/after-effects-motion-graphics/SKILL.md) | Shape layers, Trim Paths, Repeaters, 3D titles |
| [`vfx-compositing-keying`](./skills/vfx-compositing-keying/SKILL.md) | Keying, AI mattes, depth bokeh, LUTs, VFX |
| [`motion-tracking-stabilization`](./skills/motion-tracking-stabilization/SKILL.md) | Tracking, hand attachment, 3D camera solve, stabilization |
| [`shaderfx-effects`](./skills/shaderfx-effects/SKILL.md) | Write your own WGSL filters, transitions, generators |

**Your own house style.** Write a `SKILL.md` with your rules: brand kit, caption template, reference video, and an exact `execute_batch` recipe or an autonomous brief. Then save it to your Levea account so it works from every client:

```
save_skill { "path": "~/.claude/skills/my-show-style" }      // local server
save_skill { "skill_md": "---\nname: my-show-style\n…" }      // hosted clients
```

It becomes `user/my-show-style`, shows up first in `search_skills`, and with `apply: always` in its frontmatter it applies to every autonomous edit. Limits: 50 skills, 48k characters each, 12 bundled files. After that you can just say *"Edit episode12.mp4 using my-show-style."*

---

## ✨ What's under the hood

- **Editing:** a multi-track timeline with ripple/roll/slip/slide, J/L, match and smash cuts, speed ramps and time remap, freeze frames, nesting, and full version history.
- **Framing & perception:**
  - Face, active-speaker and identity tracking
  - 9:16 / 4:5 / 1:1 reframes, with automatic split-screen when two people are in frame
  - Shot detection, on-screen text detection and OCR
  - 2D tracking, hand tracking, 3D camera solve, stabilization
- **Captions:** 216 kinetic templates, kept off faces and out of platform UI zones, in Latin, Indic, Arabic, Cyrillic and Greek scripts.
- **Motion graphics:**
  - Lower thirds, 61 title cards, 3D extruded titles, charts, counters
  - After Effects-style shape layers
  - Full 2D/3D motion-graphic films, reviewed by an AI critic before delivery
- **Compositing & color:**
  - Keying with despill, AI mattes and background replacement
  - Masks, track mattes, 29 blend modes, LUTs (including your own `.cube`)
  - Curves, color matching, depth-based lens blur
  - 368 GPU VFX and 168 transitions, plus your own WGSL shaders
- **Audio:**
  - A licensed music and sound-effects library, music fitted to length
  - Silence/filler cleanup, EQ, denoise, speech-aware ducking
  - EBU R128 loudness mastering per platform, stem separation
  - Voiceover, voice cloning, lip-synced dubbing, beat-matched DJ mixes
- **Delivery:** public links (including Google Drive files and folders), MP4 in every platform aspect ratio, up to 4K at 60 fps.

> Generated media (video, images, B-roll, music, voice) and neural matting/lip-sync quality depend on model tier and account quota.

---

## ✅ How you know it worked

- **Direct tools:** results come back marked `unverified` until you check them.
  - `render_preview` returns the real composited frames.
  - `VERIFY_EDIT` lists craft problems, each with a suggested fix action: faces covered, words cut mid-way, black frames, unreadable text.
  - `measure_audio` and `measure_color` give the numbers.
  - `EXPORT_VIDEO` fixes safe defects first and reports the rest in `polish`.
- **Autonomous mode:** every result carries a `verificationReport`. `verified` means the final review of the rendered frames passed; `unverified` means no verdict was reached, and the report lists what failed and what repair tried.
- **Corrections:** send a follow-up with the same `project_id`. Nothing is lost; every version is saved.

---

## Local stdio server (fallback)

Only needed if your client can't connect to a remote MCP server. It's a thin proxy to the same cloud editor; no editing runs on your machine.

```jsonc
{
  "mcpServers": {
    "levea": {
      "command": "npx",
      "args": ["-y", "levea-mcp-server"],
      "env": { "LEVEA_API_KEY": "your-key-from-livecore.ai" }   // add "LEVEA_ENABLE_AUTONOMOUS": "1" for autonomous mode
    }
  }
}
```

The Claude Code equivalent is `claude mcp add levea -e LEVEA_API_KEY=... -- npx -y levea-mcp-server`. Claude Desktop users can instead double-click the `.mcpb` from the [latest release](https://github.com/brajendrak00068/agentic-ai-video-production/releases/latest). The full reference (env vars, HTTP API, timeouts) is in [mcp-server/README.md](./mcp-server/README.md).

---

## 🔮 FAQ

**How is this different from Sora, Veo or Runway?**
Those generate locked pixels. Levea edits *your* footage into a structured, editable project. Generative models are only optional steps for things like B-roll or music.

**Why not just let Claude Code run ffmpeg?**
ffmpeg can't see faces, speakers, shots or words. Levea can: it tracks faces for reframes, cuts on word boundaries, keeps captions off faces, mixes to broadcast loudness, and renders on cloud GPUs up to 4K. You also get an editable project instead of a re-encode.

**Is it safe for client work?**
Every change runs through a typed, allow-listed action engine, and every version is saved and restorable. In autonomous mode, `requirePlanApproval: true` stops after planning so you can approve or edit the plan first.

**How long does an edit take?**
- Direct edits: about a second.
- Previews: a few seconds.
- A simple autonomous edit with export: a few minutes.
- A full edit with motion graphics and music: 10–20 minutes.

Long calls return `status: "running"`; poll `check_task_status` or `get_active_task` rather than re-sending.

**Can I use my brand fonts, colors and logo?**
Yes. Create a brand kit (`create_brand_kit`) and pass its id. Off-palette colors fail the check and are repaired.

---

## 🔗 Links

- **Studio & API keys:** [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=github&utm_medium=readme&utm_campaign=agentic-ai-video-production)
- **Guide for AI agents:** [AGENTS.md](./AGENTS.md)
- **MCP server reference & HTTP API:** [mcp-server/README.md](./mcp-server/README.md)
- **npm:** [`levea-mcp-server`](https://www.npmjs.com/package/levea-mcp-server)
- **MCP Registry:** [`io.github.brajendrak00068/levea-mcp-server`](https://registry.modelcontextprotocol.io/v0/servers?search=levea-mcp-server)
- **ClawHub:** [plugin](https://clawhub.ai/plugins/openclaw-ai-video-editor) · [skill](https://clawhub.ai/brajendrak00068/skills/levea-ai-video-editor)
- **Other packages in this repo:** [`claude-plugin/`](./claude-plugin) · [`chatgpt-plugin/`](./chatgpt-plugin) · [`chatgpt/`](./chatgpt) (Custom GPT OpenAPI) · [`.cursor-plugin/`](./.cursor-plugin) · [`gemini-extension.json`](./gemini-extension.json) · [`hermes-plugin/`](./hermes-plugin) · [`hermes-levea/`](./hermes-levea)

**Privacy:** edits send your prompt, source links and project ids to the Levea API ([privacy](https://www.livecore.ai/privacy) · [terms](https://www.livecore.ai/terms)). The MCP server and OpenClaw plugin also send a tiny anonymous usage ping (event name, client version, whether a key is set). Turn it off with `LEVEA_TELEMETRY=off`.

**Security:** [SECURITY.md](./SECURITY.md) · **Contributing:** [CONTRIBUTING.md](./CONTRIBUTING.md) · **Contact:** [brajendra@livecore.ai](mailto:brajendra@livecore.ai) · [GitHub issues](https://github.com/brajendrak00068/agentic-ai-video-production/issues)

## License

[MIT](./LICENSE)
