import type { Env } from './env';
import { checkAuth } from './auth';
import { handleChat } from './chat';
import { handleSitemap, handleDoc } from './docs';
import { handleTTS } from './tts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(req.url);

      // Health check — unauthenticated.
      if (url.pathname === '/health') {
        return withCors(new Response('ok'));
      }

      const authError = checkAuth(req, env);
      if (authError) return withCors(authError);

      if (url.pathname === '/chat' && req.method === 'POST') {
        return withCors(await handleChat(req, env));
      }
      if (url.pathname === '/tts' && req.method === 'POST') {
        return withCors(await handleTTS(req, env));
      }
      if (url.pathname === '/sitemap' && req.method === 'GET') {
        return withCors(await handleSitemap(env));
      }
      if (url.pathname.startsWith('/doc/') && req.method === 'GET') {
        const slug = decodeURIComponent(url.pathname.slice('/doc/'.length));
        return withCors(await handleDoc(slug, env));
      }

      return withCors(new Response('Not found', { status: 404 }));
    } catch (err) {
      console.error('[Assistant Worker] Unhandled error:', err);
      return withCors(
        new Response(
          JSON.stringify({ error: String(err) }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        )
      );
    }
  },
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}
