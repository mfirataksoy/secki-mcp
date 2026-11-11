/**
 * Per-isolate token buckets for /mcp. Owner: backend (MCP).
 *
 * Honest scope: each Cloudflare isolate keeps its own buckets in memory, so this stops one client that
 * hammers the endpoint through one isolate (a loop, a misbehaving agent). It does not limit distributed
 * traffic or protect the daily Workers quota; the WAF rule in README.md is the outer limit. No storage, no
 * logging: the key is a 32-bit hash of the client IP, kept in memory only and dropped with the isolate.
 *
 *   const rl = new TokenBuckets(40, 4, 5000)
 *   rl.take(clientKey(request), Date.now()) -> 0 (allowed) or seconds to wait
 */

/** Requests a client may send in a burst. */
export const BURST = 40
/** Tokens refilled per second (sustained requests per second per client, per isolate). */
export const REFILL_PER_SECOND = 4
const MAX_KEYS = 5000

export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()
  private readonly capacity: number
  private readonly perSecond: number
  private readonly maxKeys: number

  constructor(capacity = BURST, perSecond = REFILL_PER_SECOND, maxKeys = MAX_KEYS) {
    this.capacity = capacity
    this.perSecond = perSecond
    this.maxKeys = maxKeys
  }

  /** Takes one token; returns 0 when allowed, else the whole seconds until a token is free. */
  take(key: string, nowMs: number): number {
    const b = this.buckets.get(key)
    const tokens = b ? Math.min(this.capacity, b.tokens + ((nowMs - b.at) / 1000) * this.perSecond) : this.capacity
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: nowMs })
      return Math.max(1, Math.ceil((1 - tokens) / this.perSecond))
    }
    if (!b && this.buckets.size >= this.maxKeys) {
      // drop the oldest entries (Map keeps insertion order); a dropped client simply starts full again
      for (const k of [...this.buckets.keys()].slice(0, Math.ceil(this.maxKeys / 10))) this.buckets.delete(k)
    }
    this.buckets.delete(key)
    this.buckets.set(key, { tokens: tokens - 1, at: nowMs })
    return 0
  }
}

/** FNV-1a hash of the client IP (cf-connecting-ip); 'local' without one. */
export function clientKey(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')
  if (!ip) return 'local'
  let h = 0x811c9dc5
  for (let i = 0; i < ip.length; i++) {
    h ^= ip.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
