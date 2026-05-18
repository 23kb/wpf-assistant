import type { Env } from './env';

// Single shared bearer token authenticates all extension installs. Set via
// `wrangler secret put EXTENSION_BEARER_TOKEN`; the same value goes into the
// extension config. Rotate by setting a new secret and updating that value.
// Per-user tokens are not implemented.

export function checkAuth(req: Request, env: Env): Response | null {
  const header = req.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: missing Bearer token' }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    );
  }
  const token = header.slice('Bearer '.length).trim();
  if (!env.EXTENSION_BEARER_TOKEN || token !== env.EXTENSION_BEARER_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: invalid token' }),
      { status: 401, headers: { 'content-type': 'application/json' } }
    );
  }
  return null;
}

export function getToken(req: Request): string {
  const auth = req.headers.get('Authorization') || '';
  return auth.slice('Bearer '.length).trim();
}
