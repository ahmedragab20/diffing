import type { APIRoute } from 'astro';
import { buildLlmsFullTxt, resolveOrigin } from '../lib/llms';

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const origin = resolveOrigin(site, import.meta.env.BASE_URL);
  const body = await buildLlmsFullTxt(origin);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
