/**
 * Build-time index for the MCP server. Owner: backend (MCP).
 *
 * The demo prerender (vite.config.ts) calls buildMcpIndex on the day's events.json and writes the result to
 * /data/mcp-index.json. The /mcp Function reads only that file, so a cold isolate parses a slim file and
 * never folds text itself (the Workers Free plan allows 10 ms CPU per request).
 *
 * Privacy: every field is copied by name from an allowlist. profile, alerts, watch, hidden, flights,
 * campaigns, source, score, lat/lng, image, parking and series ids never reach the index. The score only
 * survives as `rank` (editorial order) and the series id as a small group number.
 *
 * Pure and free of Workers and Node APIs: it is type-checked by both functions/tsconfig.json and
 * tsconfig.node.json (through vite.config.ts), so relative imports keep their .ts extension.
 *
 *   buildMcpIndex({ meta, events }) -> { v: 1, today, generated_at, events: IndexEvent[] }
 */
import { priceTl } from '../../src/lib/price.ts'
import { fold } from '../../src/lib/text.ts'
import { CATEGORY_LABEL, publicCategory, WORKSHOP_LABEL, type CategoryKey } from './categories.ts'
import { ilceOf } from './districts.ts'

/** The events.json fields the indexer reads (web/src/types RawEvent), spelled out and all optional-safe. */
export interface SourceEvent {
  id: string
  title: string
  start: string
  end?: string | null
  venue?: string | null
  district?: string | null
  cat?: string | null
  url?: string | null
  price?: string | null
  score?: number | null
  why?: string | null
  flags?: string[] | null
  is_new?: boolean | null
  series?: { id: string; count?: number } | null
  kind?: string | null
  workshop?: string | null
  lang?: string | null
  doors?: string | null
  reg_opens?: string | null
  reg_closes?: string | null
  ticket_url?: string | null
  approx?: boolean | null
  transit?: {
    stops?: { name: string; lines?: string[] | null; kind?: string | null; m?: number | null; walk?: number | null }[] | null
    note?: string | null
  } | null
}

export interface SourceFile {
  meta: { today: string; generated_at?: string | null }
  events: SourceEvent[]
}

/** One upcoming event as the MCP server sees it. */
export interface IndexEvent {
  id: string
  title: string
  /** Istanbul wall clock: 'YYYY-MM-DDTHH:MM', or 'YYYY-MM-DD' when the time is unknown. */
  start: string
  end?: string
  venue?: string
  district?: string
  cat: CategoryKey
  /** kind === 'sergi' (an exhibition, also found under the sanat category). */
  sergi?: true
  /** As written ("Ücretsiz", "750 TL'den"); absent when the source states no price. */
  price?: string
  /** priceTl(price): 0 free, > 0 lira; absent when unknown. */
  tl?: number
  /** Allowlisted pipeline flags only (see KEPT_FLAGS); absent when none. */
  flags?: string[]
  new?: true
  /** Position in Seçki's editorial order (score, then start): 0 is the best. */
  rank: number
  /** Events of one repeating show share a group number. */
  group?: number
  /**
   * Folded search text: title, venue, district and its ilçe (Moda -> Kadıköy, districts.ts), category,
   * workshop type, "sergi", and the genre label that starts the editorial note ("Caz konseri").
   */
  q: string
  /** The pipeline's short Turkish note (why), cleaned, max 300 characters. */
  note: string
  doors?: string
  lang?: string
  workshop?: string
  reg_opens?: string
  reg_closes?: string
  ticket_url?: string
  info_url?: string
  transit?: string[]
  approx?: true
}

export interface McpIndex {
  v: 1
  /** The pipeline's meta.today when the index was built. */
  today: string
  /** meta.generated_at, ISO with +03:00. */
  generated_at: string
  events: IndexEvent[]
}

export const TITLE_MAX = 160
export const NOTE_MAX = 300

const KEPT_FLAGS = new Set(['basvuru', 'tukendi', 'dolu', 'yabanci', 'online', 'dogrulanmadi', 'orman_yasagi'])
const YMD = /^\d{4}-\d{2}-\d{2}$/
const STAMP = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/

/** Third-party text: no newlines or control characters, single spaces, cut to `max` characters. */
export function cleanText(s: string | null | undefined, max: number): string {
  const t = (s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' from a pipeline stamp; null when it is not one. */
export function normStamp(s: string | null | undefined): string | null {
  const m = STAMP.exec(s ?? '')
  if (!m) return null
  return m[2] ? `${m[1]}T${m[2]}` : m[1]!
}

/** An absolute http(s) URL in normalised form, or undefined. */
function webUrl(u: string | null | undefined): string | undefined {
  if (!u || !/^https?:\/\//i.test(u)) return undefined
  try {
    const url = new URL(u)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function keptFlags(flags: readonly string[] | null | undefined): string[] {
  return (flags ?? []).filter((f) => KEPT_FLAGS.has(f) || /^yer:\d{1,4}$/.test(f))
}

const STOP_KIND: Record<string, string> = { pier: 'ferry pier', bus: 'bus' }

/** What kind of line an Istanbul line code is: M2 metro, T1 tram, F1 funicular, TF1 cable car, B1 suburban rail. */
export function lineMode(code: string): string {
  if (/^TF\d/.test(code)) return 'cable car'
  if (/^M\d/.test(code)) return 'metro'
  if (/^T\d/.test(code)) return 'tram'
  if (/^F\d/.test(code)) return 'funicular'
  if (/^B\d/.test(code)) return 'suburban rail'
  if (code === 'Marmaray') return 'rail'
  return ''
}

/** 'Taksim (M2 metro, F1 funicular; 1 min walk)', 'Kadıköy İskelesi (ferry pier; 6 min walk)'; at most three stops. */
function transitLines(t: SourceEvent['transit']): string[] | undefined {
  const out = (t?.stops ?? []).slice(0, 3).map((s) => {
    const byMode = new Map<string, string[]>()
    for (const line of s.lines ?? []) {
      const mode = lineMode(line)
      const list = byMode.get(mode)
      if (list) list.push(line)
      else byMode.set(mode, [line])
    }
    const lines = [...byMode].map(([mode, codes]) => (mode ? `${codes.join('/')} ${mode}` : codes.join('/')))
    const kind = STOP_KIND[s.kind ?? '']
    // a pier always says so; a bus or rail stop only when it names no line
    const what = [...lines, ...(kind && (kind === 'ferry pier' || !lines.length) ? [kind] : [])].join(', ')
    const walk = typeof s.walk === 'number' ? `${s.walk} min walk` : ''
    const inner = [what, walk].filter(Boolean).join('; ')
    return cleanText(inner ? `${s.name} (${inner})` : s.name, 100)
  })
  return out.length ? out : undefined
}

/** The genre label that starts the pipeline's note ("Caz konseri, …" -> "Caz konseri"); '' when there is none. */
function genreLabel(why: string): string {
  const first = why.split(',')[0]!.trim()
  return first.length <= 40 ? first : ''
}

function lastDay(e: { start: string; end?: string }): string {
  return (e.end ?? e.start).slice(0, 10)
}

/** The slim, allowlisted index of the upcoming events (last day on or after meta.today). */
export function buildMcpIndex(src: SourceFile): McpIndex {
  const today = src.meta.today
  const generated = src.meta.generated_at || `${today}T00:00:00+03:00`
  const groups = new Map<string, number>()
  const rows: { e: IndexEvent; score: number }[] = []

  for (const raw of src.events) {
    const start = normStamp(raw.start)
    if (!raw.id || !start) continue
    let end = normStamp(raw.end) ?? undefined
    if (end && end <= start) end = undefined
    const title = cleanText(raw.title, TITLE_MAX) || 'Etkinlik'
    if (lastDay({ start, end }) < today) continue

    const cat = publicCategory(raw.cat)
    const venue = cleanText(raw.venue, TITLE_MAX)
    const district = cleanText(raw.district, 60)
    const price = cleanText(raw.price, 60)
    const tl = priceTl(raw.price)
    const workshop = raw.workshop ? WORKSHOP_LABEL[raw.workshop] : undefined
    const sergi = raw.kind === 'sergi'
    const flags = keptFlags(raw.flags)
    const regOpens = normStamp(raw.reg_opens) ?? undefined
    const regCloses = raw.reg_closes && YMD.test(raw.reg_closes.slice(0, 10)) ? raw.reg_closes.slice(0, 10) : undefined
    let group: number | undefined
    if (raw.series?.id) {
      group = groups.get(raw.series.id)
      if (group === undefined) groups.set(raw.series.id, (group = groups.size))
    }
    const ticket = webUrl(raw.ticket_url)
    const info = webUrl(raw.url)
    const transit = transitLines(raw.transit)
    const note = cleanText(raw.why, NOTE_MAX)

    const e: IndexEvent = {
      id: raw.id,
      title,
      start,
      ...(end ? { end } : {}),
      ...(venue ? { venue } : {}),
      ...(district ? { district } : {}),
      cat,
      ...(sergi ? { sergi: true as const } : {}),
      ...(price ? { price } : {}),
      ...(tl !== null ? { tl } : {}),
      ...(flags.length ? { flags } : {}),
      ...(raw.is_new === true ? { new: true as const } : {}),
      rank: 0,
      ...(group !== undefined ? { group } : {}),
      q: fold(
        [title, venue, district, ...ilceOf(district), CATEGORY_LABEL[cat], workshop, sergi ? 'Sergi' : '', genreLabel(note)]
          .filter(Boolean)
          .join(' '),
      ),
      note,
      ...(raw.doors && /^\d{2}:\d{2}$/.test(raw.doors) ? { doors: raw.doors } : {}),
      ...(raw.lang && /^[A-Z]{2}$/.test(raw.lang) ? { lang: raw.lang } : {}),
      ...(workshop ? { workshop } : {}),
      ...(regOpens ? { reg_opens: regOpens } : {}),
      ...(regCloses ? { reg_closes: regCloses } : {}),
      ...(ticket ? { ticket_url: ticket } : {}),
      ...(info ? { info_url: info } : {}),
      ...(transit ? { transit } : {}),
      ...(raw.approx === true ? { approx: true as const } : {}),
    }
    rows.push({ e, score: typeof raw.score === 'number' ? raw.score : 0 })
  }

  // editorial order: score (high first), then the earlier start, then id for a stable file
  const ranked = [...rows].sort((a, b) => b.score - a.score || a.e.start.localeCompare(b.e.start) || a.e.id.localeCompare(b.e.id))
  ranked.forEach((r, i) => (r.e.rank = i))
  const events = rows.map((r) => r.e).sort((a, b) => a.start.localeCompare(b.start) || a.rank - b.rank)
  return { v: 1, today, generated_at: generated, events }
}
