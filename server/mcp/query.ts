/**
 * The logic of the two MCP tools, without any SDK import. Owner: backend (MCP).
 *
 * Works on the build-time index (indexer.ts): filter, rank, collapse series, paginate, project to the public
 * shapes field by field, and resolve an id or event link. Every function takes `nowMs`, so the tests freeze
 * the clock; "today" is the real Istanbul date (time.ts), not the pipeline's meta.today.
 *
 *   const p = prepare(index)
 *   searchEvents(p, { when: 'this_weekend', query: 'caz' }, Date.now()) -> { ok: true, result } | { ok: false, error }
 *   getEvent(p, 'https://secki.istanbul/etkinlik/ornek-konser-e0123456789a', Date.now())
 */
import { eventPath, parseEventSlug } from '../../src/lib/eventUrl.ts'
import { sideOf, type Side } from '../../src/lib/geo.ts'
import { fmtStart } from '../../src/lib/prerender.ts'
import { slugify } from '../../src/lib/text.ts'
import { CATEGORY_LABEL, type CategoryKey } from './categories.ts'
import { ilceOf } from './districts.ts'
import type { IndexEvent, McpIndex } from './indexer.ts'
import { matchesAll, queryWords } from './match.ts'
import { count, MSG, staleDataNote } from './messages.ts'
import { addDays, dayLabel, istanbulNow, rangeLabel, whenRange, type DayRange, type IstanbulNow, type When } from './time.ts'

export const SITE = 'https://secki.istanbul'
export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 20
export const OTHER_DATES_MAX = 12
/** Characters the events of one search page may take (structured JSON + text lines); the rest stays < 16,000. */
export const PAGE_BUDGET = 13_500

/* ------------------------------------------------------------------ */
/* Prepared index (once per data load)                                 */
/* ------------------------------------------------------------------ */

export interface Prepared {
  index: McpIndex
  events: IndexEvent[]
  /** City side per event (geo.ts, else the side of its ilçe; null = unknown or outside Istanbul), same order as events. */
  side: (Side | null)[]
  byId: Map<string, number>
  /** Series group -> event positions (start order). */
  groups: Map<number, number[]>
}

function sideOfDistrict(district: string): Side | null {
  const direct = sideOf(district)
  if (direct) return direct
  // a neighbourhood geo.ts does not list (Yenibosna): the side of its ilçe
  for (const ilce of ilceOf(district)) {
    const s = sideOf(ilce)
    if (s) return s
  }
  return null
}

export function prepare(index: McpIndex): Prepared {
  const sideMemo = new Map<string, Side | null>()
  const side = index.events.map((e) => {
    if (!e.district) return null
    let s = sideMemo.get(e.district)
    if (s === undefined) sideMemo.set(e.district, (s = sideOfDistrict(e.district)))
    return s
  })
  const byId = new Map<string, number>()
  const groups = new Map<number, number[]>()
  index.events.forEach((e, i) => {
    if (!byId.has(e.id)) byId.set(e.id, i)
    if (e.group !== undefined) {
      const g = groups.get(e.group)
      if (g) g.push(i)
      else groups.set(e.group, [i])
    }
  })
  return { index, events: index.events, side, byId, groups }
}

/* ------------------------------------------------------------------ */
/* Public shapes                                                       */
/* ------------------------------------------------------------------ */

export type RegistrationStatus = 'opening_soon' | 'open' | 'closed'
export type EventStatus = 'scheduled' | 'in_progress' | 'ended' | 'sold_out' | 'full'

export interface EventSummary {
  id: string
  title: string
  when: string
  start: string
  end?: string
  venue: string | null
  district: string | null
  side: Side | null
  category: CategoryKey
  category_label: string
  workshop_type?: string
  language?: string
  price: string | null
  is_free: boolean | null
  flags: string[]
  dates?: number
  url: string
}

export interface EventDetail extends EventSummary {
  status: EventStatus
  note: string
  doors?: string
  registration?: { status: RegistrationStatus; opens?: string; last_day?: string }
  ticket_url?: string
  info_url?: string
  transit?: string[]
  location_approximate?: boolean
  other_dates?: { id: string; when: string; start: string }[]
  resolved_by: 'id' | 'title'
  warning?: string
  data_updated: string
}

export interface SearchResult {
  today: string
  range: { from: string; to: string | null; label: string }
  data_updated: string
  data_note?: string
  total: number
  events: EventSummary[]
  next_cursor?: string
  hint?: string
}

export type Outcome<T> = { ok: true; result: T; text: string } | { ok: false; error: string }

const FLAG_TEXT: Record<string, string> = {
  tukendi: 'sold out',
  dolu: 'full',
  yabanci: 'international artist',
  online: 'online',
  dogrulanmadi: 'date not confirmed',
  orman_yasagi: 'may be cancelled by a forest entry ban; check before going',
}

function hasTime(s: string): boolean {
  return s.length > 10
}

/** Ends before 06:00 on the next day (a Friday-night milonga 21:00-01:00): it belongs to its start day. */
function overnight(e: IndexEvent): boolean {
  return (
    !!e.end &&
    hasTime(e.start) &&
    hasTime(e.end) &&
    e.end.slice(0, 10) === addDays(e.start.slice(0, 10), 1) &&
    e.end.slice(11, 16) < '06:00'
  )
}

/** The last calendar day the event is on (an overnight event counts on its start day). */
function lastDay(e: IndexEvent): string {
  return overnight(e) ? e.start.slice(0, 10) : (e.end ?? e.start).slice(0, 10)
}

function singleDay(e: IndexEvent): boolean {
  return !e.end || e.end.slice(0, 10) === e.start.slice(0, 10) || overnight(e)
}

/** Over: past its timed end; else past its last day; a single event without an end time once it starts. */
function isOver(e: IndexEvent, now: IstanbulNow): boolean {
  if (e.end && hasTime(e.end)) return e.end <= now.stamp
  if ((e.end ?? e.start).slice(0, 10) < now.ymd) return true
  if (singleDay(e)) return hasTime(e.start) && e.start < now.stamp
  return false
}

/** Under way now: started and not over (only for events whose end time is known, or that run over several days). */
function inProgress(e: IndexEvent, now: IstanbulNow): boolean {
  if (isOver(e, now)) return false
  return hasTime(e.start) ? e.start <= now.stamp : e.start.slice(0, 10) < now.ymd
}

function registrationStatus(e: IndexEvent, now: IstanbulNow): RegistrationStatus | null {
  if (e.reg_closes && e.reg_closes < now.ymd) return 'closed'
  if (e.reg_opens && (hasTime(e.reg_opens) ? e.reg_opens > now.stamp : e.reg_opens > now.ymd)) return 'opening_soon'
  if (e.reg_opens || e.reg_closes || e.flags?.includes('basvuru')) return 'open'
  return null
}

function flagsOf(e: IndexEvent, now: IstanbulNow): string[] {
  const out: string[] = []
  const reg = registrationStatus(e, now)
  if (reg === 'opening_soon') out.push(`registration opens ${fmtStart(e.reg_opens!)}`)
  else if (reg === 'closed') out.push('registration closed')
  else if (reg === 'open') out.push('registration required')
  for (const f of e.flags ?? []) {
    const n = FLAG_TEXT[f]
    if (n) out.push(n)
    else if (f.startsWith('yer:')) out.push(`${count(Number(f.slice(4)), 'spot')} left`)
  }
  if (singleDay(e) && inProgress(e, now)) out.push(`in progress (started ${e.start.slice(11, 16)})`)
  if (e.new) out.push('new since yesterday')
  return out
}

/** 'Cumartesi, 15 Kasım 2026, 20:00', '… 20:00–22:00', '… 21:00–01:00 (next day)', or 'start – end' over several days. */
export function whenText(e: Pick<IndexEvent, 'start' | 'end'>): string {
  if (!e.end) return fmtStart(e.start)
  if (overnight(e as IndexEvent)) return `${fmtStart(e.start)}–${e.end.slice(11, 16)} (next day)`
  if (e.end.slice(0, 10) !== e.start.slice(0, 10)) return `${fmtStart(e.start)} – ${fmtStart(e.end)}`
  return hasTime(e.start) && hasTime(e.end) ? `${fmtStart(e.start)}–${e.end.slice(11, 16)}` : fmtStart(e.start)
}

function summary(p: Prepared, i: number, now: IstanbulNow, dates?: number): EventSummary {
  const e = p.events[i]!
  return {
    id: e.id,
    title: e.title,
    when: whenText(e),
    start: e.start,
    ...(e.end ? { end: e.end } : {}),
    venue: e.venue ?? null,
    district: e.district ?? null,
    side: p.side[i] ?? null,
    category: e.cat,
    category_label: CATEGORY_LABEL[e.cat],
    ...(e.workshop ? { workshop_type: e.workshop } : {}),
    ...(e.lang ? { language: e.lang } : {}),
    price: e.price ?? null,
    is_free: e.tl === undefined ? null : e.tl === 0,
    flags: flagsOf(e, now),
    ...(dates && dates > 1 ? { dates } : {}),
    url: SITE + eventPath(e),
  }
}

/** 'Zorlu PSM, Zincirlikuyu (avrupa)' */
function placeText(s: EventSummary): string {
  const where = !s.venue
    ? (s.district ?? 'place not stated')
    : s.district && !s.venue.toLocaleLowerCase('tr').includes(s.district.toLocaleLowerCase('tr'))
      ? `${s.venue}, ${s.district}`
      : s.venue
  return s.side ? `${where} (${s.side})` : where
}

function categoryText(s: EventSummary): string {
  return s.workshop_type ? `${s.category_label} · ${s.workshop_type}` : s.category_label
}

function summaryLine(s: EventSummary): string {
  return [
    `[${s.id}] ${s.title}`,
    s.when,
    placeText(s),
    categoryText(s),
    ...(s.language ? [s.language] : []),
    s.price ?? 'price not stated',
    ...s.flags,
    ...(s.dates ? [`${s.dates} dates`] : []),
    s.url,
  ].join(' | ')
}

/* ------------------------------------------------------------------ */
/* Time filters                                                        */
/* ------------------------------------------------------------------ */

function inRange(e: IndexEvent, r: DayRange, now: IstanbulNow): boolean {
  if (lastDay(e) < r.from || (r.to !== null && e.start.slice(0, 10) > r.to)) return false
  if (isOver(e, now)) return false
  const single = singleDay(e)
  if (r.evening) {
    // tonight / tomorrow_evening: single timed events from 17:00; exhibitions and all-day runs are not "evening" plans
    if (single && hasTime(e.start) && e.start.slice(0, 10) === r.from && e.start.slice(11, 16) < '17:00') return false
    if (!single && (e.sergi || (!hasTime(e.start) && !(e.end && hasTime(e.end))))) return false
  }
  // the weekend starts Friday 17:00
  if (r.fridayFrom1700) {
    const fri = r.from
    if (single && hasTime(e.start) && e.start.slice(0, 10) === fri && e.start.slice(11, 16) < '17:00') return false
    if (!single && e.end && hasTime(e.end) && lastDay(e) === fri && e.end.slice(11, 16) < '17:00') return false
  }
  return true
}

function soldOut(e: IndexEvent): boolean {
  return !!e.flags?.some((f) => f === 'tukendi' || f === 'dolu')
}

/* ------------------------------------------------------------------ */
/* search_events                                                       */
/* ------------------------------------------------------------------ */

export interface SearchArgs {
  query?: string
  when?: When
  date_from?: string
  date_to?: string
  categories?: CategoryKey[]
  side?: Side
  free_only?: boolean
  max_price_tl?: number
  language?: string
  registration?: 'opening_soon' | 'open'
  include_sold_out?: boolean
  sort?: 'best' | 'soonest'
  limit?: number
  cursor?: string
}

interface Cursor {
  o: number
  v: string
  r: string
  f: string
}

/** FNV-1a, 32 bit, base 36: a short, stable fingerprint of the filters. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeCursor(s: string): Cursor | null {
  try {
    const c = JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))) as Partial<Cursor>
    const ok =
      Number.isInteger(c.o) && (c.o as number) >= 0 && typeof c.v === 'string' && typeof c.r === 'string' && typeof c.f === 'string'
    return ok ? (c as Cursor) : null
  } catch {
    return null
  }
}

function filterKey(a: SearchArgs, words: string[][]): string {
  return JSON.stringify([
    a.when ?? '',
    a.date_from ?? '',
    a.date_to ?? '',
    words.map((w) => w[0]).join(' '),
    [...(a.categories ?? [])].sort().join(','),
    a.side ?? '',
    !!a.free_only,
    a.free_only ? null : (a.max_price_tl ?? null),
    (a.language ?? '').toUpperCase(),
    a.registration ?? '',
    !!a.include_sold_out,
    a.sort ?? 'best',
  ])
}

function resolveRange(a: SearchArgs, now: IstanbulNow): { range: DayRange; hint?: string } | { error: string } {
  if (a.when && (a.date_from || a.date_to)) return { error: MSG.whenAndDates() }
  if (a.when) return { range: whenRange(a.when, now) }
  if (a.date_to && a.date_to < now.ymd) return { error: MSG.pastDateTo(a.date_to, now.ymd) }
  if (a.date_from && a.date_to && a.date_to < a.date_from) return { error: MSG.dateOrder(a.date_from, a.date_to) }
  // a past date_from is moved to today (Seçki lists upcoming events only), and the hint says so
  const past = !!a.date_from && a.date_from < now.ymd
  const from = a.date_from && !past ? a.date_from : now.ymd
  return { range: { from, to: a.date_to ?? null }, ...(past ? { hint: MSG.pastDateFrom(a.date_from!, now.ymd) } : {}) }
}

/** "Salı, 18 Kasım 2026": the first day among `positions` that is today or later (a running event counts as today). */
function nextDate(p: Prepared, positions: number[], today: string): string | null {
  let best: string | null = null
  for (const i of positions) {
    const day = p.events[i]!.start.slice(0, 10)
    const d = day < today ? today : day
    if (best === null || d < best) best = d
  }
  return best ? dayLabel(best) : null
}

/** Sort key for sort="soonest": an event without a start time goes after the timed ones of its day. */
function startKey(e: IndexEvent): string {
  return hasTime(e.start) ? e.start : `${e.start}T24:00`
}

/** Key of a result as `total` counts it: a repeating show once. */
function seriesKey(p: Prepared, i: number): number {
  const g = p.events[i]!.group
  return g !== undefined ? g : -1 - i
}

type FilterName = 'query' | 'categories' | 'side' | 'price' | 'language' | 'registration'

const CHILD_WORDS = new Set(['cocuk', 'cocuklar', 'cocuklu', 'cocuklara', 'bebek', 'aile', 'kids', 'kid', 'children', 'child', 'family', 'toddler', 'baby'])
const NIGHT_WORDS = new Set(['dj', 'club', 'clubbing', 'party', 'rave', 'kulup'])
const PRICE_WORDS = new Set(['free', 'ucretsiz', 'bedava', 'cheap', 'ucuz'])
const LANGUAGE_WORDS = new Set(['english', 'ingilizce', 'turkish', 'turkce', 'language'])

export function searchEvents(p: Prepared, a: SearchArgs, nowMs: number): Outcome<SearchResult> {
  const now = istanbulNow(nowMs)
  const r = resolveRange(a, now)
  if ('error' in r) return { ok: false, error: r.error }
  const range = r.range

  const words = a.query !== undefined ? queryWords(a.query) : []
  if (a.query !== undefined && a.query.trim() !== '' && !words.length) return { ok: false, error: MSG.noWords(a.query) }

  const limit = Math.min(Math.max(a.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const fKey = fingerprint(filterKey(a, words))
  const rKey = `${range.from}|${range.to ?? ''}`
  const version = p.index.generated_at
  let offset = 0
  if (a.cursor !== undefined) {
    const c = decodeCursor(a.cursor)
    if (!c) return { ok: false, error: MSG.badCursor() }
    if (c.v !== version) return { ok: false, error: MSG.staleCursor() }
    if (c.f !== fKey) return { ok: false, error: MSG.otherSearchCursor() }
    if (c.r !== rKey) return { ok: false, error: MSG.dayChanged(now.ymd) }
    offset = c.o
  }

  // the active filters besides the date range; the hint relaxes them one at a time
  const cats = a.categories?.length ? new Set<CategoryKey>(a.categories) : null
  const freeOnly = !!a.free_only
  const maxPrice = freeOnly ? undefined : a.max_price_tl
  const lang = a.language?.toUpperCase()
  const checks: [FilterName, (e: IndexEvent, i: number) => boolean][] = []
  if (words.length) checks.push(['query', (e) => matchesAll(e.q, words)])
  if (cats) checks.push(['categories', (e) => cats.has(e.cat) || (cats.has('sanat') && !!e.sergi) || (cats.has('atolye') && e.cat === 'kurs')])
  if (a.side) checks.push(['side', (_e, i) => p.side[i] === a.side])
  if (freeOnly || maxPrice !== undefined) checks.push(['price', (e) => (freeOnly ? e.tl === 0 : e.tl !== undefined && e.tl <= maxPrice!)])
  if (lang) checks.push(['language', (e) => e.lang === lang])
  if (a.registration) checks.push(['registration', (e) => registrationStatus(e, now) === a.registration])

  // one pass: the hits, plus what each single filter left out (counted per show, like `total`)
  const hits: number[] = []
  const soldOutLeft = new Set<number>()
  const relaxed = new Map<FilterName, Set<number>>(checks.map(([name]) => [name, new Set<number>()]))
  const noSide = new Set<number>()
  const noPrice = new Set<number>()
  p.events.forEach((e, i) => {
    if (!inRange(e, range, now)) return
    const failed: FilterName[] = []
    for (const [name, test] of checks) {
      if (!test(e, i)) {
        failed.push(name)
        if (failed.length > 1) return
      }
    }
    const sold = soldOut(e) && !a.include_sold_out
    if (!failed.length) {
      if (sold) soldOutLeft.add(seriesKey(p, i))
      else hits.push(i)
      return
    }
    if (sold) return
    const only = failed[0]!
    relaxed.get(only)!.add(seriesKey(p, i))
    if (only === 'side' && p.side[i] === null) noSide.add(seriesKey(p, i))
    if (only === 'price' && e.tl === undefined) noPrice.add(seriesKey(p, i))
  })

  const byStart = (x: number, y: number) =>
    startKey(p.events[x]!).localeCompare(startKey(p.events[y]!)) || p.events[x]!.rank - p.events[y]!.rank
  const byRank = (x: number, y: number) => p.events[x]!.rank - p.events[y]!.rank
  hits.sort(a.sort === 'soonest' ? byStart : byRank)

  // a repeating show appears once (its first date in this order), with the number of its dates
  const groupCount = new Map<number, number>()
  for (const i of hits) {
    const g = p.events[i]!.group
    if (g !== undefined) groupCount.set(g, (groupCount.get(g) ?? 0) + 1)
  }
  const seen = new Set<number>()
  const collapsed: number[] = []
  for (const i of hits) {
    const g = p.events[i]!.group
    if (g !== undefined) {
      if (seen.has(g)) continue
      seen.add(g)
    }
    collapsed.push(i)
  }

  const total = collapsed.length
  if (offset > 0 && offset >= total) return { ok: false, error: MSG.cursorPastEnd(total) }

  // a page holds up to `limit` events, and fewer when long texts would push it past PAGE_BUDGET characters
  const events: EventSummary[] = []
  let used = 0
  for (const i of collapsed.slice(offset, offset + limit)) {
    const g = p.events[i]!.group
    const s = summary(p, i, now, g !== undefined ? groupCount.get(g) : undefined)
    used += JSON.stringify(s).length + summaryLine(s).length + 8
    if (events.length && used > PAGE_BUDGET) break
    events.push(s)
  }
  const end = offset + events.length
  const next = end < total ? encodeCursor({ o: end, v: version, r: rKey, f: fKey }) : undefined

  const hints: string[] = []
  let tryNext = ''
  if (r.hint) hints.push(r.hint)
  if (a.free_only && a.max_price_tl !== undefined) hints.push(MSG.freeWins())
  const plain = new Set(words.map((w) => w[0]!))
  if ([...plain].some((w) => CHILD_WORDS.has(w))) hints.push(MSG.scopeChildren())
  if ([...plain].some((w) => NIGHT_WORDS.has(w))) hints.push(MSG.scopeNight())
  if ([...plain].some((w) => PRICE_WORDS.has(w))) hints.push(MSG.priceWord())
  if ([...plain].some((w) => LANGUAGE_WORDS.has(w))) hints.push(MSG.languageWord())
  if (total === 0) {
    if (!checks.length) hints.push('No events in this range; try a wider "when" or later dates.')
    else {
      hints.push('No events match all filters.')
      const arg: Record<FilterName, string> = {
        query: 'query',
        categories: 'categories',
        side: 'side',
        price: freeOnly ? 'free_only' : 'max_price_tl',
        language: 'language',
        registration: 'registration',
      }
      const gains = checks.map(([name]) => [name, relaxed.get(name)!.size] as const).filter(([, n]) => n > 0)
      if (gains.length) hints.push(gains.map(([name, n]) => `Without "${arg[name]}": ${count(n, 'event')}.`).join(' '))
      else if (checks.length > 1) hints.push('Dropping any one filter still gives 0 events in this range.')
      if (!gains.length) tryNext = 'Try a wider "when" or other words.'
      else if (relaxed.get('query')?.size) tryNext = 'Try other or fewer words.'
    }
    if (words.length) {
      // each word alone, over all upcoming events: which word is the one that finds nothing
      const parts = words.map((alts) => {
        const alone: number[] = []
        const keys = new Set<number>()
        p.events.forEach((e, i) => {
          if (!isOver(e, now) && !soldOut(e) && matchesAll(e.q, [alts])) {
            alone.push(i)
            keys.add(seriesKey(p, i))
          }
        })
        return { word: alts[0]!, n: keys.size, next: nextDate(p, alone, now.ymd) }
      })
      if (parts.length === 1) {
        const { n, next: nd } = parts[0]!
        hints.push(`"${a.query!.trim()}" alone has ${count(n, 'upcoming event')}${nd ? ` (next: ${nd})` : ''}.`)
      } else {
        hints.push(`Each word alone, all upcoming: ${parts.map((x) => `"${x.word}" ${count(x.n, 'event')}`).join(', ')}.`)
      }
    }
    if (soldOutLeft.size) hints.push(`${count(soldOutLeft.size, 'sold-out or full event')} left out; include_sold_out: true shows them.`)
  }
  if (noSide.size) hints.push(`${count(noSide.size, 'event')} in this range have no known district or are outside Istanbul, so "side" left them out.`)
  if (noPrice.size) hints.push(`${count(noPrice.size, 'event')} in this range do not state a price, so the price filter left them out.`)
  if (tryNext) hints.push(tryNext)

  const result: SearchResult = {
    today: now.ymd,
    range: { from: range.from, to: range.to, label: rangeLabel(range) },
    data_updated: p.index.generated_at,
    ...(p.index.today < now.ymd ? { data_note: staleDataNote(p.index.generated_at) } : {}),
    total,
    events,
    ...(next ? { next_cursor: next } : {}),
    ...(hints.length ? { hint: hints.join(' ') } : {}),
  }

  const period = a.when ?? (range.to ? 'these dates' : 'upcoming days')
  const lines = [
    total
      ? `${count(total, 'event')} in Istanbul for ${period} (${result.range.label}). Showing ${offset + 1}-${end}, ${a.sort === 'soonest' ? 'soonest' : 'best'} first.`
      : `0 events in Istanbul for ${period} (${result.range.label}).`,
    ...events.map((s, k) => `${offset + k + 1}. ${summaryLine(s)}`),
  ]
  if (next) lines.push(`More: call search_events again with the same filters and cursor="${next}".`)
  if (result.hint) lines.push(`Hint: ${result.hint}`)
  if (result.data_note) lines.push(`Note: ${result.data_note}`)
  return { ok: true, result, text: lines.join('\n') }
}

/* ------------------------------------------------------------------ */
/* get_event                                                           */
/* ------------------------------------------------------------------ */

/** The slug of an id, slug, path or secki.istanbul/etkinlik link; null when the input is none of these. */
function slugOf(input: string): string | null {
  let s = input.trim()
  const link = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]*(?::\d+)?(\/etkinlik\/[^?#\s]*)/i.exec(s)
  if (/^https?:\/\//i.test(s) || s.includes('/')) {
    if (!link) return null
    s = link[1]!.slice('/etkinlik/'.length)
    try {
      s = decodeURIComponent(s)
    } catch {
      return null
    }
  }
  s = s.toLowerCase().replace(/\/+$/, '')
  // an id missing its leading "e"
  if (/^[0-9a-f]{11}$/.test(s)) return `e${s}`
  if (/^[a-z0-9-]+$/.test(s)) return s
  // a hand-edited or prettified slug with non-ASCII letters: the id at its end still decides
  const id = /(?:^|-)(e[0-9a-f]{11})$/.exec(s)
  return id ? id[1]! : null
}

/** Two or three title words from a slug, for a search_events suggestion. */
function titleWords(titleSlug: string): string | undefined {
  const w = titleSlug.split('-').filter((x) => x.length > 2 && !/^\d+$/.test(x))
  return w.length ? w.slice(0, 3).join(' ') : undefined
}

function statusOf(e: IndexEvent, now: IstanbulNow): EventStatus {
  if (e.end && hasTime(e.end) && e.end <= now.stamp) return 'ended'
  if (e.flags?.includes('tukendi')) return 'sold_out'
  if (e.flags?.includes('dolu')) return 'full'
  return inProgress(e, now) || (singleDay(e) && hasTime(e.start) && e.start <= now.stamp) ? 'in_progress' : 'scheduled'
}

function statusText(e: IndexEvent, status: EventStatus, generatedAt: string): string {
  const what =
    status === 'in_progress'
      ? singleDay(e)
        ? `in progress (started ${e.start.slice(11, 16)}${e.end && hasTime(e.end) ? `, ends ${e.end.slice(11, 16)}` : '; end time not stated'})`
        : `in progress (runs until ${fmtStart(e.end ?? e.start)})`
      : status.replace('_', ' ')
  return `Status: ${what}, as of the list of ${generatedAt.slice(0, 16).replace('T', ' ')}. Seçki does not track cancellations; confirm on the organiser's page.`
}

export function getEvent(p: Prepared, input: string, nowMs: number): Outcome<EventDetail> {
  const now = istanbulNow(nowMs)
  const slug = slugOf(input)
  const shown = input.length > 120 ? `${input.slice(0, 119)}…` : input
  if (!slug) {
    // something like a title: point at search_events with it
    const t = input.trim()
    const asQuery = !/^https?:\/\//i.test(t) && !t.includes('/') && /[\p{L}]{3}/u.test(t) ? t.slice(0, 60) : undefined
    return { ok: false, error: MSG.notAnId(shown, asQuery) }
  }
  const { id, titleSlug } = parseEventSlug(slug)
  // still listed: its last day (or timed end) is today or later; get_event also shows one that ended earlier today
  const upcoming = (i: number) => (p.events[i]!.end ?? p.events[i]!.start).slice(0, 10) >= now.ymd

  let at = id ? p.byId.get(id) : undefined
  let resolvedBy: 'id' | 'title' = 'id'
  if (at !== undefined && !upcoming(at)) at = undefined
  if (at === undefined && titleSlug) {
    // the id changed when the list was rebuilt: the next upcoming event with the same title (eventUrl.ts findEventForSlug)
    let best: number | undefined
    p.events.forEach((e, i) => {
      if (!upcoming(i) || isOver(e, now) || slugify(e.title, 60) !== titleSlug) return
      if (best === undefined || e.start < p.events[best]!.start) best = i
    })
    if (best !== undefined) {
      at = best
      resolvedBy = 'title'
    }
  }
  if (at === undefined) return { ok: false, error: MSG.notFound(shown, titleSlug ? titleWords(titleSlug) : undefined) }

  const e = p.events[at]!
  const siblings =
    e.group !== undefined ? (p.groups.get(e.group) ?? []).filter((i) => i !== at && !isOver(p.events[i]!, now)) : []
  const base = summary(p, at, now, siblings.length + 1)
  const regStatus = registrationStatus(e, now)
  const registration: EventDetail['registration'] =
    regStatus && (e.reg_opens || e.reg_closes)
      ? { status: regStatus, ...(e.reg_opens ? { opens: e.reg_opens } : {}), ...(e.reg_closes ? { last_day: e.reg_closes } : {}) }
      : undefined
  const others = siblings
    .slice(0, OTHER_DATES_MAX)
    .map((i) => ({ id: p.events[i]!.id, when: whenText(p.events[i]!), start: p.events[i]!.start }))
  const status = statusOf(e, now)
  const warning =
    resolvedBy === 'id' && titleSlug && slugify(e.title, 60) !== titleSlug
      ? `The title part of the link ("${titleSlug.slice(0, 60)}") does not match this event's title; the id decided. Check that this is the event you meant.`
      : undefined

  const result: EventDetail = {
    ...base,
    status,
    note: e.note,
    ...(e.doors ? { doors: e.doors } : {}),
    ...(registration ? { registration } : {}),
    ...(e.ticket_url ? { ticket_url: e.ticket_url } : {}),
    ...(e.info_url ? { info_url: e.info_url } : {}),
    ...(e.transit?.length ? { transit: e.transit.slice(0, 3) } : {}),
    ...(e.approx ? { location_approximate: true } : {}),
    ...(others.length ? { other_dates: others } : {}),
    resolved_by: resolvedBy,
    ...(warning ? { warning } : {}),
    data_updated: p.index.generated_at,
  }

  const regText = registration
    ? `${registration.status.replace('_', ' ')}${registration.opens ? `, opens ${registration.opens.replace('T', ' ')}` : ''}${registration.last_day ? `, last day ${registration.last_day}` : ''}`
    : null
  const lines = [
    [`[${result.id}] ${result.title}`, result.when, placeText(result), categoryText(result), result.price ?? 'price not stated'].join(' | '),
    ...(warning ? [`Warning: ${warning}`] : []),
    ...(resolvedBy === 'title' ? [`Resolved by title: the id in the link is old; the current id is ${result.id}.`] : []),
    statusText(e, status, p.index.generated_at),
    ...(result.note ? [`Note: ${result.note}`] : []),
    ...(result.flags.length ? [`Flags: ${result.flags.join(', ')}`] : []),
    ...(result.doors ? [`Doors: ${result.doors}`] : []),
    ...(result.language ? [`Language: ${result.language}`] : []),
    ...(regText ? [`Registration: ${regText}`] : []),
    ...(result.ticket_url ? [`Tickets: ${result.ticket_url}`] : []),
    ...(result.info_url ? [`Info: ${result.info_url}`] : []),
    ...(result.transit ? [`Transit: ${result.transit.join('; ')}`] : []),
    ...(result.location_approximate ? ['Location: approximate (district centre)'] : []),
    ...(others.length
      ? [`Other dates (${siblings.length}): ${others.map((o) => `${o.when} [${o.id}]`).join('; ')}${siblings.length > others.length ? '; …' : ''}`]
      : []),
    `Page: ${result.url}`,
  ]
  return { ok: true, result, text: lines.join('\n') }
}
