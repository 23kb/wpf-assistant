# Assistant — an on-screen helper for WPForms

A Chrome extension (MV3) + Cloudflare Worker. Press **Escape** on any WPForms
admin page, ask a question in plain English, and instead of answering with a
wall of text it **points at the exact UI element** you need — animated cursor,
arrow, and a short bubble — walking you through multi-step tasks one click at
a time.

The extension is thin. The cost-sensitive logic (Claude API call, doc cache,
slug index, optional text-to-speech) lives in a Cloudflare Worker that fronts
everything, so an API key is never shipped to clients and the prompt/doc
cache is shared.

> Status: working point-mode build (read the page → fetch the relevant WPForms
> doc → point). "Do it for me" auto mode is designed but not built.

## How it works

```
Press Escape on a WPForms admin page
  → type a question
  → content script snapshots the live DOM (selectors + visible text)
  → background worker calls the Cloudflare Worker (/chat)
  → Claude returns tool calls: read_doc / point_at / ask_user / done
  → the page animates a cursor to the target and shows a bubble
  → you click it; the loop continues with a fresh snapshot until done
```

Architecture, decisions, and gotchas live in [`CLAUDE.md`](CLAUDE.md).

## Repo layout

```
extension/   Chrome extension (MV3). Load this unpacked.
worker/      Cloudflare Worker (Anthropic + ElevenLabs proxy, KV doc cache).
docs/        Design specs (e.g. auto-mode.md).
CLAUDE.md    Architecture, how it works, and setup.
```

## Setup

You need your own Anthropic API key and a Cloudflare account. Nothing in this
repo contains credentials — they are supplied at deploy time and stay local.

**1. Deploy the Worker**

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create CACHE   # paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put EXTENSION_BEARER_TOKEN   # any long random string
npx wrangler secret put ELEVENLABS_API_KEY       # optional, for TTS
npx wrangler deploy                              # note the Worker URL
```

**2. Configure the extension**

```bash
cd extension
cp team-config.example.json team-config.json
# edit team-config.json: set worker_url + bearer_token to match the Worker
```

`team-config.json` is **gitignored** because it carries the live bearer token.
The extension reads it on install and seeds `chrome.storage`, so end users
never paste credentials.

**3. Load it**

`chrome://extensions` → enable Developer mode → **Load unpacked** →
select the `extension/` folder. Open a WPForms admin page and press Escape.

## License

No license granted. Not for redistribution.
