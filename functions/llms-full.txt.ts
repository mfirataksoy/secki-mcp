/**
 * /llms-full.txt -> 301 to /llms.txt. Owner: backend (MCP). Some agents probe the "full" variant of llms.txt;
 * without this route the SPA fallback answers it with index.html and status 200 (a soft 404).
 */
import type { Handler } from '../server/http.ts'

export const onRequest: Handler = ({ request }) =>
  new Response(null, { status: 301, headers: { location: new URL('/llms.txt', request.url).href, 'cache-control': 'public, max-age=3600' } })
