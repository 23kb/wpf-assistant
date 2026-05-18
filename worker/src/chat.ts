import type { Env } from './env';
import { buildSystemPrompt } from './system-prompt';
import { TOOLS } from './tools';
import { checkRateLimit } from './rate-limit';
import { getToken } from './auth';

const MODEL_DEFAULT = 'claude-sonnet-4-6';
const MAX_TOKENS = 2048;

interface ChatRequest {
  messages: unknown[];
  model?: string;
}

export async function handleChat(req: Request, env: Env): Promise<Response> {
  const token = getToken(req);
  const limited = await checkRateLimit(token, env);
  if (limited) return limited;

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (!Array.isArray(body.messages)) {
    return jsonError('messages array required', 400);
  }

  const system = await buildSystemPrompt(env);

  // Incremental conversation caching. Our protocol mutates the trailing
  // user tool_result in place between turns (see background.js gotcha), so
  // the only stable prefix is everything up to the last *assistant*
  // message — its content is appended once and never rewritten. Tagging
  // its last block lets the next turn read the whole prior conversation
  // (system + tools + all earlier turns) from cache instead of
  // re-billing every prior page snapshot. 1h TTL because steps are
  // user-paced (reading a doc/bubble can exceed the 5m default).
  addConversationCacheBreakpoint(body.messages);

  const anthropicReq = {
    model: body.model || MODEL_DEFAULT,
    max_tokens: MAX_TOKENS,
    // 1h TTL: the system prompt + slug list is large, static, and shared
    // across every request — keep it warm for an hour, not 5m.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    tools: TOOLS,
    messages: body.messages,
  };

  let response = await callAnthropic(anthropicReq, env);

  // Single retry with backoff on 429 — Anthropic's org-level TPM limit
  // resets every 60s, so even a short wait often clears it. Returning the
  // raw 429 to the extension would just look like a hard failure.
  if (response.status === 429) {
    const retryAfter = parseFloat(response.headers.get('retry-after') || '15');
    const waitMs = Math.min(Math.max(retryAfter * 1000, 5000), 30000);
    console.log(`[Assistant Worker] 429 from Anthropic, retrying in ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
    response = await callAnthropic(anthropicReq, env);
  }

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[Assistant Worker] Anthropic ${response.status}: ${errBody}`);
    return new Response(errBody, {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Pass through verbatim — Anthropic returns JSON for non-streaming calls,
  // which the extension's existing parser already understands.
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
    },
  });
}

// Tag the last assistant message's last content block with a 1h cache
// breakpoint. Anthropic auto-reads the longest previously-written prefix
// that still matches byte-for-byte, so this single moving breakpoint makes
// cache hits accrue incrementally as the conversation grows. No-op on the
// first turn (no assistant message yet) or if content isn't a block array.
// 2 breakpoints total (system + this) — well under the 4 max.
function addConversationCacheBreakpoint(messages: unknown[]): void {
  if (!Array.isArray(messages)) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m && m.role === 'assistant' && Array.isArray(m.content) && m.content.length) {
      const last = m.content[m.content.length - 1] as Record<string, unknown> | null;
      if (last && typeof last === 'object') {
        last.cache_control = { type: 'ephemeral', ttl: '1h' };
      }
      return;
    }
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function callAnthropic(body: unknown, env: Env): Promise<Response> {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
