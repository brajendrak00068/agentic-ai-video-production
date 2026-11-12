# Levea — ChatGPT Custom GPT / Action Kit

This folder contains the configuration and OpenAPI specification for a **Custom GPT** that calls Levea through a GPT Action.

> **Public listing: use the ChatGPT app, not this kit.** A GPT Action authenticates with the one API key you paste into the GPT editor, so a *public* GPT would run every ChatGPT user's edits on your key and your credits. For a public listing, publish the ChatGPT app in [`../chatgpt-plugin/`](../chatgpt-plugin/): it connects to the hosted Levea MCP server with **OAuth**, so each user signs in to their own Levea account. Use this Action kit only for a GPT that is private to you or your team.

---

## 1. Quick Setup on ChatGPT

1. Go to **[https://chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor)** (or your profile → **My GPTs** → **Create a GPT**).
2. Switch to the **Configure** tab:
   - **Logo / Avatar**: Click the circle icon at the top and upload `logo.png` (from this folder).
   - **Name**: `Levea — AI Video Editor`
   - **Description**: `Autonomous prompt-to-video editor. Generate viral clips, 280+ caption templates, vertical 9:16 reframe, motion graphics, voiceovers & B-roll.`
   - **Instructions**: Copy & paste from `INSTRUCTIONS.md`.
   - **Conversation Starters**: See `INSTRUCTIONS.md`.

## 2. Configure Action

1. At the bottom of the Configure tab, click **Create new action**.
2. **Schema**: Paste the contents of `openapi.json`.
3. **Authentication**:
   - **Type**: `API Key`
   - **Auth Type**: `Bearer`
   - **API Key**: Enter a Levea API key (from [livecore.ai](https://livecore.ai/?openclaw=1&utm_source=chatgpt&utm_medium=gpt-action&utm_campaign=levea)).
4. **Privacy Policy**: `https://livecore.ai/privacy`.

## 3. Share the GPT

1. In the top-right corner, click **Create** / **Update**.
2. Select **Only me** or **Anyone with the link** for a GPT that runs on your own key. Do not select **Everyone (GPT Store)** with a shared key; publish the OAuth ChatGPT app instead (see the note at the top).
3. Save.

---

## 4. Aggregator Listings

Once the OAuth ChatGPT app is live, submit its link to directories such as [There's An AI For That](https://theresanaiforthat.com/submit/).
