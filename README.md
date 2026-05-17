# OpenClaw AI Video Editor

> **An autonomous agentic video editor.** Not a wrapper around ffmpeg. Not a viral-clip script. A typed multi-tier intelligence stack that reads, plans, edits, verifies, and exports — end to end — from a single natural-language prompt.

[![ClawHub](https://img.shields.io/badge/ClawHub-plugin-blue)](https://clawhub.ai/plugins/openclaw-ai-video-editor)
[![npm](https://img.shields.io/npm/v/openclaw-ai-video-editor)](https://www.npmjs.com/package/openclaw-ai-video-editor)

---

## What this actually is

Most "AI video editors" are GPT wrappers calling `ffmpeg -vf`. This isn't that.

Behind a single `autonomous_edit` tool sits a four-tier intelligence stack, a canonical action registry of 80+ deterministic edits, six GPU-warmed perception models, a Postgres-backed memory plane with pgvector similarity search, and a verifier loop that re-runs the agent if its own output fails sanity checks.

You send a sentence. The agent classifies the goal, decomposes it into atomic steps, plans a DAG of canonical actions, dispatches each through hardware-accelerated renderers, verifies the timeline post-edit, and emits the rendered MP4. Two LLM calls in the whole flow. Everything else is deterministic execution against pre-computed signals.

That's the architectural difference. Legacy editors give you tools. This gives you an editor.

---

## The four-tier intelligence stack

The system answers different classes of question at different tiers. The CI gate enforces that no tier duplicates work the cheaper tier already did.

```
┌──────────────────────────────────────────────────────────────────────┐
│ L3  LLM narrative      Reasoning, editorial choice    │ "Pick the best clip"
├──────────────────────────────────────────────────────────────────────┤
│ L2  Multimodal embed   What this is about — semantic  │ pgvector RAG
├──────────────────────────────────────────────────────────────────────┤
│ L1  ASR transcript     What was actually said         │ Verbatim STT
├──────────────────────────────────────────────────────────────────────┤
│ L0  Perception (GPU)   Where, who, when, what's there │ 6 ONNX models
└──────────────────────────────────────────────────────────────────────┘
```

| Tier | Answers | How |
|---|---|---|
| **L0 — Perception** | Where are the faces? Who's the active speaker? Where do shots cut? What text is on screen? Where's the alpha matte? | Six ONNX models on a warm GPU pod |
| **L1 — Transcript** | What was said, word-for-word, with timestamps | STT, diarized via L0 active-speaker × face identity |
| **L2 — Semantic** | "Find moments where they laugh." "Clips like *this* reference." | Multimodal embeddings indexed in pgvector |
| **L3 — Reasoning** | Editorial judgment — what's the climax, which clip is best, what's the narrative arc | LLM — invoked only when L0/L1/L2 can't answer |

The trick is what the LLM sees at dispatch time. By then, the cheap tiers have already produced structural signals — chapters, speaker changes, cut pacing, talk-time distribution, reaction moments, shot kinds, face identity matches, OCR'd chyrons. The LLM reads all of that as context, then picks one canonical action. It doesn't have to *figure out* what's in the video.

---

## L0: the six perception models

All ONNX, all warmed at boot, all running on a dedicated GPU pod fronted by HTTP. Single-model outputs are commodity. The differentiator is composition — these compose into 12+ editorial signals consumed by every downstream action.

| Model | Job | Composes into |
|---|---|---|
| **SCRFD-10G** | Face detection + 5-pt landmarks | Eye-level reframe, vertical 9:16 framing |
| **ArcFace (512-d)** | Identity embedding | Cross-asset "find clips with this person" via pgvector cosine NN |
| **BoT-SORT** | Multi-object tracking | Persistent track IDs for face/object continuity |
| **LR-ASD** | Active speaker detection | Talk-time distribution, speaker changes, reaction moments, beat-synced cuts |
| **TransNetV2** | Shot boundary detection | Chapter segmentation, cut-pacing analysis |
| **PP-OCRv5 (det + rec)** | Text region + content recognition | Caption-safe cropping, chapter titles from chyrons, sponsor detection (roadmap) |
| **RVM** | Alpha matting | Background replace, background blur, shot-kind classification |
| *SAM2 + ProPainter* | Instance segmentation + inpainting (scaffolded) | Object removal (roadmap) |

```
SCRFD ──► face bboxes ──┐
                        ├──► BoT-SORT ──► persistent face tracks
ArcFace ─► 512-d emb ───┘                       │
                                                ├──► pgvector identity store
LR-ASD  ─► speaking prob ───► talkTime ─────────┤
                              reactionMoments   │
                              speakerChanges    │
                                                ├──► EditorialSignals
TransNet ► shot boundaries ─► chapters ─────────┤
                              cutPacing         │
                                                │
PP-OCR  ─► chapterTitle ────────────────────────┤
          caption-safe crop                     │
                                                │
RVM     ─► alpha matte ─► BACKGROUND_REPLACE    │
          shotKind ───────────────────────────► ▼
                              (one tool dispatch reads any subset)
```

---

## Pre-processing: raw upload → AI-ready scene

When you add a video to a project, an async worker fans out the analysis pipeline in parallel. Sixty to 180 seconds for a five-minute video. After that, the asset is *AI-ready* — every subsequent prompt is fast because nothing recomputes.

```
                       USER UPLOADS VIDEO
                              │
                              ▼
                    handlePreProcessVideo
                              │
        ┌──────────┬──────────┼──────────┬──────────────┐
        ▼          ▼          ▼          ▼              ▼
       GCS    RAG index   STT (ASR)   Perception   Autonomous
     download (multimodal  transcript  fan-out       Signals
              embeddings)              (6 models)    composer
        │          │          │          │              │
        ▼          ▼          ▼          ▼              ▼
       blob   pgvector    AgentMem    AgentMem      AgentMem
              chunks      words.json  faces +       scene
                                      tracks        signals
```

What gets persisted, where, and why:

| Store | Holds | Access pattern |
|---|---|---|
| `scene.visionData` (JSONB) | Hot, scene-local signals every action reads | In-memory while editing |
| `AgentMemory` (Postgres rows) | Per-(project, asset) blobs — transcript chunks, face tracks, scene signals | Survives session, shared across requests |
| `pgvector` tables | 1024-d multimodal chunks, 512-d ArcFace identity vectors | Cosine NN, cross-asset joins |
| `GCS` | Source videos, rendered MP4s, model weights | Append-mostly heavy binaries |
| `agent_tasks` (Postgres) | Job orchestration — status, progress, last_error | Polled by workers; payload kept small, big blobs offloaded to GCS |

---

## The agent loop

This is what happens when you send a prompt. Notice the LLM is invoked **exactly twice** — once to classify, once to dispatch. Everything else is deterministic.

```
                    USER PROMPT
        "Make 3 viral clips, replace the background with a beach"
                         │
                         ▼
              GoalClassifier (1× LLM)
              → goal: viral_social
              → export_style: viral_clips
              → signals.wantsBgReplace: true
                         │
                         ▼
              WorkflowDagCompiler   (deterministic)
              → tasks: [GENERATE_VIRAL_CLIPS, BACKGROUND_REPLACE]
                         │
                         ▼
              TrueCentralBrain
              composes scene snapshot with all L0/L1 signals:
                · chapters, reactionMoments, shotKindByChapter
                · speakerChanges, cutPacing, talkTime
                · transcript.words[], narrative metadata
                         │
                         ▼
              LLM tool dispatch (1× LLM)
              picks from CanonicalActionRegistry, fills params
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        Action handler        Action handler
        → autonomyQueue       → autonomyQueue
        → renderer pods       → renderer pods
              │                     │
              └──────────┬──────────┘
                         ▼
              Renderer GPU pods
              (PerceptionState warmed · streaming compositor · NVENC)
                         │
                         ▼
              GCS-uploaded MP4s
              + APPLY_PENDING scene mutation
              + streaming progress (SSE)
```

Two LLM calls. Hardware-accelerated everything else. That's the architectural game.

---

## Capability surface

This is what the agent can actually do. Every row is a real canonical action backed by deterministic code (not a prompt-engineered hallucination). The agent composes any subset of these in a single planned DAG.

### Read & inspect
| Action | What it does |
|---|---|
| `READ_SCENE` | Inspect timeline structure, layer properties, scene state |
| `QUERY_ASSETS` | Search the asset gallery by type, duration, name |
| `READ_VISUAL` | Run CV analysis on frames (object/face/scene detection) |
| `QUERY_TRANSCRIPT` | Keyword / semantic / timestamp-window search |
| Video intelligence | Narrative peaks, speaker diarization, sentiment, pacing |
| Job introspection | Async status polling, schema discovery |

### Structural editing
- Insert / update / replace / delete layers — **video, audio, text, image, shape, group, adjustment**
- Trim, split, retime — slow-motion (0.5×), fast-forward (2×), freeze-frame, ramp curves
- Reposition on the timeline, sequence layers, snap to transcript word boundaries
- Heal timeline gaps, normalize audio, reconcile durations (pre-export safety pass)
- Multi-step undo / redo

### Visual editing
- **Color grading** — brightness, contrast, saturation, hue, lift / gamma / gain, RGB curves
- **Procedural VFX shaders** — smoke, dust, fire, explosion, lightning, snow, glitch, scanlines, grain, glassmorphism, bokeh, lava, telomere / corrosion, portal
- **Chroma key** — green / blue screen with similarity, smoothness, spill suppression
- **Masking** — luma, alpha, depth masks
- **Geometric clip shapes** — circle, dome, star, hexagon, polygon
- **Crop** — absolute or edge-based; **3D rotation + perspective**
- **Glow, shadow, inner shadow, gradient fills, text gradients**
- **Vertical reframe** (9:16) and vertical-reframe montage
- **Split screen** — top/bottom, left/right, picture-in-picture, grid
- **Branding overlays** — logo / watermark from gallery or AI-generated
- **Motion / face tracking** with dynamic zoom-follow framing

### Captions & text
- Auto-generate captions from the L1 transcript
- Style captions with built-in templates **or** an AI director that picks / generates a custom template at runtime
- **Curved text paths** — circle, wave, custom SVG
- **Per-word animations** — typewriter, slide, fade, scale, rotate, bounce, flip, swing, elastic, blur, glitch, wave (each with matching exit)
- Lottie animation playback control

### Audio
- Clean audio — remove **silences, breaths, filler words**; word-level mute / cut
- **Auto-ducking** on speech detection (sidechain music vs voice)
- Mix / normalize / denoise / EQ (bass-boost, vocal-clarity, warm, bright presets)
- Sync external master audio to video (offset, mute camera audio)
- **Beat-synced cuts** — provide `beat_times` or `bpm`, the editor aligns cuts
- Add SFX
- Generate music (mood / genre / BPM)
- Generate voiceover (TTS or cloned voice)
- Render waveform visualizers (bars, wave, circular)

### Async generation
- **AI video / B-roll** — duration + aspect ratio
- **AI images** — single or batch at timestamps
- **AI music** — prompt + duration + mood + genre + BPM
- **AI voiceover** — TTS or cloned voice library
- **Auto-thumbnail extraction**
- **Face blur** — all faces or background-only
- **Image edit** — generative instruction-based

### High-level kits
Each one is a single canonical action that orchestrates many underlying edits:

| Kit | What it does |
|---|---|
| `APPLY_VIRAL_KIT` | Vertical reframe + captions + silence removal + motion tracking + word emphasis |
| `APPLY_CINEMATIC_DIRECTOR` | Energy analysis + dynamic zooms + cinematic color grade + mood-based camera moves |
| `APPLY_EMPHASIS_SYSTEM` | Keyword detection + coordinated scaling / glow / pulse with captions |
| `OPTIMIZE_PACING` | Filler-word + silence + low-energy segment removal for retention |

### Export
| Action | Output |
|---|---|
| `EXPORT_VIDEO` | MP4 (resolution / codec / quality tier) |
| `GENERATE_VIRAL_CLIPS` | Auto-segmented short-form clips packaged as ZIP |
| `GENERATE_MULTI_PLATFORM` | TikTok + Reels + Shorts + YouTube + Instagram aspect ratios in one pass |

---

## Two modes

### 1. `autonomous_edit` — natural language (primary)

Pass a free-form description in `params.prompt`. The brain classifies the goal, decomposes into atomic steps, plans a DAG of canonical actions, executes through safety gates, and verifies the result.

```bash
curl -sS -X POST "$ADSCENE_API_URL/api/v1/misc/openclaw/v1/execute" \
  -H "Authorization: Bearer $ADSCENE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "autonomous_edit",
    "params": {
      "prompt": "Make this a TikTok-ready viral clip: vertical reframe, add bold captions, remove silences, motion-track the speaker, and export."
    },
    "project_id": "my-project"
  }'
```

### 2. Deterministic tools — structured params, no planning

When you already know the action and have structured params, dispatch directly to the canonical action and skip intent decomposition entirely.

| Tool | Canonical action | Use when |
|---|---|---|
| `read_scene` | `READ_SCENE` | Inspect the current timeline |
| `read_media` | `QUERY_ASSETS` | List gallery assets |
| `read_visual` | `READ_VISUAL` | Run CV analysis on frames |
| `query_transcript` | `QUERY_TRANSCRIPT` | Search transcript by text or timestamp |
| `scene_update` | `UPDATE_LAYER` | Mutate a known layer's properties |
| `scene_insert` | `CREATE_LAYER` | Add a video / audio / text / image / shape layer |
| `scene_timing` | `SCENE_TIMING` | Trim, retime, reposition a layer |
| `scene_mask` | `APPLY_MASK` | Chroma / luma / alpha / depth mask |
| `chroma_key` | `APPLY_MASK` | Green-screen / blue-screen keying convenience |
| `split_screen` | `SPLIT_SCREEN` | Top-bottom, left-right, PIP, grid |
| `caption_compose` | `GENERATE_CAPTIONS` | Generate captions from transcript |
| `media_treat` | `COLOR_GRADE` | Apply color correction |
| `scene_track` | `TRACK_MOTION` | Face / object tracking with zoom-follow |
| `clean_audio` | `CLEAN_AUDIO` | Silence / breath / filler removal |
| `audio_mix`, `audio_mixing` | `AUDIO_MIXING` | Ducking, normalize, denoise, EQ |
| `voiceover_add` | `GENERATE_VOICEOVER` | Generate voiceover (text + voice_id) |
| `music_generate` | `GENERATE_MUSIC` | Generate background music |
| `export_video` | `EXPORT_VIDEO` | Render to MP4 |

Unknown tool names return `400 UNKNOWN_TOOL` with a hint pointing at `autonomous_edit`.

Example — direct layer update, no planning round-trip:

```bash
curl -sS -X POST "$ADSCENE_API_URL/api/v1/misc/openclaw/v1/execute" \
  -H "Authorization: Bearer $ADSCENE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "scene_update",
    "params": { "layer_id": "layer_123", "opacity": 0.5, "rotation": 15 }
  }'
```

---

## Quick start

### 1. Get an API key

Sign up at [https://studio.livecore.ai/](https://studio.livecore.ai/) and generate an OpenClaw API key from the account UI.

### 2. Install the plugin

```bash
openclaw plugins install clawhub:openclaw-ai-video-editor
```

Or via npm:

```bash
npm install openclaw-ai-video-editor
```

### 3. Configure

```bash
export ADSCENE_API_URL="https://api.livecore.ai"
export ADSCENE_API_KEY="your-openclaw-api-key"
```

Or in OpenClaw skill config:

```json
{
  "skills": {
    "entries": {
      "openclaw_ai_video_editor": {
        "enabled": true,
        "env": {
          "ADSCENE_API_URL": "https://api.livecore.ai",
          "ADSCENE_API_KEY": "your-openclaw-api-key"
        }
      }
    }
  }
}
```

### 4. Run an autonomous edit

```bash
curl -sS -X POST "$ADSCENE_API_URL/api/v1/misc/openclaw/v1/execute" \
  -H "Authorization: Bearer $ADSCENE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "autonomous_edit",
    "params": {
      "prompt": "Generate 5 viral clips, 15-30 seconds each, focused on the most engaging moments. Add bold captions, vertical reframe, remove silences."
    },
    "project_id": "my-project"
  }'
```

---

## API surface

Base URL: `{ADSCENE_API_URL}` (production: `https://api.livecore.ai`)

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/misc/openclaw/v1/execute` | Run `autonomous_edit` or a deterministic tool |
| `GET /api/v1/misc/openclaw/v1/jobs/{jobId}` | Poll async render or generation jobs |
| `GET /api/v1/misc/openclaw/v1/tools` | List available tool names |
| `GET /api/v1/misc/openclaw/v1/health` | Health check |

Auth header:

```http
Authorization: Bearer {ADSCENE_API_KEY}
```

Do **not** set `ADSCENE_API_URL` to `https://studio.livecore.ai` or the in-product editor route `/api/v1/misc/editor/`. Studio is the user-facing app; OpenClaw requests go to the API-key route on `https://api.livecore.ai`.

### Request body

```json
{
  "tool": "autonomous_edit" | "<deterministic-tool>",
  "params": { },
  "project_id": "optional",
  "scene": { }
}
```

### JSON response

```json
{
  "type": "success" | "partial_success",
  "tool": "<tool-name>",
  "success": true,
  "status": "completed" | "failed" | "awaiting_approval",
  "scene": { },
  "reply": "Human-readable summary of what changed",
  "videoUrl": "https://.../output.mp4",
  "jobId": "task_...",
  "viral_clips": [ ],
  "zip_url": "https://.../clips.zip",
  "activeTasks": [ ],
  "pendingAsyncJobs": [ ],
  "workflowStepsDetailed": [ ],
  "workflowSummary": { "title": "...", "summary": "..." },
  "verificationPassed": true,
  "verificationIssues": [],
  "committedToProjectScene": true,
  "processingTime": 12.3,
  "workingMemory": { }
}
```

### SSE streaming

Set `Accept: text/event-stream` or `?stream=true`. Notable event types:

| Event | Meaning |
|---|---|
| `heartbeat` | 15s keepalive |
| `status` | Phase transitions (`request_received`, `runtime_start`, …) |
| `mode_select` | `{ mode: "qa" | "action" }` |
| `thinking`, `tool_call`, `tool_result` | Per-step reasoning visibility |
| `background_job_completed` | Async job done (B-roll, viral clips, …) |
| `workflow_completed` | Main brain loop done; verification may continue |
| `success` / `partial_success` | Terminal payload (same shape as JSON above) |
| `error` | Terminal failure |

### Async job lifecycle

Generation actions (`generate_*`, `EXPORT_VIDEO`) return immediately with a `jobId`. Poll:

```bash
curl -sS "$ADSCENE_API_URL/api/v1/misc/openclaw/v1/jobs/$JOB_ID" \
  -H "Authorization: Bearer $ADSCENE_API_KEY"
```

Response:

```json
{
  "success": true,
  "jobId": "task_xxx",
  "status": "queued" | "processing" | "completed" | "failed",
  "progress": 0.74,
  "message": "Rendering frame 142 of 192",
  "result": { },
  "error": null
}
```

### Auto-export

After any **mutating** tool call, if the scene actually changed and an `EXPORT_VIDEO` isn't already queued, the route auto-fires one as a second run. Read-only and conversational `autonomous_edit` calls do **not** trigger auto-export.

### Plan approval flow

Pass `requirePlanApproval: true` to make the agent stop after planning. It returns `status: "awaiting_approval"` + populated `workingMemory`. Resume by sending the same `workingMemory` with an approval prompt (`yes`, `y`, `approve`, `approved`, `go`, `proceed`, `go ahead`, `do it`, `confirm`).

---

## How this differs from legacy editors

| | Legacy editors (Premiere, DaVinci, CapCut, Descript) | OpenClaw AI Video Editor |
|---|---|---|
| **Interface** | Drag, drop, keyframe by hand | One sentence; agent plans the rest |
| **Per-asset AI prep** | Manual scene detection, manual subtitle generation | Six perception models run on upload — chapters, faces, speakers, OCR, shots, mattes all pre-computed |
| **"Make this viral"** | You build the workflow | `APPLY_VIRAL_KIT` — single action, planned and executed |
| **Cross-asset search** | Filename search | pgvector cosine NN — "find every clip where Alex appears" works across the entire library |
| **Background replace** | Key out manually, find background, composite | RVM alpha matte + `BACKGROUND_REPLACE` — one action |
| **Beat-synced cuts** | Manually mark beats, manually align | `beat_times` or `bpm` parameter; cuts align automatically |
| **Editorial reasoning** | You decide what's the climax | L3 narrative agent surfaces narrative peaks, reaction moments, emphasis candidates |
| **Verification** | You eyeball the result | Verifier runs after execution; up to 2 repair loops on failure |
| **Cost per edit** | Software license + your hours | Per-API-key rate-limited; deterministic actions run on warmed GPU pods |
| **Extensibility** | Plugins call ffmpeg | Tools are typed canonical actions; the registry is the contract |

This isn't an editor with AI features bolted on. It's an autonomous agent whose execution substrate happens to be a video editor.

---

## Safety, verification, limits

- Every run flows through three deterministic gates: **ActionPermissionGate**, **ArchitectureControlPlane**, **EditorSafetyPolicy**.
- Destructive actions (`CLEAR`, mass deletes) require explicit confirmation params.
- The verifier runs after execution and may trigger up to two repair loops; failures surface as `verificationPassed: false` + `verificationIssues[]`.
- Concurrent identical requests for the same `(user, project, prompt, scene fingerprint)` are deduplicated server-side.
- Rate-limited per API key. Read-only ~1–3s, structural edits ~3–10s, async generation 30s–5min per artifact, viral-clip / multi-platform exports several minutes.

---

## Supported media

| | Formats |
|---|---|
| **Video in** | MP4, MOV, WebM (HTTP/HTTPS URLs, YouTube URLs, gallery IDs) |
| **Image in** | JPG, PNG, WebP |
| **Audio in** | MP3, WAV, M4A, AAC (or extracted from video) |
| **Output** | MP4 (export), ZIP (viral clips / multi-platform bundles) |
| **Max video length** | Plan-dependent; soft limit ~30 min for synchronous edits, async generation handles longer |
| **Recommended resolution** | 1080p or 4K; canvas is configurable per project |

---

## End-to-end example: viral-clip generation

```bash
# 1) Kick off the viral-clip pipeline
curl -sS -X POST "$ADSCENE_API_URL/api/v1/misc/openclaw/v1/execute" \
  -H "Authorization: Bearer $ADSCENE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "autonomous_edit",
    "params": {
      "prompt": "Generate 5 viral clips, 15-30 seconds each, focused on the most engaging moments. Add bold captions, vertical reframe, remove silences."
    },
    "project_id": "my-project"
  }' | tee /tmp/result.json | jq -r '.jobId // .activeTasks[0].intent.job_id'

# 2) Poll job status until done
JOB_ID=$(jq -r '.jobId // .activeTasks[0].intent.job_id' /tmp/result.json)
while true; do
  STATUS=$(curl -sS "$ADSCENE_API_URL/api/v1/misc/openclaw/v1/jobs/$JOB_ID" \
    -H "Authorization: Bearer $ADSCENE_API_KEY" | jq -r '.status')
  echo "Status: $STATUS"
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
  sleep 5
done

# 3) Fetch the final artifact URLs
curl -sS "$ADSCENE_API_URL/api/v1/misc/openclaw/v1/jobs/$JOB_ID" \
  -H "Authorization: Bearer $ADSCENE_API_KEY" | jq '.result'
```

---

## Links

- **ClawHub plugin** — [clawhub.ai/plugins/openclaw-ai-video-editor](https://clawhub.ai/plugins/openclaw-ai-video-editor)
- **ClawHub skill (agentic)** — [clawhub.ai/skills/ai-agentic-video-editor](https://clawhub.ai/skills/ai-agentic-video-editor)
- **ClawHub skill (Livecore brand)** — [clawhub.ai/skills/livecore-ai-video-editor](https://clawhub.ai/skills/livecore-ai-video-editor)
- **npm** — [npmjs.com/package/openclaw-ai-video-editor](https://www.npmjs.com/package/openclaw-ai-video-editor)
- **Sign up + API keys** — [studio.livecore.ai](https://studio.livecore.ai/)
- **API base** — `https://api.livecore.ai`

## Support

Setup help, integration questions, or issue reports — `brajendrak00068@gmail.com`

## License

MIT
