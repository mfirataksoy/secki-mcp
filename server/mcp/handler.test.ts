import { beforeEach, describe, expect, it } from 'vitest'
import type { Env } from '../http.ts'
import { resetDataCache } from './data.ts'
import { FIXTURE } from './fixtures/events.ts'
import { buildMcpIndex } from './indexer.ts'
import { MSG } from './messages.ts'
import { TokenBuckets } from './ratelimit.ts'
import { handleMcp, INSTRUCTIONS, SERVER_INFO } from './server.ts'
import { GET_DESCRIPTION, SEARCH_DESCRIPTION, SearchOutput } from './tools.ts'

const URL_MCP = 'https://secki.istanbul/mcp'
const NOW = Date.parse('2026-11-11T12:00:00+03:00')
const INDEX_JSON = JSON.stringify(buildMcpIndex(FIXTURE))
const MODERN = '2026-07-28'

let dataStatus = 200
const env = {
  ASSETS: {
    fetch: async (input: URL | string) => {
      const path = new URL(String(input)).pathname
      if (path === '/data/mcp-index.json' && dataStatus === 200) {
        return new Response(INDEX_JSON, { headers: { 'content-type': 'application/json' } })
      }
      return new Response('unavailable', { status: dataStatus === 200 ? 404 : dataStatus })
    },
  },
} as unknown as Env

beforeEach(() => {
  dataStatus = 200
  resetDataCache()
})

const call = (req: Request, limiter = new TokenBuckets(1000, 1000)) => handleMcp(req, env, { now: () => NOW, limiter })

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const META = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

/** A 2026-07-28 request: headers that mirror the body, and the per-request _meta envelope. */
function modern(id: number, method: string, params: Record<string, unknown> = {}, name?: string): Request {
  return post(
    { jsonrpc: '2.0', id, method, params: { ...params, _meta: META } },
    { 'mcp-protocol-version': MODERN, 'mcp-method': method, ...(name ? { 'mcp-name': name } : {}) },
  )
}

function withOrigin(req: Request, origin: string): Request {
  const headers = new Headers(req.headers)
  headers.set('origin', origin)
  return new Request(req, { headers })
}

/** The JSON-RPC message of a response: a JSON body, or the first `data:` line of an SSE stream. */
async function rpc(res: Response): Promise<{ id?: unknown; result?: any; error?: { code: number; message: string; data?: any } }> {
  const text = await res.text()
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const line = text.split('\n').find((l) => l.startsWith('data:'))
    return JSON.parse(line!.slice(5))
  }
  return JSON.parse(text)
}

describe('legacy era (initialize handshake)', () => {
  it('initializes, then lists two read-only tools with output schemas', async () => {
    const init = await call(
      post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'vitest', version: '1.0.0' } },
      }),
    )
    expect(init.status).toBe(200)
    const msg = await rpc(init)
    expect(msg.result.serverInfo).toMatchObject(SERVER_INFO)
    expect(msg.result.protocolVersion).toBe('2025-11-25')
    expect(msg.result.instructions).toBe(INSTRUCTIONS)
    expect(init.headers.get('mcp-session-id')).toBeNull()

    const list = await rpc(await call(post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-protocol-version': '2025-11-25' })))
    const tools = list.result.tools as { name: string; title: string; description: string; annotations: Record<string, boolean>; outputSchema: unknown }[]
    expect(tools.map((t) => t.name)).toEqual(['search_events', 'get_event'])
    for (const t of tools) {
      expect(t.title).toBeTruthy()
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false })
      expect(t.outputSchema).toBeTruthy()
    }
    expect(tools[0]!.description).toBe(SEARCH_DESCRIPTION)
    expect(tools[1]!.description).toBe(GET_DESCRIPTION)
  })

  it('accepts a notification with 202', async () => {
    const res = await call(post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-protocol-version': '2025-11-25' }))
    expect(res.status).toBe(202)
  })
})

describe('modern era (2026-07-28)', () => {
  it('answers server/discover with public cache hints', async () => {
    const res = await call(modern(1, 'server/discover'))
    expect(res.status).toBe(200)
    const msg = await rpc(res)
    expect(JSON.stringify(msg.result)).toContain('"cacheScope":"public"')
    expect(msg.result.ttlMs).toBe(86_400_000)
    expect(msg.result.supportedVersions).toContain(MODERN)
  })

  it('calls search_events and returns structuredContent that fits the output schema', async () => {
    const res = await call(modern(2, 'tools/call', { name: 'search_events', arguments: { when: 'this_weekend' } }, 'search_events'))
    expect(res.status).toBe(200)
    const msg = await rpc(res)
    expect(msg.result.isError).toBeFalsy()
    const out = SearchOutput.parse(msg.result.structuredContent)
    expect(out.range).toMatchObject({ from: '2026-11-13', to: '2026-11-15' })
    expect(out.events.length).toBeGreaterThan(0)
    expect(msg.result.content[0].text).toMatch(/^\d+ events in Istanbul for this_weekend/)
  })

  it('returns a recoverable error for an unknown id', async () => {
    const msg = await rpc(await call(modern(3, 'tools/call', { name: 'get_event', arguments: { id: 'e0123456789a' } }, 'get_event')))
    expect(msg.result.isError).toBe(true)
    expect(msg.result.content[0].text).toBe(MSG.notFound('e0123456789a'))
  })

  it('returns zod messages for bad arguments and refuses unknown keys', async () => {
    const bad = await rpc(await call(modern(4, 'tools/call', { name: 'search_events', arguments: { limit: 99 } }, 'search_events')))
    expect(bad.result.isError).toBe(true)
    expect(bad.result.content[0].text).toContain('limit must be 1-20')
    const date = await rpc(await call(modern(5, 'tools/call', { name: 'search_events', arguments: { date_from: '2026-02-30' } }, 'search_events')))
    expect(date.result.content[0].text).toContain('2026-02-30 is not a real calendar date.')
    const extra = await rpc(await call(modern(6, 'tools/call', { name: 'search_events', arguments: { city: 'Ankara' } }, 'search_events')))
    expect(extra.result.isError).toBe(true)
    expect(extra.result.content[0].text).toContain('city')
  })

  it('turns a missing data file into the E11 retry message', async () => {
    dataStatus = 503
    const msg = await rpc(await call(modern(7, 'tools/call', { name: 'search_events', arguments: {} }, 'search_events')))
    expect(msg.result.isError).toBe(true)
    expect(msg.result.content[0].text).toBe(MSG.dataDown('data file returned 503'))
  })

  it('leaves the SDK protocol errors in place: missing Mcp-Name, unsupported version', async () => {
    const noName = await call(modern(8, 'tools/call', { name: 'search_events', arguments: {} }))
    expect(noName.status).toBe(400)
    expect((await rpc(noName)).error?.code).toBe(-32020)
    const future = await call(
      post(
        { jsonrpc: '2.0', id: 9, method: 'server/discover', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } },
        { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'server/discover' },
      ),
    )
    expect(future.status).toBe(400)
    expect((await rpc(future)).error?.code).toBe(-32022)
  })

  it('refuses subscriptions/listen instead of holding a stream open', async () => {
    const res = await call(modern(10, 'subscriptions/listen', {}))
    expect(res.status).toBe(404)
    const msg = await rpc(res)
    expect(msg).toMatchObject({ id: 10, error: { code: -32601, message: MSG.noSubscriptions() } })
  })

  it('leaves a malformed listen to the SDK checks, which never open a stream', async () => {
    const future = await call(
      post(
        { jsonrpc: '2.0', id: 15, method: 'subscriptions/listen', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } } },
        { 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'subscriptions/listen' },
      ),
    )
    expect(future.status).toBe(400)
    expect((await rpc(future)).error?.code).toBe(-32022)
    const mismatch = await call(
      post({ jsonrpc: '2.0', id: 16, method: 'subscriptions/listen', params: { _meta: META } }, { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/list' }),
    )
    expect(mismatch.status).toBe(400)
    expect((await rpc(mismatch)).error?.code).toBe(-32020)
    const note = await call(
      post({ jsonrpc: '2.0', method: 'subscriptions/listen', params: { _meta: META } }, { 'mcp-protocol-version': MODERN, 'mcp-method': 'subscriptions/listen' }),
    )
    expect(note.status).toBe(202)
    expect(await note.text()).toBe('')
  })

  it('gives argument errors with a suggestion', async () => {
    const tool = async (id: number, args: Record<string, unknown>) =>
      (await rpc(await call(modern(id, 'tools/call', { name: 'search_events', arguments: args }, 'search_events')))).result as {
        isError?: boolean
        content: { text: string }[]
      }
    const cat = await tool(20, { categories: ['concert'] })
    expect(cat.isError).toBe(true)
    expect(cat.content[0]!.text).toContain('"concert" is not a category; use "konser".')
    expect((await tool(21, { categories: ['atölye'] })).content[0]!.text).toContain('use "atolye"')
    expect((await tool(22, { categories: ['tiyatroo'] })).content[0]!.text).toContain('use "tiyatro"')
    expect((await tool(23, { when: 'weekend' })).content[0]!.text).toContain('"weekend" is not a "when" value; did you mean "this_weekend"?')
    expect((await tool(24, { when: 'bu hafta sonu' })).content[0]!.text).toContain('did you mean "this_weekend"?')
    expect((await tool(25, { max_price_tl: '1000' })).content[0]!.text).toContain('max_price_tl must be a JSON number: send 1000, not "1000".')
    expect((await tool(26, { free_only: 'true' })).content[0]!.text).toContain('free_only must be a JSON boolean: send true, not "true".')
    expect((await tool(27, { max_price_tl: -5 })).content[0]!.text).toContain('max_price_tl cannot be negative.')
    expect((await tool(28, { language: 'english' })).content[0]!.text).toContain('language is a two-letter code')
    const fine = await tool(29, { language: 'en', when: 'tomorrow_evening' })
    expect(fine.isError).toBeFalsy()
  })
})

describe('HTTP guard', () => {
  it('refuses a JSON-RPC batch in every era, so one rate-limit token is one message', async () => {
    const batch = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]
    for (const version of ['2025-11-25', '2025-03-26']) {
      const res = await call(post(batch, { 'mcp-protocol-version': version }))
      expect(res.status).toBe(400)
      expect((await rpc(res)).error).toMatchObject({ code: -32600, message: MSG.noBatch() })
    }
    const noHeader = await call(post(batch))
    expect(noHeader.status).toBe(400)
  })

  it('answers GET and DELETE with 405 and a helpful body', async () => {
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const res = await call(new Request(URL_MCP, { method }))
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST, OPTIONS')
      expect(await res.text()).toContain('https://secki.istanbul/llms.txt')
    }
  })

  it('refuses a foreign Origin with 403 and allows a local one with CORS', async () => {
    const evil = await call(withOrigin(modern(11, 'server/discover'), 'https://evil.example'))
    expect(evil.status).toBe(403)
    expect((await rpc(evil)).error).toMatchObject({ code: -32000, message: 'Invalid Origin: evil.example' })
    // every method, before the 405 gate
    for (const method of ['GET', 'DELETE', 'OPTIONS']) {
      expect((await call(new Request(URL_MCP, { method, headers: { origin: 'https://evil.example' } }))).status).toBe(403)
    }
    // one allowlist for 403 and CORS: plain http or another port of secki.istanbul is refused, not let through without CORS
    for (const origin of ['http://secki.istanbul', 'https://secki.istanbul:8443', 'null', 'http://localhost.evil.com']) {
      expect((await call(withOrigin(modern(11, 'server/discover'), origin))).status).toBe(403)
    }
    const v6 = await call(withOrigin(modern(11, 'server/discover'), 'http://[::1]:6274'))
    expect(v6.status).toBe(200)
    expect(v6.headers.get('access-control-allow-origin')).toBe('http://[::1]:6274')
    const site = await call(withOrigin(modern(11, 'server/discover'), 'https://secki.istanbul'))
    expect(site.headers.get('access-control-allow-origin')).toBe('https://secki.istanbul')

    const pre = await call(new Request(URL_MCP, { method: 'OPTIONS', headers: { origin: 'http://localhost:6274', 'access-control-request-method': 'POST' } }))
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:6274')
    expect(pre.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
    expect(pre.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version')
    expect(pre.headers.get('vary')).toContain('Origin')

    const local = await call(withOrigin(modern(12, 'server/discover'), 'http://127.0.0.1:6274'))
    expect(local.status).toBe(200)
    expect(local.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:6274')
    expect(local.headers.get('access-control-expose-headers')).toBe('mcp-protocol-version')
  })

  it('caps the body at 64 KB', async () => {
    const big = { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'search_events', arguments: { query: 'x'.repeat(70_000) }, _meta: META } }
    const res = await call(post(big, { 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/call', 'mcp-name': 'search_events' }))
    expect(res.status).toBe(413)
    expect((await rpc(res)).error).toMatchObject({ code: -32600, message: MSG.tooLarge(65_536) })
  })

  it('limits one client per isolate with 429 and Retry-After', async () => {
    const limiter = new TokenBuckets(2, 0.5)
    const req = () => modern(14, 'server/discover')
    expect((await call(req(), limiter)).status).toBe(200)
    expect((await call(req(), limiter)).status).toBe(200)
    const limited = await call(req(), limiter)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('2')
    expect((await rpc(limited)).error?.message).toBe(MSG.rateLimited(2))
  })
})
