import type { Env } from './env';
import { getSlugIndex } from './system-prompt';

const DOC_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const CLIENT_HEADER = 'WPForms Assistant Worker (team)';

export async function handleSitemap(env: Env): Promise<Response> {
  const slugs = await getSlugIndex(env);
  return new Response(JSON.stringify({ slugs, count: slugs.length }), {
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleDoc(slug: string, env: Env): Promise<Response> {
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return new Response(JSON.stringify({ error: 'Invalid slug' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const key = `doc_${slug}`;
  const cached = (await env.CACHE.get(key, 'json')) as
    | { content: string; at: number }
    | null;
  if (cached && Date.now() - cached.at < DOC_TTL_MS) {
    return new Response(
      JSON.stringify({ slug, content: cached.content, cached: true }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  const url = `https://wpforms.com/docs/${encodeURIComponent(slug)}.md`;
  const response = await fetch(url, {
    headers: { 'X-Worker-Client': CLIENT_HEADER },
  });

  if (!response.ok) {
    return new Response(
      JSON.stringify({ error: `Doc fetch HTTP ${response.status} for "${slug}"` }),
      { status: response.status, headers: { 'content-type': 'application/json' } }
    );
  }

  const text = await response.text();
  // Cap doc bodies to keep KV writes small and Claude input bounded.
  const trimmed = text.length > 12000 ? text.slice(0, 12000) + '\n…[truncated]' : text;

  await env.CACHE.put(
    key,
    JSON.stringify({ content: trimmed, at: Date.now() }),
    { expirationTtl: Math.floor(DOC_TTL_MS / 1000) + 3600 }
  );

  return new Response(
    JSON.stringify({ slug, content: trimmed, cached: false }),
    { headers: { 'content-type': 'application/json' } }
  );
}
