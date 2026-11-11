/**
 * The public event list for the assistant's tools. Owner: backend.
 *
 * Reads the deployed /data/events.json through the ASSETS binding (cached per isolate for 10 minutes),
 * and answers the two tools: searchEvents (filters + ranking, with the visitor's preferences as a light
 * boost) and getEvent. Results are compact on purpose: they go into the model's context.
 */
import { eventPath } from '../src/lib/eventUrl.ts'
import { fmtStart } from '../src/lib/prerender.ts'
import { priceTl } from '../src/lib/price.ts'
import { fold } from '../src/lib/text.ts'
import type { Env } from './http.ts'

export interface RawEvent {
  id: string
  title: string
  start: string
  end?: string | null
  venue: string
  district: string | null
  cat: string
  url: string
  price: string | null
  score: number
  why: string
  flags: string[]
  series?: { id: string; count: number } | null
  image?: string | null
  ticket_url?: string | null
}

interface EventsFile {
  meta: { today: string; weekday?: string }
  events: RawEvent[]
}

/** Visitor preferences as the client sends them (features/account/prefs.ts, already sanitized there). */
export interface VisitorPrefs {
  likes?: string[]
  dislikes?: string[]
  artists?: string[]
  topics?: string[]
  avoid?: string[]
  side?: 'avrupa' | 'anadolu' | 'hepsi'
  budget?: 'ucretsiz' | 'uygun' | 'hepsi'
}

export const CAT_LABEL: Record<string, string> = {
  konser: 'Konser',
  gece: 'Gece',
  tiyatro: 'Tiyatro',
  sanat: 'Sanat',
  akademik: 'Akademik',
  kultur: 'Kültür',
  // Public demo only (KVKK art. 6): no tasavvuf category, like web/src/themes PUBLIC_HIDDEN_THEMES.
  din: 'Kültür',
  tech: 'Teknoloji',
  doga: 'Doğa',
  yoga: 'Yoga',
  sosyal: 'Sosyal',
  fuar: 'Fuar',
  atolye: 'Atölye',
  kurs: 'Kurs',
  dans: 'Dans',
  spor: 'Spor',
}
/** Category theme keys of the web app that differ from the raw `cat`. */
const THEME_OF_CAT: Record<string, string> = { din: 'kultur', tech: 'teknoloji', kurs: 'atolye' }

/** Anatolian-side districts and neighbourhoods (subset of web/src/lib/geo.ts, enough for filtering). */
const ASIA = new Set(
  `adalar atasehir beykoz cekmekoy kadikoy kartal maltepe pendik sancaktepe sultanbeyli sile tuzla umraniye uskudar
   moda fenerbahce kalamis caddebostan goztepe erenkoy suadiye bostanci kozyatagi hasanpasa yeldegirmeni acibadem
   kosuyolu altunizade baglarbasi kuzguncuk cengelkoy beylerbeyi kandilli anadoluhisari kanlica pasabahce
   kucukyali idealtepe dragos cevizli kurtkoy agva buyukada heybeliada burgazada kinaliada camlica icerenkoy
   kayisdagi feneryolu selamicesme fikirtepe harem selimiye salacak bulgurlu kavacik samandira`.split(/\s+/),
)

function sideOf(district: string | null): 'avrupa' | 'anadolu' | null {
  if (!district) return null
  return ASIA.has(fold(district).replace(/\s+/g, '')) ? 'anadolu' : 'avrupa'
}

let cache: { data: EventsFile; until: number } | null = null

export async function loadEvents(env: Env, request: Request): Promise<EventsFile> {
  if (cache && cache.until > Date.now()) return cache.data
  const res = await env.ASSETS.fetch(new URL('/data/events.json', request.url))
  if (!res.ok) throw new Error(`events.json ${res.status}`)
  const data = (await res.json()) as EventsFile
  cache = { data, until: Date.now() + 10 * 60_000 }
  return data
}

function lastDay(e: RawEvent): string {
  return (e.end || e.start).slice(0, 10)
}

function words(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1)
}

function hasWord(text: string, w: string): boolean {
  const f = fold(w).trim()
  if (!f) return false
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(text)
}

/** Light personal boost (the web app's full scoring lives in features/account/prefs.ts). */
function personalBoost(e: RawEvent, p: VisitorPrefs | null): number {
  if (!p) return 0
  const theme = THEME_OF_CAT[e.cat] ?? e.cat
  const text = fold(`${e.title} ${e.why} ${e.venue}`)
  let b = 0
  if (p.likes?.includes(theme)) b += 14
  else if (p.dislikes?.includes(theme)) b -= 30
  if (p.artists?.some((a) => hasWord(fold(e.title), a))) b += 30
  if (p.topics?.some((t) => hasWord(text, t))) b += 10
  if (p.avoid?.some((t) => hasWord(text, t))) b -= 45
  const side = sideOf(e.district)
  if (p.side && p.side !== 'hepsi' && side && side !== p.side) b -= 8
  const tl = priceTl(e.price)
  if (p.budget === 'ucretsiz' && tl != null && tl > 0) b -= 10
  if (p.budget === 'uygun' && tl != null && tl > 600) b -= 8
  return b
}

export interface SearchArgs {
  query?: string
  date_from?: string
  date_to?: string
  categories?: string[]
  side?: 'avrupa' | 'anadolu'
  free_only?: boolean
  max_price_tl?: number
  limit?: number
}

export interface EventSummary {
  id: string
  title: string
  when: string
  place: string
  category: string
  price: string | null
  why: string
  score: number
  dates?: number
}

function summary(e: RawEvent, score: number, dates?: number): EventSummary {
  const place = e.district && !fold(e.venue).includes(fold(e.district)) ? `${e.venue}, ${e.district}` : e.venue
  return {
    id: e.id,
    title: e.title,
    when: e.end && e.end.slice(0, 10) !== e.start.slice(0, 10) ? `${fmtStart(e.start)} – ${fmtStart(e.end)}` : fmtStart(e.start),
    place,
    category: CAT_LABEL[e.cat] ?? e.cat,
    price: e.price,
    why: e.why,
    score,
    ...(dates && dates > 1 ? { dates } : {}),
  }
}

/**
 * Upcoming events matching every given filter, best first (base score + personal boost, sooner on ties).
 * A series counts once (its next date) with the number of dates. Query words must all match the title,
 * description line, venue, district or category (Turkish-forgiving).
 */
export function searchEvents(data: EventsFile, args: SearchArgs, prefs: VisitorPrefs | null): EventSummary[] {
  const today = data.meta.today
  const from = args.date_from && /^\d{4}-\d{2}-\d{2}$/.test(args.date_from) ? args.date_from : today
  const to = args.date_to && /^\d{4}-\d{2}-\d{2}$/.test(args.date_to) ? args.date_to : null
  const qs = words(args.query ?? '')
  const cats = (args.categories ?? []).map((c) => fold(c))
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 20)

  const hits = data.events.filter((e) => {
    if (lastDay(e) < from || (to && e.start.slice(0, 10) > to)) return false
    if (e.flags.includes('tukendi') || e.flags.includes('dolu')) return false
    if (cats.length && !cats.some((c) => c === e.cat || fold(CAT_LABEL[e.cat] ?? '') === c || THEME_OF_CAT[e.cat] === c)) return false
    if (args.side && sideOf(e.district) !== args.side) return false
    const tl = priceTl(e.price)
    if (args.free_only && tl !== 0) return false
    if (args.max_price_tl != null && (tl == null || tl > args.max_price_tl)) return false
    if (qs.length) {
      const text = fold(`${e.title} ${e.why} ${e.venue} ${e.district ?? ''} ${CAT_LABEL[e.cat] ?? ''}`)
      if (!qs.every((w) => text.includes(w))) return false
    }
    return true
  })

  const ranked = hits
    .map((e) => ({ e, s: Math.max(0, Math.min(99, e.score + personalBoost(e, prefs))) }))
    .sort((a, b) => b.s - a.s || a.e.start.localeCompare(b.e.start))
  const seen = new Map<string, number>()
  for (const e of hits) if (e.series) seen.set(e.series.id, (seen.get(e.series.id) ?? 0) + 1)
  const out: EventSummary[] = []
  const done = new Set<string>()
  for (const { e, s } of ranked) {
    const key = e.series?.id ?? e.id
    if (done.has(key)) continue
    done.add(key)
    out.push(summary(e, s, e.series ? seen.get(e.series.id) : undefined))
    if (out.length >= limit) break
  }
  return out
}

export interface EventDetail extends EventSummary {
  page: string
  ticket: boolean
  other_dates?: string[]
}

export function getEvent(data: EventsFile, id: string, prefs: VisitorPrefs | null): EventDetail | null {
  const e = data.events.find((x) => x.id === id)
  if (!e) return null
  const s = Math.max(0, Math.min(99, e.score + personalBoost(e, prefs)))
  const others = e.series
    ? data.events
        .filter((x) => x.series?.id === e.series!.id && x.id !== e.id && lastDay(x) >= data.meta.today)
        .map((x) => fmtStart(x.start))
        .slice(0, 12)
    : []
  return {
    ...summary(e, s),
    page: eventPath(e),
    ticket: !!e.ticket_url,
    ...(others.length ? { other_dates: others } : {}),
  }
}
