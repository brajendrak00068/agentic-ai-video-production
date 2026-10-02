# Levea — Multi-Platform MCP Launch Kit

Use this document to feed launch copy and structured payloads directly into your social-media/publishing MCP servers (such as `kadenzo-mcp`, `content-distribution-mcp`, `Pipepost`, or direct post tools) to launch **Levea AI Video Editor** across the web.

---

## 1. Reddit MCP Payload (`r/mcp`, `r/ClaudeAI`, `r/sideproject`, `r/LocalLlama`)
*Perfect for direct submission via `AutomateLab-tech/content-distribution-mcp` or any Reddit poster tool.*

### Target Subreddits
- **`r/mcp`** (Focus: Open-source protocols, custom servers)
- **`r/ClaudeAI`** (Focus: Agent workflows, Claude Desktop integrations)
- **`r/sideproject`** (Focus: Indie building, SaaS launch)
- **`r/LocalLlama`** (Focus: Developer utilities, agentic tools)

### Subreddit-Specific Copy & Tool Payload

```json
{
  "platform": "reddit",
  "subreddits": ["mcp", "ClaudeAI", "sideproject"],
  "post_type": "link_text",
  "title": "Show Reddit: Levea — Prompt-First AI Video Editor over MCP (Auto Captions, B-Roll, Motion Graphics)",
  "url": "https://smithery.ai/servers/brajendrak00068/levea-ai-video-editor",
  "body": "Hi r/mcp and fellow builders,\n\nWe just launched **Levea AI Video Editor** as a standardized MCP client wrapper for our hosted video engine!\n\n### What is Levea?\nInstead of spending hours manually trimming, aligning captions, and keyframing motion graphics on a traditional timeline, Levea lets you describe your creative goal in plain language: \n\n*\"Generate a viral vertical clip, add word-by-word bold captions, remove silences, track my face, add B-roll and motion graphics, and export for TikTok and Reels.\"*\n\nBehind the scenes, Levea parses your prompt into typed intents, compiles them into a deterministic Workflow DAG, executes them through safety gates against our production harness, and exports high-performance MP4 deliverables.\n\n### Core Capabilities Included:\n- **Vertical Reframing & Silence Cuts** (active speaker tracking + audio cleanup)\n- **Auto Captions** (40+ styles with word-by-word active animation and crisp SDF typography)\n- **Motion Graphics** (Verified HyperFrames compositions: social cards, lower thirds, callouts, animated charts)\n- **AI B-Roll, Voiceovers & Music** (Google Cloud TTS + AI reference matching + auto-ducking)\n- **Multi-Platform Export** (TikTok, YouTube Shorts, Reels, 9:16 vertical bundles)\n\n### How to Run it:\nYou can connect the open-source Levea MCP client wrapper (`levea-mcp-server`, MIT) to your favorite MCP client (Claude Desktop, Claude Code, Cursor, Cline, or OpenClaw) instantly:\n\n```json\n{\n  \"mcpServers\": {\n    \"levea\": {\n      \"command\": \"npx\",\n      \"args\": [\"-y\", \"levea-mcp-server\"],\n      \"env\": {\n        \"LEVEA_API_URL\": \"https://api.livecore.ai\",\n        \"LEVEA_API_KEY\": \"your-levea-api-key\"\n      }\n    }\n  }\n}\n```\n\n*(Get started with a free API key and starter credits at https://livecore.ai/)*\n\nWould love to hear your feedback on how the Workflow DAG orchestration fits your agent loops!"
}
```

---

## 2. Hacker News (HN) Payload (`Show HN`)
*Optimized for a highly technical developer audience who appreciate clean, deterministic compile pipelines.*

```json
{
  "platform": "hackernews",
  "title": "Show HN: Levea — Prompt-to-Video editor powered by deterministic Workflow DAGs",
  "url": "https://github.com/brajendrak00068/agentic-ai-video-production",
  "text": "Hi HN,\n\nWe built Levea because we were frustrated with how standard AI video tools work. Most of them use loose LLM loops that hallucinate edits, drop layers, or mess up frame alignments. \n\nLevea takes a different approach: **Prompt → LLM emits typed Intermediate Representation (IR) → Deterministic compiler expands to a Workflow DAG → Gated executor mutates Vulkan-accelerated scene → Automated verification and repairs.**\n\nWe’ve released an open-source MCP client wrapper (`levea-mcp-server`, MIT) for our hosted video production engine and launched our core server bundle on Smithery (https://smithery.ai/servers/brajendrak00068/levea-ai-video-editor).\n\n### Technical Highlights:\n1. **Deterministic Orchestration:** We use LLMs solely for metadata parsing and parameters resolution. The actual timeline edits (trimming, alignment, 40+ caption styles, speed ramps, and HyperFrames motion-graphics materialization) are executed strictly via our deterministic compiler.\n2. **Rich Aesthetics & Performance:** Built with native C++/Vulkan acceleration on the rendering side, supporting full cinematic SDF text layouts, high-end motion graphics overlays, and smart frame-by-frame parallel rendering.\n3. **MCP Stdio Protocol:** The client-side wrapper runs entirely locally via `npx -y levea-mcp-server` over stdio and connects directly to Claude Code, Cursor, Cline, or Claude Desktop.\n\nFree API keys with starter credits are available at https://livecore.ai/. We'd love to hear your thoughts on the compilation pipeline and how we balance LLM interpretation with deterministic rendering!"
}
```

---

## 3. X (Twitter) Hook Payload
*Highly engaging, short-form copy with visual callouts and hashtags for viral reach. Compatible with `kadenzo-mcp` or `postfast-mcp`.*

```json
{
  "platform": "twitter",
  "text": "🎥 Say goodbye to video timelines.\n\nIntroducing Levea: An autonomous prompt-first AI Video Editor powered by MCP.\n\n💬 Say it in plain language.\n🤖 It plans, edits, and verifies the video.\n⚡ 40+ caption styles, motion graphics, and B-roll.\n\nOpen-source MCP client runs in Claude Code or Cursor: \n`npx -y levea-mcp-server` \n\nLive on Smithery: https://smithery.ai/servers/brajendrak00068/levea-ai-video-editor\n\n#AI #VideoEditing #MCP #IndieDev #SaaS"
}
```

---

## 4. LinkedIn Professional Post Payload
*Focuses on productivity, SaaS growth hacks, and agency optimization.*

```json
{
  "platform": "linkedin",
  "title": "Reinventing Video Production: Say Goodbye to Timelines",
  "text": "Video content is king, but the timeline editor is a bottleneck. \n\nWhether you are a creator, agency owner, or marketer, spending hours splitting clips, keyframing lower-thirds, and syncing captions is holding you back. \n\nThat is why we built **Levea** — an Agentic AI Video Editor that removes the manual timeline. \n\nYou provide creative direction in plain text, and Levea's deterministic agentic compiler builds a Workflow DAG, executes frame-accurate cuts, renders cinematic SDF word-by-word captions (40+ styles), and applies verified motion graphics overlays (HyperFrames).\n\n🚀 We are officially live on Smithery today!\n\n💻 Connect our open-source MCP client to your developer environment (Cursor, Claude Code, Cline) with one line:\n`npx -y levea-mcp-server`\n\n🔗 Get your free API key and starter credits at https://livecore.ai/\n\n#GenerativeAI #VideoProduction #SaaS #Productivity #ModelContextProtocol"
}
```

---

## 5. Product Hunt Launch Payload
*Fully detailed product features and specifications for a curated audience.*

```json
{
  "platform": "producthunt",
  "product_name": "Levea AI Video Editor",
  "tagline": "The prompt-first autonomous video editor with captions and motion graphics",
  "description": "Levea is an agentic AI video editor that turns a natural language prompt into a finished, professional vertical video.\n\nNo manual timelines. You describe what you want, and our deterministic Workflow DAG engine schedules trimming, vertical reframing, 40+ styles of high-end SDF captions, HyperFrames motion graphics (Reddit/Tweet cards, title slides, lower thirds), Google Cloud TTS voiceovers, B-roll, and background music, then performs an automated quality check before export.\n\nOur open-source MCP client (`levea-mcp-server`) integrates directly into Claude Desktop, Claude Code, Cline, and Cursor so you can edit videos directly from your existing agent workflows.",
  "topics": ["Artificial Intelligence", "Video", "Developer Tools", "SaaS"]
}
```
