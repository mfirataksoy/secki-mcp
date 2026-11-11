/**
 * Shareable, indexable event addresses. Owner: shell.
 *
 * Every event has a page at /etkinlik/<slug>, where the slug is the title plus the event id, so the
 * address reads well and still finds the record:
 *
 *   eventSlug({ id: 'e83d55d4cfe7', title: 'Soen: Memorial Tour' }) -> 'soen-memorial-tour-e83d55d4cfe7'
 *   eventPath(e)                                                   -> '/etkinlik/soen-memorial-tour-e83d55d4cfe7'
 *   parseEventSlug('soen-memorial-tour-e83d55d4cfe7')              -> { id: 'e83d55d4cfe7', titleSlug: 'soen-memorial-tour' }
 *
 * Ids can change when a source edits an event, so findEventForSlug falls back to the title: the next
 * upcoming event with the same title slug (a series' next date), else the latest past one.
 *
 * Also used by scripts/prerender.mjs, so keep it free of Vue and browser APIs.
 */
import { slugify } from './text.ts'

const ID_RE = /^e[0-9a-f]{11}$/
const TITLE_MAX = 60

export function eventSlug(e: { id: string; title: string }): string {
  const t = slugify(e.title, TITLE_MAX)
  return t ? `${t}-${e.id}` : e.id
}

export function eventPath(e: { id: string; title: string }): string {
  return `/etkinlik/${eventSlug(e)}`
}

export function parseEventSlug(slug: string): { id: string | null; titleSlug: string } {
  const s = slug.trim().toLowerCase().replace(/\/+$/, '')
  if (ID_RE.test(s)) return { id: s, titleSlug: '' }
  const m = /^(.*)-(e[0-9a-f]{11})$/.exec(s)
  return m ? { id: m[2]!, titleSlug: m[1]! } : { id: null, titleSlug: s }
}

interface Findable {
  id: string
  title: string
  startDate: Date
  isPast: boolean
}

/** The event a slug points at: by id, else the nearest upcoming (or latest past) event with that title. */
export function findEventForSlug<T extends Findable>(events: readonly T[], slug: string): T | null {
  const { id, titleSlug } = parseEventSlug(slug)
  if (id) {
    const hit = events.find((e) => e.id === id)
    if (hit) return hit
  }
  if (!titleSlug) return null
  const same = events.filter((e) => slugify(e.title, TITLE_MAX) === titleSlug)
  const upcoming = same.filter((e) => !e.isPast).sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  if (upcoming.length) return upcoming[0]!
  return [...same].sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0] ?? null
}

/** '#/harita?zaman=aksam' (an old hash-router link) -> '/harita?zaman=aksam'; anything else -> null. */
export function hashRouteToPath(hash: string): string | null {
  return hash.startsWith('#/') ? hash.slice(1) : null
}
