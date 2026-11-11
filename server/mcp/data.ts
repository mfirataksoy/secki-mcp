/**
 * Loads /data/mcp-index.json (written by the demo build, see indexer.ts) through the ASSETS binding and keeps
 * the prepared index in isolate memory for 10 minutes. Owner: backend (MCP).
 *
 * Only this file is read: never events.json, profile.yaml, state.json, health.json or D1. Concurrent cold
 * requests share one fetch and one parse.
 */
import type { McpIndex } from './indexer.ts'
import { prepare, type Prepared } from './query.ts'

export const INDEX_PATH = '/data/mcp-index.json'
const TTL_MS = 10 * 60_000

/** The data file is missing, failing or malformed (shown to the agent as E11). */
export class DataUnavailable extends Error {}

interface AssetFetcher {
  fetch(input: URL | string): Promise<Response>
}

let cache: { p: Prepared; until: number } | null = null
let pending: Promise<Prepared> | null = null

async function fetchIndex(assets: AssetFetcher, origin: string): Promise<Prepared> {
  let res: Response
  try {
    res = await assets.fetch(new URL(INDEX_PATH, origin))
  } catch {
    throw new DataUnavailable('data file could not be read')
  }
  if (!res.ok) throw new DataUnavailable(`data file returned ${res.status}`)
  let index: McpIndex
  try {
    index = (await res.json()) as McpIndex
  } catch {
    // the SPA fallback answers a missing file with index.html
    throw new DataUnavailable('data file is missing')
  }
  if (!index || index.v !== 1 || !Array.isArray(index.events) || typeof index.generated_at !== 'string') {
    throw new DataUnavailable('data file has an unexpected format')
  }
  return prepare(index)
}

export async function loadPrepared(assets: AssetFetcher, origin: string): Promise<Prepared> {
  if (cache && cache.until > Date.now()) return cache.p
  if (!pending) {
    pending = fetchIndex(assets, origin)
      .then((p) => {
        cache = { p, until: Date.now() + TTL_MS }
        return p
      })
      .finally(() => {
        pending = null
      })
  }
  return pending
}

/** Tests only: forget the cached index. */
export function resetDataCache(): void {
  cache = null
  pending = null
}
