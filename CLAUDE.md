# WPForms Assistant

A Chrome extension (MV3) plus a Cloudflare Worker. On a WPForms admin page, press **Escape** and ask a question in plain English. It reads the live page, optionally fetches the relevant WPForms doc, and points at the right UI element with an animated cursor, arrow, and bubble — guiding multi-step tasks one click at a time.

The extension is thin. The cost-sensitive logic (Claude API call, doc cache, slug index, optional TTS) lives in the Worker, so the API key is never shipped to clients and the prompt/doc cache is shared.

## Repo layout

```
extension/                Chrome extension (MV3) — load unpacked
  manifest.json
  background.js            Service worker: agent loop, API/Worker calls, state
  content.js               Injected into wp-admin: live DOM snapshotter + UI
  content.css
  config.js                Tunables (model, caps, TTLs)
  options.html / .js       Setup page (Worker URL, token, model, TTS)
worker/                   Cloudflare Worker
  wrangler.toml            KV binding; secrets set via wrangler
  src/
    index.ts               Router + CORS
    auth.ts                Bearer-token check
    rate-limit.ts          Per-token RPM via KV
    system-prompt.ts       System prompt + slug list
    tools.ts               Anthropic tool definitions
    chat.ts                /chat  — Anthropic Messages proxy
    tts.ts                 /tts   — ElevenLabs proxy
    docs.ts                /sitemap, /doc/<slug> — KV-cached doc fetcher
```

Secrets are never committed: `.env`, `extension/team-config.json`, and Worker secrets are gitignored. The `*.example` files document the expected shape.

## How it works

```
Escape on a WPForms admin page
  → content script shows an input box; user types (or speaks via mic)
  → content script walks the live DOM → compact {selector, tag, text} list
  → background service worker calls the Worker /chat
    (direct Anthropic API is the fallback when no Worker URL is set)
  → Worker builds the cached system prompt (rules + slug list) + tools and
    forwards to Anthropic with cache_control on the system block
  → Claude returns one tool call:
      read_doc(slug)               Worker fetches the .md from wpforms.com, KV-cached 30d
      point_at(selector, message)  relayed to the content script
      ask_user(question)           content script shows an input box
      done(summary)                content script shows the summary; TTS if enabled
  → point_at: cursor animates to the target, arrow + bubble appear; a click
    on the target (or "I did it", or a pointed-at nav link) advances the loop
  → loop continues with a fresh snapshot until done()
```

There is no `navigate` tool. Navigation happens only when the user clicks a pointed-at link; the content script re-runs on the new page and resumes the loop via a `page_loaded` message.

### Conversation state

Per-tab state lives in two places:

- In-memory `Map<tabId, state>` in the service worker — fast, lost on SW death.
- `chrome.storage.local` keyed by `nudge_state_<tabId>` — survives SW death and navigation, TTL 10 min.

On a wait-tool (`point_at`, `ask_user`) state is persisted; on the next user action it is restored.

### Message protocol

The Anthropic API requires strict user/assistant alternation. After a wait-tool, a `user` message with a placeholder `tool_result` is pushed. When the user acts, that placeholder is modified **in place** with the new snapshot — a second user message is not pushed. `state.pendingWaitToolUseId` tracks which `tool_result` block to update. See `background.js:updateLastToolResult()`.

## Working on the code

### Add a Claude tool

1. Define it in `worker/src/tools.ts`.
2. Handle it in `extension/background.js:runTool()` (if it waits for the user, return `wait: true`).
3. If it dispatches to the page, add a `case` in `content.js`'s `chrome.runtime.onMessage` listener.
4. Teach the model when to use it in `worker/src/system-prompt.ts`.
5. `cd worker && npx wrangler deploy`.

`background.js` has fallback `SYSTEM_BASE` / `TOOLS` used only in direct-Anthropic mode; the Worker's versions are canonical — keep them roughly in sync.

### Change the snapshot

`extension/content.js:snapshot()` walks `document.querySelectorAll('*')` and emits `{sel, tag, text}` per element. Filters: `ID_EXCLUDE_PREFIXES`, `isChromeId()` (per-instance numeric IDs), `CLASS_ROLE_PATTERNS` (only click-target-looking classes), `isVisible()` (display / visibility / size), and the SVG namespace is skipped. `background.js:formatSnapshot()` caps at 200 elements and serializes tab-separated rows — that is the agent's input. Console: `[Assistant] snapshot: N elements (sent M)` plus a collapsed group with the full list.

### Change the system prompt

Two copies, keep in sync: `worker/src/system-prompt.ts:SYSTEM_BASE` (canonical) and `extension/background.js:SYSTEM_BASE` (direct mode only). The slug list is appended from `getSlugIndex()` (scraped from `https://wpforms.com/wpforms_doc-sitemap.xml`, cached 7 days).

### Deploy / run the Worker

```bash
cd worker
npx wrangler deploy                                  # deploy
npx wrangler tail                                    # stream logs
cp .dev.vars.example .dev.vars && npx wrangler dev   # local on :8787
```

### Rotate the bearer token

```bash
cd worker && npx wrangler secret put EXTENSION_BEARER_TOKEN
```

Then set the same value in `extension/team-config.json` (the file the extension reads on install for Worker URL + bearer token).

## Rate limits

- Worker: 60 RPM per bearer token (`worker/src/rate-limit.ts`).
- Anthropic: ~30K input TPM at org Tier 1; the Worker retries once with backoff before surfacing a 429.
- Extension: 12 iterations / 80K tokens per conversation (`extension/config.js`).

## Costs

- Sonnet: ~$0.10–0.20 per 3-step question.
- Haiku: ~$0.03–0.07 (weaker at tool selection).
- TTS: ~$0.001–0.003 per spoken message, when enabled.

## Setup from scratch

1. `cd worker && npm install`
2. `npx wrangler login`
3. `npx wrangler kv namespace create CACHE` → put the id in `wrangler.toml`
4. Set secrets: `npx wrangler secret put` for `ANTHROPIC_API_KEY`, `EXTENSION_BEARER_TOKEN`, `ELEVENLABS_API_KEY`
5. `npx wrangler deploy`
6. Copy `extension/team-config.example.json` → `team-config.json`; set the Worker URL + bearer token
7. Load `extension/` unpacked at `chrome://extensions` (Developer mode)
8. Open a WPForms admin page and press Escape
