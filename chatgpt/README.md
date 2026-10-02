# Levea — ChatGPT Custom GPT / Action Kit

This folder contains the complete configuration and OpenAPI specification for publishing **Levea** on the **OpenAI GPT Store** (`chatgpt.com/gpts`).

---

## 1. Quick Setup on ChatGPT

1. Go to **[https://chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor)** (or your profile → **My GPTs** → **Create a GPT**).
2. Switch to the **Configure** tab:
   - **Name**: `Levea — AI Video Editor`
   - **Description**: `Autonomous prompt-to-video editor. Generate viral clips, 40+ caption styles, vertical 9:16 reframe, motion graphics, voiceovers & B-roll.`
   - **Instructions**: Copy & paste from `INSTRUCTIONS.md`.
   - **Conversation Starters**: See `INSTRUCTIONS.md`.

## 2. Configure Action

1. At the bottom of the Configure tab, click **Create new action**.
2. **Schema**: Paste the contents of `openapi.json`.
3. **Authentication**:
   - **Type**: `API Key`
   - **Auth Type**: `Bearer`
   - **API Key**: Enter a Levea API key (from [livecore.ai](https://livecore.ai/)).
4. **Privacy Policy**: `https://livecore.ai/privacy`.

## 3. Publish to the GPT Store

1. In the top-right corner, click **Create** / **Update**.
2. Select **Everyone (Public to GPT Store)**.
3. Category: **Productivity** or **Video & Animation**.
4. Save.

---

## 4. Aggregator Listings

Once live, submit your public GPT link (`https://chatgpt.com/g/...`) to:
- [GPTStore.ai](https://gptstore.ai/submit)
- [There's An AI For That](https://theresanaiforthat.com/submit/)
