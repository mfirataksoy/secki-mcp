/**
 * /.well-known/* -> a JSON 404 instead of the SPA's index.html with status 200. Owner: backend.
 *
 * MCP and OAuth clients probe paths such as /.well-known/oauth-protected-resource; an HTML 200 there looks
 * like broken metadata. A real static file under /.well-known/ (none today) is still served as it is.
 */
import type { Handler } from '../../server/http.ts'

export const onRequest: Handler = async ({ request, env }) => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    const asset = await env.ASSETS.fetch(request)
    // the SPA fallback answers every unknown path with index.html: only a non-HTML file is real
    if (asset.ok && !(asset.headers.get('content-type') ?? '').includes('text/html')) return asset
  }
  return new Response(JSON.stringify({ error: 'not_found', message: 'Nothing is published under /.well-known/ here. The MCP server at /mcp needs no sign-in.' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}
