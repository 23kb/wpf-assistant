# Assistant — Cloudflare Worker

Thin proxy + shared cache for the WPForms Assistant Chrome extension.

**Why it exists**: holds the Anthropic API key (so it never ships inside the extension), builds the system prompt centrally (so Anthropic's prompt cache is shared across all clients), and caches WPForms docs in Cloudflare KV (so one fetch serves every client).

---

## Deploy (one time, ~5 minutes)

```bash
cd worker
npm install

# 1. Authorize wrangler against your Cloudflare account.
npx wrangler login

# 2. Create the KV namespace.
npx wrangler kv:namespace create CACHE
# Output looks like:
#   { binding = "CACHE", id = "abc1234567890..." }
# Copy that id into wrangler.toml — replace REPLACE_WITH_KV_NAMESPACE_ID.

# 3. Set secrets. Wrangler will prompt you to paste each value.
npx wrangler secret put ANTHROPIC_API_KEY
# Paste the value from your local .env at the repo root (anthropic_key=...)

npx wrangler secret put EXTENSION_BEARER_TOKEN
# Paste a random string. Generate one with: openssl rand -hex 32
# IMPORTANT: save this string — you'll paste the same value into the
# extension's Options page.

npx wrangler secret put ELEVENLABS_API_KEY
# Paste your ElevenLabs API key (from .env: eleven_labs_api_key).
# Only required if TTS is enabled in the extension. Leave it unset and
# /tts requests will return 503 (which the extension handles silently).

# 4. Deploy.
npx wrangler deploy
# Note the URL it prints, e.g.
#   https://wpforms-assistant.<your-subdomain>.workers.dev
```

## Wire up the extension

Open the Assistant Options page (chrome://extensions → Assistant → Details → Extension options). Two new fields:

- **Worker URL**: paste the URL from `wrangler deploy`.
- **Bearer token**: paste the same string you set as `EXTENSION_BEARER_TOKEN`.

Save. The extension will now route everything through the Worker.

To revert to direct Anthropic calls, clear the Worker URL field and Save.

---

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/chat` | Bearer | Anthropic Messages API proxy. Worker injects the cached system prompt + tools so prompt-cache writes are shared across all clients. |
| `POST` | `/tts` | Bearer | ElevenLabs TTS proxy. Takes `{ text, voice_id? }`, returns MP3. Cached briefly by Cloudflare's edge cache. |
| `GET` | `/doc/<slug>` | Bearer | Fetches `wpforms.com/docs/<slug>.md`. KV-cached 30 days. |
| `GET` | `/sitemap` | Bearer | Returns the cached slug index. |
| `GET` | `/health` | (none) | Sanity check. Returns `ok`. |

All authenticated routes accept `Authorization: Bearer <EXTENSION_BEARER_TOKEN>`.

## Rate limits

60 requests/minute per token. Returns `429` past that. Adjustable in `src/rate-limit.ts`.

Daily token caps and per-user accounting are not implemented — only the per-token RPM limit above.

## Local dev

```bash
cp .dev.vars.example .dev.vars
# Fill in ANTHROPIC_API_KEY and a dummy EXTENSION_BEARER_TOKEN
npx wrangler dev
# Worker runs on http://localhost:8787
# Point the extension's Worker URL field at http://localhost:8787 while iterating
```

## Rotate the bearer token

```bash
npx wrangler secret put EXTENSION_BEARER_TOKEN
# Paste a fresh random string
```

Then update the bearer token wherever the extension is configured (Options page, or `team-config.json`).
