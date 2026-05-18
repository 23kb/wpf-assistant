# Assistant — extension

Chrome extension (Manifest V3) for the WPForms Assistant project. Read [CLAUDE.md](../CLAUDE.md) at the repo root for the full architecture; this README focuses on dev workflow inside `extension/`.

For end-user install instructions, see [INSTALL.md](INSTALL.md).

## Layout

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest. Background SW + content script + options page. |
| `background.js` | Service worker. Agent loop, Anthropic/Worker calls, conversation state, config bootstrap. |
| `content.js` | Injected into wp-admin pages. Live DOM snapshotter, UI (input/bubble/cursor/arrow), TTS playback. |
| `content.css` | Styles for the input box, bubble, arrow, highlight, cursor, error/summary popups. |
| `config.js` | Tunables: model default, max iterations, token budget, TTLs, polite-crawl client header. |
| `options.html` / `options.js` | Setup page. Worker URL, bearer token, Anthropic key fallback, model, TTS settings. |
| `team-config.json` | Seeds `chrome.storage` on install. Set the Worker URL + bearer token here, or via the Options page. |
| `INSTALL.md` | End-user install instructions. |

## Run locally

1. Load `extension/` unpacked at `chrome://extensions` (Developer mode on).
2. Either:
   - **Worker mode** — set `worker_url` + `bearer_token` in `team-config.json` (or paste in Options after install). Recommended.
   - **Direct mode** — leave Worker fields empty, paste your Anthropic key in Options.
3. Open a WPForms admin page on your LocalWP / dev WordPress install.
4. Press Escape.

## Debug

- **Content script logs** — F12 on the wp-admin page → Console.
- **Service worker logs** — `chrome://extensions` → Assistant → **Inspect views: service worker**.
- The snapshot logs as `[Assistant] snapshot: N elements (sent M)` plus a collapsed group with the full element list. Expand it to see exactly what Claude received.
- Conversation state is in `chrome.storage.local` under `nudge_state_<tabId>`. TTL 10 min.

## Common dev tasks

### Test against a local Worker

```bash
cd ../worker
cp .dev.vars.example .dev.vars   # fill in keys
npx wrangler dev                  # localhost:8787
```

Then in `team-config.json` (or Options), set `worker_url` to `http://localhost:8787`. Reload the extension.

### Switch between Worker and direct mode

Just clear the `worker_url` field in Options and Save → extension falls back to direct Anthropic calls using the API key field. Or clear the Anthropic key and re-add Worker URL → back to Worker mode.

### Force fresh `team-config` apply

`team-config.json` is read on every browser startup. After updating it:
- For the same browser: reload the extension (`chrome://extensions` → reload icon).

## Conventions

- Internal identifiers use the old `nudge` prefix (`#nudge-root`, `.nudge-bubble`, `nudge_state_<tabId>` storage keys). User-visible strings use "Assistant". Don't rename the internal ones — high risk, zero user-visible benefit.
- `console.log` lines are prefixed `[Assistant]` so they're easy to filter in the SW console.
- TTS calls happen client-side from `content.js` directly to the Worker — service worker isn't involved. Audio playback uses `Audio()` + blob URLs.
