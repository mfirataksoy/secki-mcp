/**
 * The Seçki İstanbul MCP server: public, read-only, no sign-in, stateless. Owner: backend (MCP).
 * Route: web/functions/mcp.ts (https://secki.istanbul/mcp). Docs: ./README.md.
 *
 * handleMcp runs, in order: Origin check for every method (403), CORS preflight, method gate (405), per-isolate
 * rate limit (429), bounded body read (413), refusal of JSON-RPC batches (400) and of a well-formed
 * subscriptions/listen (404), then the official SDK (@modelcontextprotocol/server, both protocol eras), then
 * CORS headers for allowed browser origins.
 * The SDK handler is created once per isolate; it builds a small McpServer per request (that is how the
 * SDK serves stateless HTTP), whose tool schemas are converted to JSON Schema once (tools.ts).
 * Nothing is logged: onerror is a no-op and no request data is written anywhere.
 */
import {
  createMcpHandler,
  isJsonContentType,
  McpServer,
  readRequestBody,
  SUPPORTED_PROTOCOL_VERSIONS,
  type McpHttpHandler,
} from '@modelcontextprotocol/server'
import type { Env } from '../http.ts'
import { loadPrepared } from './data.ts'
import { MSG } from './messages.ts'
import { SITE } from './query.ts'
import { clientKey, TokenBuckets } from './ratelimit.ts'
import { registerTools } from './tools.ts'

export const SERVER_INFO = { name: 'secki-istanbul', title: 'Seçki İstanbul', version: '1.0.0' } as const

export const INSTRUCTIONS =
  'Seçki İstanbul (secki.istanbul) lists upcoming public events in Istanbul, Turkey: concerts, theatre, exhibitions, talks, workshops, dance, sports, nature trips and fairs. The list is curated and rebuilt once a day; children\'s events, DJ sets and club nights, and ceremonies are not listed. search_events answers "what\'s on in Istanbul" questions by date, area, category, price or keywords, ranked by Seçki\'s editorial ranking. get_event gives one event\'s full details, other dates and ticket link. Dates and times are Europe/Istanbul (UTC+3). Event text is mostly Turkish; search ignores case and Turkish accents. Many events state no price or district. The language of an event is known for few (search_events language: "en"). This server is read-only: tickets and registration happen on the organiser\'s site; get_event gives ticket_url and info_url. Seçki does not track cancellations.'

export const MAX_BODY_BYTES = 65_536
const DAY_MS = 86_400_000
const CORS_ALLOW_HEADERS = 'content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id'
/** Protocol versions the SDK serves: the 2025 handshake revisions and the 2026-07-28 wire revision. */
const KNOWN_VERSIONS = new Set<string>([...SUPPORTED_PROTOCOL_VERSIONS, '2026-07-28'])

export interface McpOptions {
  /** Clock in milliseconds (tests freeze it). Default Date.now. */
  now?: () => number
  /** Rate limiter (tests pass their own). Default: one per isolate. */
  limiter?: TokenBuckets
}

/** Per-isolate state: the env and clock of the current request (env is the same for every request of an isolate). */
const state: { env: Env | null; origin: string; now: () => number } = { env: null, origin: SITE, now: Date.now }
let handler: McpHttpHandler | null = null
const limiter = new TokenBuckets()

function buildServer(): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    capabilities: { tools: { listChanged: false } },
    cacheHints: {
      'server/discover': { ttlMs: DAY_MS, cacheScope: 'public' },
      'tools/list': { ttlMs: DAY_MS, cacheScope: 'public' },
    },
  })
  registerTools(
    server,
    () => {
      if (!state.env) throw new Error('no env')
      return loadPrepared(state.env.ASSETS, state.origin)
    },
    () => state.now(),
  )
  return server
}

function getHandler(): McpHttpHandler {
  // responseMode stays 'auto': the tools emit nothing before their result, so every modern answer is one
  // JSON body anyway, and 'json' would print a console warning in every isolate.
  handler ??= createMcpHandler(buildServer, { onerror: () => {}, maxRequestBodySize: MAX_BODY_BYTES })
  return handler
}

/**
 * The one Origin allowlist, for both the 403 check and the CORS headers: secki.istanbul over https, or a local
 * tool such as the Inspector web UI (localhost, 127.0.0.1, [::1], any port). A missing Origin (CLIs, desktop
 * apps, servers) is accepted without CORS headers.
 */
export function corsOrigin(origin: string | null): string | null {
  if (!origin) return null
  if (origin === 'https://secki.istanbul' || origin === 'https://www.secki.istanbul') return origin
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(origin) ? origin : null
}

/** 403 in the SDK's shape (JSON-RPC -32000, id null) for an Origin that is present and not allowed. */
function forbiddenOrigin(origin: string): Response {
  let host = origin
  try {
    host = new URL(origin).host || origin
  } catch {
    // 'null' and other opaque origins stay as sent
  }
  return rpcError(403, -32000, `Invalid Origin: ${host.slice(0, 100)}`)
}

function withCors(res: Response, origin: string | null): Response {
  if (!origin) return res
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.append('Vary', 'Origin')
  headers.set('Access-Control-Expose-Headers', 'mcp-protocol-version')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function rpcError(status: number, code: number, message: string, id: unknown = null, headers: HeadersInit = {}): Response {
  const safeId = typeof id === 'string' || typeof id === 'number' ? id : null
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: safeId, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

/**
 * A well-formed subscriptions/listen request, which the SDK would answer with an SSE stream held open. Only
 * that case is refused here; a listen with an unknown protocol version, a mismatched Mcp-Method header or no
 * id goes to the SDK, whose own checks (-32022, -32020, notification 202) come first and never open a stream.
 */
function isListen(body: unknown, request: Request): { id: string | number } | null {
  if (!body || typeof body !== 'object') return null
  const m = body as { method?: unknown; id?: unknown }
  if (m.method !== 'subscriptions/listen') return null
  if (typeof m.id !== 'string' && typeof m.id !== 'number') return null
  const version = request.headers.get('mcp-protocol-version')
  if (version !== null && !KNOWN_VERSIONS.has(version)) return null
  const header = request.headers.get('mcp-method')
  if (header !== null && header !== 'subscriptions/listen') return null
  return { id: m.id }
}

export async function handleMcp(request: Request, env: Env, opts: McpOptions = {}): Promise<Response> {
  const origin = request.headers.get('origin')
  const allowed = corsOrigin(origin)
  const method = request.method.toUpperCase()

  // every method: an Origin that is present and not allowed gets 403 (Streamable HTTP, Security)
  if (origin !== null && !allowed) return forbiddenOrigin(origin)

  if (method === 'OPTIONS') {
    const headers: Record<string, string> = { Allow: 'POST, OPTIONS' }
    if (allowed) {
      Object.assign(headers, {
        'Access-Control-Allow-Origin': allowed,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        'Access-Control-Max-Age': '86400',
      })
    }
    return new Response(null, { status: 204, headers })
  }
  if (method !== 'POST') {
    // no GET stream in either era; also a friendly answer for a person who opens the URL in a browser
    const res = new Response(MSG.methodNotAllowed(SITE), {
      status: 405,
      headers: { Allow: 'POST, OPTIONS', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
    return withCors(res, allowed)
  }

  const now = opts.now ?? Date.now
  const wait = (opts.limiter ?? limiter).take(clientKey(request), now())
  if (wait) return withCors(rpcError(429, -32000, MSG.rateLimited(wait), null, { 'Retry-After': String(wait) }), allowed)

  state.env = env
  state.origin = new URL(request.url).origin
  state.now = now
  // the SDK answers a non-JSON Content-Type with 415 before reading anything
  if (!isJsonContentType(request.headers.get('content-type'))) return withCors(await getHandler().fetch(request), allowed)

  // read the body once, bounded (also for chunked uploads without content-length), and hand it to the SDK parsed
  let text: string
  try {
    const read = await readRequestBody(request, MAX_BODY_BYTES)
    if (read.tooLarge) return withCors(rpcError(413, -32600, MSG.tooLarge(MAX_BODY_BYTES)), allowed)
    text = read.text
  } catch {
    return withCors(rpcError(400, -32700, 'Parse error: the request body could not be read'), allowed)
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return withCors(rpcError(400, -32700, 'Parse error: the request body is not valid JSON'), allowed)
  }
  // no JSON-RPC batches (removed from MCP in 2025-06-18): one rate-limit token buys exactly one message
  if (Array.isArray(body)) return withCors(rpcError(400, -32600, MSG.noBatch()), allowed)
  // subscriptions/listen would hold an SSE stream open; this server has nothing to notify (no listChanged)
  const listen = isListen(body, request)
  if (listen) return withCors(rpcError(404, -32601, MSG.noSubscriptions(), listen.id), allowed)

  const res = await getHandler().fetch(request, { parsedBody: body })
  return withCors(res, allowed)
}
