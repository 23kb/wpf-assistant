import type { Env } from './env';

// Per-token requests-per-minute cap. Best-effort using KV (eventually
// consistent — under heavy concurrency a small overshoot is possible).
// A daily token cap is not implemented.

const RPM = 60;

export async function checkRateLimit(token: string, env: Env): Promise<Response | null> {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl_${token}_${minute}`;
  const current = parseInt((await env.CACHE.get(key)) || '0', 10);

  if (current >= RPM) {
    return new Response(
      JSON.stringify({
        error: `Rate limit: ${RPM} requests/minute exceeded. Try again in ~${60 - (Math.floor(Date.now() / 1000) % 60)}s.`,
      }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    );
  }

  // 90s TTL gives a safe overlap across minute boundaries.
  await env.CACHE.put(key, String(current + 1), { expirationTtl: 90 });
  return null;
}
