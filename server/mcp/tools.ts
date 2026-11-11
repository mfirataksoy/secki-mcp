/**
 * The two MCP tools: zod 4 input and output schemas, final description strings, thin handlers.
 * Owner: backend (MCP). The logic is in query.ts; this file only validates, calls and formats.
 *
 * Bump SERVER_VERSION (server.ts) whenever a schema or a description here changes.
 */
import type { McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import * as z from 'zod'
import { fold } from '../../src/lib/text.ts'
import { CATEGORY_KEYS, type CategoryKey } from './categories.ts'
import { DataUnavailable } from './data.ts'
import { MSG } from './messages.ts'
import { getEvent, MAX_LIMIT, searchEvents, type Outcome, type Prepared } from './query.ts'
import { isRealDate, WHEN_VALUES, type When } from './time.ts'

/** Loads the prepared index; throws DataUnavailable when the data file cannot be read. */
export type IndexLoader = () => Promise<Prepared>

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

/**
 * The SDK converts a tool's zod schema to JSON Schema on every tools/list and tools/call of every
 * per-request server instance. The schemas never change, so convert each one once per isolate.
 */
function cacheJsonSchema<S extends StandardSchemaWithJSON>(schema: S): S {
  const std = schema['~standard']
  const memo = new Map<string, Record<string, unknown>>()
  const convert =
    (io: 'input' | 'output') =>
    (opts: Parameters<typeof std.jsonSchema.input>[0]): Record<string, unknown> => {
      const key = `${io}:${opts.target}`
      let out = memo.get(key)
      if (!out) memo.set(key, (out = std.jsonSchema[io](opts)))
      return out
    }
  Object.defineProperty(schema, '~standard', {
    value: { ...std, jsonSchema: { input: convert('input'), output: convert('output') } },
    configurable: true,
  })
  return schema
}

/* ------------------------------------------------------------------ */
/* Error texts with a suggestion (the schemas stay strict and portable) */
/* ------------------------------------------------------------------ */

/** Levenshtein distance, for "did you mean" (short strings only). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]!
}

function nearest<T extends string>(word: string, options: readonly T[]): T | undefined {
  let best: T | undefined
  let bestD = 3
  for (const o of options) {
    const d = distance(word, o)
    if (d < bestD) [best, bestD] = [o, d]
  }
  return best
}

/** English and everyday names of the categories (folded). */
const CATEGORY_ALIAS: Record<string, CategoryKey> = {
  concert: 'konser', concerts: 'konser', music: 'konser', muzik: 'konser', gig: 'konser',
  theatre: 'tiyatro', theater: 'tiyatro', play: 'tiyatro', comedy: 'tiyatro', standup: 'tiyatro', opera: 'tiyatro',
  art: 'sanat', arts: 'sanat', exhibition: 'sanat', exhibitions: 'sanat', sergi: 'sanat', gallery: 'sanat',
  workshop: 'atolye', workshops: 'atolye', course: 'kurs', courses: 'kurs', class: 'kurs',
  talk: 'akademik', talks: 'akademik', lecture: 'akademik', seminar: 'akademik', soylesi: 'akademik', konferans: 'akademik',
  culture: 'kultur', tech: 'teknoloji', technology: 'teknoloji', nature: 'doga', hiking: 'doga', outdoor: 'doga',
  dance: 'dans', sport: 'spor', sports: 'spor', fair: 'fuar', fairs: 'fuar', social: 'sosyal', meetup: 'sosyal',
  nightlife: 'gece', night: 'gece', other: 'diger',
}

export function suggestCategory(input: unknown): CategoryKey | undefined {
  if (typeof input !== 'string') return undefined
  const w = fold(input).replace(/[^a-z0-9]/g, '')
  if ((CATEGORY_KEYS as readonly string[]).includes(w)) return w as CategoryKey
  return CATEGORY_ALIAS[w] ?? nearest(w, CATEGORY_KEYS)
}

/** Turkish and loose spellings of the `when` values (folded, spaces and dashes as "_"). */
const WHEN_ALIAS: Record<string, When> = {
  weekend: 'this_weekend', bu_hafta_sonu: 'this_weekend', hafta_sonu: 'this_weekend', haftasonu: 'this_weekend',
  gelecek_hafta_sonu: 'next_weekend', bugun: 'today', bu_aksam: 'tonight', this_evening: 'tonight', aksam: 'tonight',
  yarin: 'tomorrow', yarin_aksam: 'tomorrow_evening', tomorrow_night: 'tomorrow_evening', bu_hafta: 'this_week',
  gelecek_hafta: 'next_week', bu_ay: 'this_month', week: 'this_week', month: 'this_month',
}

export function suggestWhen(input: unknown): When | undefined {
  if (typeof input !== 'string') return undefined
  const w = fold(input).trim().replace(/[\s-]+/g, '_')
  if ((WHEN_VALUES as readonly string[]).includes(w)) return w as When
  return WHEN_ALIAS[w] ?? nearest(w, WHEN_VALUES)
}

/** invalid_type of a number or boolean field: say how to send it ("1000" -> 1000). */
function typeError(field: string, kind: 'number' | 'boolean', example: string) {
  return (iss: { code?: string; input?: unknown }): string | undefined => {
    if (iss.code !== 'invalid_type') return undefined
    const raw = iss.input
    if (typeof raw === 'string') {
      const t = raw.trim()
      if (kind === 'number' && t !== '' && Number.isFinite(Number(t))) return `${field} must be a JSON number: send ${Number(t)}, not "${raw}".`
      if (kind === 'boolean' && (t === 'true' || t === 'false')) return `${field} must be a JSON boolean: send ${t}, not "${raw}".`
    }
    return `${field} must be a ${kind}, e.g. ${example}.`
  }
}

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

const SIDES = ['avrupa', 'anadolu'] as const

export const EventSummary = z.object({
  id: z.string().describe('Event id, "e" + 11 hex characters. Pass it (or url) to get_event.'),
  title: z.string().describe('Title as published (mostly Turkish), max 160 characters.'),
  when: z.string().describe('Turkish date and time, e.g. "Cumartesi, 15 Kasım 2026, 20:00"; "start – end" for multi-day events.'),
  start: z.string().describe('Istanbul wall clock, "YYYY-MM-DDTHH:MM", or "YYYY-MM-DD" when the time is unknown.'),
  end: z.string().optional().describe('Same format as start. A date-only end is the inclusive last day.'),
  venue: z.string().nullable().describe('Venue name; null when the source names none.'),
  district: z.string().nullable().describe('Neighbourhood or district as written (e.g. Galata, Moda, Kadıköy), not always the ilçe; null when unknown.'),
  side: z.enum(SIDES).nullable().describe('avrupa = European side, anadolu = Asian side; null = unknown or outside Istanbul.'),
  category: z.enum(CATEGORY_KEYS),
  category_label: z.string(),
  workshop_type: z.string().optional().describe('Workshop type (Turkish), e.g. "Seramik ve heykel".'),
  language: z.string().optional().describe('Language code when known, e.g. "EN", "TR" (known for few events; most are in Turkish).'),
  price: z.string().nullable().describe('Price as written, e.g. "Ücretsiz" or "750 TL\'den"; null = not stated.'),
  is_free: z.boolean().nullable().describe('true = free, false = paid, null = price not stated.'),
  flags: z
    .array(z.string())
    .describe('Short flags such as "registration required", "registration opens …", "sold out", "3 spots left", "in progress (started 19:00)", "new since yesterday".'),
  dates: z.number().int().optional().describe('A repeating show: how many of its dates are in the searched range (get_event: all its upcoming dates).'),
  url: z.url().describe('The event page on secki.istanbul.'),
})

/* ------------------------------------------------------------------ */
/* search_events                                                       */
/* ------------------------------------------------------------------ */

export const SEARCH_DESCRIPTION = [
  'Find upcoming events in Istanbul from Seçki İstanbul, a curated listing that is refreshed daily. It covers concerts, theatre, exhibitions, talks, workshops, dance, sports, nature trips and fairs. Not listed, by design: children\'s and family events, DJ sets and club nights, ceremonies. Use it for questions like "what\'s on in Istanbul tonight", "jazz this weekend in Kadıköy", "free exhibitions next week", "bu hafta sonu ne var", "Kadıköy\'de caz konseri".',
  'All filters are optional and combine with AND. With no filters it returns the top upcoming events from today in Seçki\'s editorial ranking.',
  'For dates, prefer `when`. It is computed in Istanbul time, so you do not need to know today\'s date: today (bugün), tonight (bu akşam), tomorrow (yarın), tomorrow_evening (yarın akşam), this_weekend (bu hafta sonu), next_weekend (gelecek hafta sonu), this_week (bu hafta), next_week (gelecek hafta), next_7_days, this_month (bu ay), next_30_days. tonight and tomorrow_evening mean from 17:00 and leave out exhibitions; after midnight, tonight means the coming evening. Use date_from/date_to only for specific calendar dates. Single events that have already started are left out, unless their end time is listed and not reached yet (flagged "in progress").',
  '`query` matches the start of words in the title, venue, neighbourhood, district and category, and the genre label of Seçki\'s note. It ignores case and Turkish accents ("kadikoy" finds "Kadıköy"; an ilçe also finds its neighbourhoods, so "Kadıköy" finds Moda). Every word must match, so send one or two distinctive words such as "caz", "seramik", "Zorlu" or "Moda". Common English words such as jazz, exhibition, workshop and ceramics match their Turkish forms and back. Price, language and registration are filters, not query words.',
  'Most events do not state a price and some have no district, so `free_only`, `max_price_tl` and `side` leave those out; the `hint` field says how many. `language` ("en", "tr") only finds events whose language is known (few; most events are in Turkish). registration="opening_soon" finds events whose sign-up has not opened yet; their flags give the opening time.',
  'Results are in Seçki\'s editorial ranking (sort="best", the default) or soonest first (sort="soonest"). A show that repeats appears once, with `dates` = its number of dates. Sold-out and full events are left out unless include_sold_out is true. It returns up to `limit` events (default 10, max 20; a page with very long titles can hold fewer) plus `next_cursor` when there are more. When nothing matches, `hint` says which single filter to drop. Use get_event with an id for one event\'s details, status, all its dates and the ticket link.',
].join('\n')

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'Use YYYY-MM-DD, e.g. "2026-11-14" (Istanbul calendar date).' })
  .refine(isRealDate, { error: (iss) => `${String(iss.input)} is not a real calendar date.` })

export const SearchInput = cacheJsonSchema(
  z.strictObject({
    query: z
      .string()
      .max(120, { error: 'Keep query under 120 characters; use one or two distinctive words.' })
      .optional()
      .describe('Words that must all appear (word starts, accent-insensitive) in title, venue, neighbourhood, district (an ilçe also finds its neighbourhoods) or category. E.g. "caz", "Kadıköy stand-up", "seramik".'),
    when: z
      .enum(WHEN_VALUES, {
        error: (iss) => {
          const s = suggestWhen(iss.input)
          return `${s ? `${JSON.stringify(iss.input)} is not a "when" value; did you mean "${s}"? ` : ''}when must be one of: ${WHEN_VALUES.join(', ')}.`
        },
      })
      .optional()
      .describe('Relative period in Istanbul time. tonight = today from 17:00, tomorrow_evening = tomorrow from 17:00 (both without exhibitions). this_weekend = Friday 17:00 to Sunday (the current weekend on Fri-Sun). this_week = today to Sunday. Do not combine with date_from/date_to.'),
    date_from: ymd.optional().describe('First day (inclusive), YYYY-MM-DD, Istanbul date. Default and minimum: today.'),
    date_to: ymd.optional().describe('Last day (inclusive), YYYY-MM-DD.'),
    categories: z
      .array(
        z.enum(CATEGORY_KEYS, {
          error: (iss) => {
            const s = suggestCategory(iss.input)
            return `${s ? `${JSON.stringify(iss.input)} is not a category; use "${s}". ` : ''}categories must be from: ${CATEGORY_KEYS.join(', ')}.`
          },
        }),
      )
      .min(1)
      .max(16)
      .optional()
      .describe('Any of these categories. konser=music, tiyatro=theatre, sanat=art and exhibitions, akademik=talks, kultur=culture, teknoloji=tech, doga=nature trips, atolye=workshops (includes courses), kurs=courses, dans=dance, spor=sports, fuar=fairs, sosyal=social meetups, yoga, gece=nightlife, diger=other.'),
    side: z
      .enum(SIDES, { error: 'side must be "avrupa" (European side) or "anadolu" (Asian side).' })
      .optional()
      .describe('City side: avrupa = European side (Beşiktaş, Beyoğlu, Şişli…), anadolu = Asian side (Kadıköy, Üsküdar, Moda…). Events with unknown location are excluded when set.'),
    free_only: z
      .boolean({ error: typeError('free_only', 'boolean', 'true') })
      .optional()
      .describe('Only events whose price says free (Ücretsiz).'),
    max_price_tl: z
      .number({ error: typeError('max_price_tl', 'number', '1000') })
      .min(0, { error: 'max_price_tl cannot be negative.' })
      .max(1_000_000)
      .optional()
      .describe('Only events with a known price at or below this many Turkish lira. Events with no stated price are excluded when set.'),
    language: z
      .string()
      .regex(/^[A-Za-z]{2}$/, { error: 'language is a two-letter code, e.g. "en" or "tr".' })
      .optional()
      .describe('Only events whose language is known to be this, e.g. "en" for events in English. Known for few events; most events are in Turkish.'),
    registration: z
      .enum(['opening_soon', 'open'], { error: 'registration must be "opening_soon" or "open".' })
      .optional()
      .describe('opening_soon = sign-up has not opened yet (the flags say when it opens); open = needs sign-up and it is open now.'),
    include_sold_out: z
      .boolean({ error: typeError('include_sold_out', 'boolean', 'true') })
      .optional()
      .describe('Also return sold-out and full events. Default false.'),
    sort: z.enum(['best', 'soonest']).optional().describe('best (default) = Seçki\'s editorial ranking; soonest = by start time.'),
    limit: z
      .number({ error: typeError('limit', 'number', '10') })
      .int()
      .min(1, { error: `limit must be 1-${MAX_LIMIT}.` })
      .max(MAX_LIMIT, { error: `limit must be 1-${MAX_LIMIT}.` })
      .optional()
      .describe(`Events per page, 1-${MAX_LIMIT}. Default 10.`),
    cursor: z.string().max(200).optional().describe('next_cursor from the previous call with the same filters, to get the next page.'),
  }),
)

export const SearchOutput = cacheJsonSchema(
  z.object({
    today: z.string().describe('Today in Istanbul, YYYY-MM-DD.'),
    range: z.object({ from: z.string(), to: z.string().nullable(), label: z.string() }).describe('The days searched (Istanbul dates).'),
    data_updated: z.string().describe('When the event list was last rebuilt (ISO, +03:00).'),
    data_note: z.string().optional().describe('Set when today\'s refresh has not run yet.'),
    total: z.number().int().describe('Matching events, a repeating show counted once.'),
    events: z.array(EventSummary),
    next_cursor: z.string().optional(),
    hint: z.string().optional().describe('Why nothing matched, or what the filters left out.'),
  }),
)

/* ------------------------------------------------------------------ */
/* get_event                                                           */
/* ------------------------------------------------------------------ */

export const GET_DESCRIPTION =
  'Full details of one Istanbul event from Seçki İstanbul: status (scheduled, in progress, ended, sold out, full), exact start and end, venue and city side, price, a short Turkish note from Seçki\'s editors (why it is listed; not a full description), language, registration window, up to 3 nearest public transport stops with walking time (if no metro is listed, none is that close), all other dates of a repeating show, the ticket page when tickets are sold online, and the organiser\'s page. Pass an id from search_events (e.g. "e0123456789a") or a secki.istanbul event link (e.g. "https://secki.istanbul/etkinlik/ornek-konser-e0123456789a"). Ids can change when the daily list is rebuilt; with a link, the event is still found by its title. Seçki does not track cancellations: confirm on the organiser\'s page.'

export const GetInput = cacheJsonSchema(
  z.strictObject({
    id: z
      .string()
      .min(1, { error: 'id is empty. Send an event id from search_events, e.g. "e0123456789a".' })
      .max(300)
      .describe('Event id from search_events ("e" + 11 hex chars, e.g. "e0123456789a"), or a secki.istanbul/etkinlik/… link or slug.'),
  }),
)

export const GetOutput = cacheJsonSchema(
  EventSummary.extend({
    status: z
      .enum(['scheduled', 'in_progress', 'ended', 'sold_out', 'full'])
      .describe('As of data_updated. "ended": its end time has passed today. Seçki does not track cancellations; confirm on info_url.'),
    note: z.string().describe('Seçki\'s short Turkish editorial note (category, topic, dates), max 300 characters. Not a description of the event.'),
    doors: z.string().optional().describe('Doors open, HH:MM.'),
    registration: z
      .object({
        status: z.enum(['opening_soon', 'open', 'closed']),
        opens: z.string().optional().describe('Istanbul wall clock.'),
        last_day: z.string().optional().describe('YYYY-MM-DD, inclusive.'),
      })
      .optional(),
    ticket_url: z.url().optional().describe('Ticket page, only when tickets are sold online.'),
    info_url: z.url().optional().describe('The organiser\'s own page for this event.'),
    transit: z
      .array(z.string())
      .max(3)
      .optional()
      .describe('Up to 3 nearest stops within about 15 minutes\' walk, with line and mode, e.g. "Taksim (M2 metro, F1 funicular; 1 min walk)". No metro listed = none that close.'),
    location_approximate: z.boolean().optional().describe('true when the place is only known to the district.'),
    other_dates: z
      .array(z.object({ id: z.string(), when: z.string(), start: z.string() }))
      .max(12)
      .optional()
      .describe('Other upcoming dates of this show (max 12).'),
    resolved_by: z.enum(['id', 'title']).describe('"title": the id in the link was old; this is the current event with that title.'),
    warning: z.string().optional().describe('Set when the title part of a link does not match the event its id found.'),
    data_updated: z.string(),
  }),
)

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

type ToolResult =
  | { content: { type: 'text'; text: string }[]; structuredContent: Record<string, unknown> }
  | { content: { type: 'text'; text: string }[]; isError: true }

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/** Runs a tool body; data problems become E11 and anything else a generic error (no internals, no logging). */
async function run<T extends object>(body: () => Promise<Outcome<T>>): Promise<ToolResult> {
  try {
    const out = await body()
    if (!out.ok) return fail(out.error)
    return { content: [{ type: 'text', text: out.text }], structuredContent: { ...out.result } as Record<string, unknown> }
  } catch (err) {
    return fail(err instanceof DataUnavailable ? MSG.dataDown(err.message) : MSG.internal())
  }
}

export function registerTools(server: McpServer, load: IndexLoader, now: () => number): void {
  server.registerTool(
    'search_events',
    {
      title: 'Search Istanbul events',
      description: SEARCH_DESCRIPTION,
      inputSchema: SearchInput,
      outputSchema: SearchOutput,
      annotations: READ_ONLY,
    },
    (args) => run(async () => searchEvents(await load(), args, now())),
  )
  server.registerTool(
    'get_event',
    {
      title: 'Get Istanbul event details',
      description: GET_DESCRIPTION,
      inputSchema: GetInput,
      outputSchema: GetOutput,
      annotations: READ_ONLY,
    },
    ({ id }) => run(async () => getEvent(await load(), id, now())),
  )
}
