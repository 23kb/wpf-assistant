# Install the Assistant extension

Installing the unpacked extension. Takes about a minute.

## Steps

1. **Unzip the extension** somewhere stable — a permanent folder, not Downloads (Chrome unloads an unpacked extension if its folder disappears).
2. Open Chrome and go to **`chrome://extensions`**.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and pick the unzipped folder.
5. The Assistant icon appears in the toolbar.

## Using it

1. Open any WPForms admin page (e.g. WPForms → Settings).
2. Press **Escape**.
3. Type your question (e.g. *"how do I disable weekly email summaries"*) and hit Enter.
4. Follow the bubble — click the highlighted element, click **I did it →** to advance, or **Wrong** to have it try again.

Click the **🎤 mic** icon to ask by voice. Chrome requests microphone permission the first time.

## Settings

Right-click the Assistant icon → **Options**.

- **Voice (TTS)** — reads bubble messages aloud. Off by default; uses ElevenLabs credit, so leave it off unless needed.
- **Model** — Sonnet 4.6 by default. Haiku is cheaper but weaker at tool selection.

The Worker URL and bearer token come pre-configured in `team-config.json`; you don't need to enter them, and shouldn't change them unless you know what you're doing.

## What it costs

- Most questions: a few cents in Anthropic credits, billed to the configured Anthropic account.
- TTS adds a small per-message cost when enabled.
- Rate cap: 60 questions/minute per token. If you hit it, wait a few seconds.

## Not supported yet

- **Form builder** — selector accuracy is unreliable there; Settings pages and the entries list are the solid surface.
- **Auto mode** (performing actions, not just pointing) — not built.
- **Multi-tab** — only the tab where you pressed Escape is in scope.

## If something breaks

1. Click **Stop** on the "Thinking…" indicator; press **Escape** to clear stuck UI.
2. Reload the extension: `chrome://extensions` → Assistant → reload icon.
3. Still broken? Open the service worker console (`chrome://extensions` → Assistant → **Inspect views: service worker**) and note any red errors.

## Updating

When you get a new zip:

1. Unzip over the existing folder (replace files).
2. Reload the extension on `chrome://extensions`. Settings persist.

The bearer token / Worker URL re-apply automatically from the new zip's `team-config.json`.
