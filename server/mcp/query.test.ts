import { describe, expect, it } from 'vitest'
import { CAT_LABEL } from '../events.ts'
import { CATEGORY_LABEL, CATEGORY_KEYS, publicCategory, WORKSHOP_LABEL } from './categories.ts'
import { EVENTS, FIXTURE } from './fixtures/events.ts'
import { buildMcpIndex, NOTE_MAX, TITLE_MAX, type McpIndex, type SourceEvent, type SourceFile } from './indexer.ts'
import { ilceOf } from './districts.ts'
import { llmsTxt } from './llms.ts'
import { matchesAll, queryWords, REVERSE, SYNONYMS } from './match.ts'
import { MSG } from './messages.ts'
import { getEvent, prepare, searchEvents, type Outcome, type SearchArgs } from './query.ts'
import { addDays, istanbulNow, isRealDate, whenRange, type When } from './time.ts'
import { GetOutput, SearchOutput } from './tools.ts'
import { fold } from '../../src/lib/text.ts'

/** Istanbul wall clock 'YYYY-MM-DDTHH:MM' -> epoch milliseconds (UTC+3, no DST). */
const ist = (stamp: string) => Date.parse(`${stamp}:00+03:00`)
const WED = ist('2026-11-11T12:00')
const INDEX = buildMcpIndex(FIXTURE)
const P = prepare(INDEX)

function ok<T>(o: Outcome<T>): T & { text: string } {
  if (!o.ok) throw new Error(`expected a result, got error: ${o.error}`)
  return { ...o.result, text: o.text }
}
function err<T>(o: Outcome<T>): string {
  if (o.ok) throw new Error('expected an error')
  return o.error
}
const search = (a: SearchArgs, now = WED) => ok(searchEvents(P, a, now))
const ids = (a: SearchArgs, now = WED) => search({ limit: 20, ...a }, now).events.map((e) => e.id)

describe('time', () => {
  it('reads the Istanbul clock with UTC+3, also across UTC midnight', () => {
    expect(istanbulNow(Date.UTC(2026, 10, 10, 21, 30))).toEqual({ ymd: '2026-11-11', dow: 3, hhmm: '00:30', stamp: '2026-11-11T00:30' })
    expect(istanbulNow(Date.UTC(2026, 10, 10, 20, 59)).ymd).toBe('2026-11-10')
  })

  it('checks real calendar dates', () => {
    expect(isRealDate('2026-02-30')).toBe(false)
    expect(isRealDate('2028-02-29')).toBe(true)
    expect(isRealDate('2026-13-01')).toBe(false)
  })

  const range = (when: When, stamp: string) => whenRange(when, istanbulNow(ist(stamp)))

  it('maps every `when` on a Wednesday', () => {
    const at = '2026-11-11T12:00'
    expect(range('today', at)).toEqual({ from: '2026-11-11', to: '2026-11-11' })
    expect(range('tonight', at)).toEqual({ from: '2026-11-11', to: '2026-11-11', evening: true })
    expect(range('tomorrow', at)).toEqual({ from: '2026-11-12', to: '2026-11-12' })
    expect(range('this_weekend', at)).toEqual({ from: '2026-11-13', to: '2026-11-15', fridayFrom1700: true })
    expect(range('next_weekend', at)).toEqual({ from: '2026-11-20', to: '2026-11-22', fridayFrom1700: true })
    expect(range('this_week', at)).toEqual({ from: '2026-11-11', to: '2026-11-15' })
    expect(range('next_week', at)).toEqual({ from: '2026-11-16', to: '2026-11-22' })
    expect(range('next_7_days', at)).toEqual({ from: '2026-11-11', to: '2026-11-17' })
    expect(range('this_month', at)).toEqual({ from: '2026-11-11', to: '2026-11-30' })
    expect(range('next_30_days', at)).toEqual({ from: '2026-11-11', to: '2026-12-10' })
  })

  it('keeps the current weekend from Friday to Sunday', () => {
    expect(range('this_weekend', '2026-11-13T10:00')).toEqual({ from: '2026-11-13', to: '2026-11-15', fridayFrom1700: true })
    expect(range('this_weekend', '2026-11-13T18:00')).toEqual({ from: '2026-11-13', to: '2026-11-15', fridayFrom1700: true })
    expect(range('this_weekend', '2026-11-14T09:00')).toEqual({ from: '2026-11-14', to: '2026-11-15', fridayFrom1700: false })
    expect(range('this_weekend', '2026-11-15T23:30')).toEqual({ from: '2026-11-15', to: '2026-11-15', fridayFrom1700: false })
    expect(range('next_weekend', '2026-11-15T23:30')).toEqual({ from: '2026-11-20', to: '2026-11-22', fridayFrom1700: true })
    expect(range('this_week', '2026-11-15T23:30')).toEqual({ from: '2026-11-15', to: '2026-11-15' })
    expect(range('next_week', '2026-11-15T23:30')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
  })

  it('crosses month and year ends', () => {
    expect(range('this_month', '2026-10-31T12:00')).toEqual({ from: '2026-10-31', to: '2026-10-31' })
    expect(range('tomorrow', '2026-12-31T12:00')).toEqual({ from: '2027-01-01', to: '2027-01-01' })
    expect(range('this_week', '2026-12-31T12:00')).toEqual({ from: '2026-12-31', to: '2027-01-03' })
    expect(range('next_7_days', '2026-12-31T12:00')).toEqual({ from: '2026-12-31', to: '2027-01-06' })
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})

describe('match', () => {
  it('folds Turkish letters and case', () => {
    expect(ids({ query: 'kadikoy' })).toEqual(expect.arrayContaining(['e00000000a02', 'e00000000a07', 'e00000000a14']))
    expect(ids({ query: 'ISIK' })).toEqual(['e00000000a11'])
    expect(ids({ query: 'istanbul' })).toEqual(['e00000000a03'])
    expect(ids({ query: 'Işık' })).toEqual(['e00000000a11'])
  })

  it('matches word starts, not substrings', () => {
    expect(matchesAll(fold('Senfoni Konserleri'), queryWords('konser'))).toBe(true)
    expect(matchesAll(fold('Gülmek İlacaz'), queryWords('caz'))).toBe(false)
    expect(ids({ query: 'caz' }).sort()).toEqual(['e00000000a02', 'e00000000a20', 'e00000000a21'])
  })

  it('matches English words to Turkish ones, with every word required', () => {
    expect(ids({ query: 'jazz' }).sort()).toEqual(['e00000000a02', 'e00000000a20', 'e00000000a21'])
    expect(ids({ query: 'jazz kadikoy' })).toEqual(['e00000000a02'])
    expect(ids({ query: 'jazz besiktas' })).toEqual([])
    expect(ids({ query: 'ceramics' })).toEqual(['e00000000a07'])
    expect(ids({ query: 'exhibition' })).toEqual(['e00000000a03'])
    for (const [en, tr] of Object.entries(SYNONYMS)) {
      const alts = queryWords(en)[0]!
      expect(alts[0]).toBe(en)
      expect(alts).toEqual(expect.arrayContaining([...tr]))
    }
  })

  it('matches Turkish words back to the English ones ("caz" finds "Jazz")', () => {
    expect(REVERSE.caz).toEqual(['jazz'])
    expect(REVERSE.konser).toEqual(['concert'])
    expect(queryWords('caz')[0]).toEqual(['caz', 'jazz'])
    expect(ids({ query: 'caz' })).toContain('e00000000a20')
  })

  it('searches only the genre label of the editorial note, never the rest', () => {
    expect(ids({ query: 'tarih' })).toEqual([])
    expect(ids({ query: 'konseri' })).toEqual(['e00000000a21'])
    expect(ids({ query: 'tasavvuf' })).toEqual(['e00000000a04'])
  })

  it('finds a neighbourhood by its ilçe (Kadıköy finds Moda)', () => {
    expect(ilceOf('Moda')).toEqual(['Kadıköy'])
    expect(ilceOf('Zincirlikuyu')).toEqual(['Beşiktaş', 'Şişli'])
    expect(ilceOf('Kadıköy')).toEqual([])
    expect(ilceOf('Kadıköy, Moda')).toEqual(['Kadıköy'])
    expect(ids({ query: 'Kadıköy' })).toContain('e00000000a06')
    expect(ids({ query: 'beyoglu' })).toEqual(expect.arrayContaining(['e00000000a20', 'e00000000a21']))
  })
})

describe('search_events filters', () => {
  it('reads the side from geo.ts: Bolu and unknown districts never match a side', () => {
    const asia = ids({ side: 'anadolu' })
    expect(asia).toEqual(expect.arrayContaining(['e00000000a02', 'e00000000a04', 'e00000000a06']))
    expect(asia).not.toContain('e00000000a10')
    expect(asia).not.toContain('e00000000a05')
    expect(ids({ side: 'avrupa' })).not.toContain('e00000000a10')
    expect(search({ side: 'avrupa' }).hint).toMatch(/no known district or are outside Istanbul/)
    // a neighbourhood geo.ts does not list takes the side of its ilçe
    expect(ids({ side: 'avrupa' })).toContain('e00000000a22')
  })

  it('filters by known language and by registration state', () => {
    expect(ids({ language: 'en' })).toEqual(['e00000000a11'])
    expect(ids({ language: 'TR' })).toEqual(['e00000000b01'])
    const soon = search({ registration: 'opening_soon' })
    expect(soon.events.map((e) => e.id)).toEqual(['e00000000a07'])
    expect(soon.events[0]!.flags).toContain('registration opens Perşembe, 12 Kasım 2026, 10:00')
    expect(soon.text).toContain('| Atölye · Seramik ve heykel |')
    expect(ids({ registration: 'open' })).toEqual([])
    expect(ids({ registration: 'open' }, ist('2026-11-12T10:00'))).toEqual(['e00000000a07'])
  })

  it('handles free_only and max_price_tl with unknown prices', () => {
    expect(ids({ free_only: true }).sort()).toEqual(['e00000000a02', 'e00000000a04', 'e00000000a12', 'e00000000a13'])
    const cheap = ids({ max_price_tl: 800 })
    // free events cost 0 TL, so they are under any limit; unknown prices are not
    expect(cheap.sort()).toEqual(['e00000000a02', 'e00000000a04', 'e00000000a12', 'e00000000a13', 'e00000000a14', 'e00000000a15', 'e00000000b01'])
    expect(search({ max_price_tl: 800 }).hint).toMatch(/do not state a price/)
    const both = search({ free_only: true, max_price_tl: 800 })
    expect(both.hint).toContain(MSG.freeWins())
    expect(both.events.every((e) => e.is_free)).toBe(true)
  })

  it('maps categories: din -> kultur, tech -> teknoloji, kurs inside atolye, sergi inside sanat', () => {
    const culture = search({ categories: ['kultur'], limit: 20 }).events
    const tas = culture.find((e) => e.id === 'e00000000a04')
    expect(tas).toMatchObject({ category: 'kultur', category_label: 'Kültür' })
    expect(ids({ categories: ['atolye'] }).sort()).toEqual(['e00000000a06', 'e00000000a07'])
    expect(ids({ categories: ['kurs'] })).toEqual(['e00000000a06'])
    expect(ids({ categories: ['teknoloji'] })).toEqual(['e00000000a05'])
    expect(ids({ categories: ['sanat'] })).toEqual(['e00000000a03'])
    expect(ids({ categories: ['diger'] }).sort()).toEqual(['e00000000a16', 'e00000000a17'])
  })

  it('leaves sold-out and full events out unless asked', () => {
    expect(ids({})).not.toContain('e00000000a08')
    expect(ids({})).not.toContain('e00000000a09')
    expect(ids({ include_sold_out: true })).toEqual(expect.arrayContaining(['e00000000a08', 'e00000000a09']))
    const none = search({ query: 'duman' })
    expect(none.total).toBe(0)
    expect(none.hint).toMatch(/1 sold-out or full event left out/)
  })

  it('collapses a series to one result with its number of dates in range', () => {
    expect(search({ query: 'hamlet' }).events).toEqual([expect.objectContaining({ id: 'e00000000b01', dates: 3 })])
    const week = search({ query: 'hamlet', when: 'this_week' }).events
    expect(week).toHaveLength(1)
    expect(week[0]!.dates).toBeUndefined()
  })

  it('ranks by the editorial order or by start', () => {
    const best = search({ limit: 3 }).events.map((e) => e.id)
    expect(best[0]).toBe('e83d55d4cfe7')
    const soon = search({ sort: 'soonest', limit: 3 }).events.map((e) => (e.start.length > 10 ? e.start : `${e.start}T24:00`))
    expect([...soon].sort()).toEqual(soon)
    // an event without a start time goes after the timed events of its day
    const thu = ids({ sort: 'soonest', date_from: '2026-11-12', date_to: '2026-11-12', include_sold_out: true })
    expect(thu.indexOf('e00000000a02')).toBeGreaterThan(thu.indexOf('e00000000b01'))
  })
})

describe('search_events dates', () => {
  it('starts the weekend on Friday 17:00', () => {
    const fri = ids({ when: 'this_weekend' }, ist('2026-11-13T10:00'))
    expect(fri).not.toContain('e00000000a13')
    expect(fri).toEqual(expect.arrayContaining(['e00000000a14', 'e00000000a04', 'e83d55d4cfe7', 'e00000000a03']))
  })

  it('tonight keeps evening events, leaves exhibitions out and drops what has started', () => {
    const at18 = ids({ when: 'tonight' }, ist('2026-11-13T18:00'))
    expect(at18.sort()).toEqual(['e00000000a04', 'e00000000a14', 'e00000000a22'])
    const at1930 = ids({ when: 'today' }, ist('2026-11-13T19:30'))
    expect(at1930).not.toContain('e00000000a14')
    expect(at1930).toContain('e00000000a04')
    expect(at1930).toContain('e00000000a03')
    expect(ids({ when: 'tomorrow_evening' }, ist('2026-11-12T12:00')).sort()).toEqual(['e00000000a04', 'e00000000a14', 'e00000000a22'])
  })

  it('keeps a single event with an end time until it ends, flagged in progress', () => {
    const at15 = search({ when: 'today' }, ist('2026-11-14T15:00'))
    const ceramics = at15.events.find((e) => e.id === 'e00000000a07')
    expect(ceramics?.flags).toContain('in progress (started 14:00)')
    expect(ids({ when: 'today' }, ist('2026-11-14T17:00'))).not.toContain('e00000000a07')
  })

  it('counts an overnight event on its start day', () => {
    const milonga = search({ query: 'milonga' }).events[0]!
    expect(milonga.when).toBe('Cuma, 13 Kasım 2026, 21:00–01:00 (next day)')
    expect(ids({ when: 'tomorrow' }, ist('2026-11-13T12:00'))).not.toContain('e00000000a22')
    expect(ids({ when: 'this_weekend' }, ist('2026-11-13T12:00'))).toContain('e00000000a22')
    // still on at 00:30 on Saturday
    expect(ok(getEvent(P, 'e00000000a22', ist('2026-11-14T00:30'))).status).toBe('in_progress')
  })

  it('uses the real Istanbul date and notes stale data', () => {
    expect(search({}, ist('2026-11-10T09:00')).data_note).toBeUndefined()
    const late = search({}, WED)
    expect(late.today).toBe('2026-11-11')
    expect(late.data_note).toMatch(/last refreshed 2026-11-10 05:12/)
    expect(late.events.map((e) => e.id)).not.toContain('e00000000a18')
  })

  it('refuses impossible ranges and clamps a past date_from', () => {
    expect(err(searchEvents(P, { date_from: '2026-11-20', date_to: '2026-11-14' }, WED))).toBe(MSG.dateOrder('2026-11-20', '2026-11-14'))
    expect(err(searchEvents(P, { when: 'today', date_from: '2026-11-20' }, WED))).toBe(MSG.whenAndDates())
    expect(err(searchEvents(P, { date_to: '2026-11-01' }, WED))).toBe(MSG.pastDateTo('2026-11-01', '2026-11-11'))
    expect(err(searchEvents(P, { query: '?! a' }, WED))).toBe(MSG.noWords('?! a'))
    const clamped = search({ date_from: '2026-11-01', date_to: '2026-11-12' })
    expect(clamped.range.from).toBe('2026-11-11')
    expect(clamped.events.map((e) => e.id)).toEqual(expect.arrayContaining(['e00000000a02', 'e00000000b01']))
    expect(clamped.hint).toContain(MSG.pastDateFrom('2026-11-01', '2026-11-11'))
  })

  it('says when date_from was moved and suggests the likely year', () => {
    const wrongYear = search({ date_from: '2025-11-14', categories: ['konser'] })
    expect(wrongYear.hint).toContain('date_from 2025-11-14 is in the past and was moved to today (2026-11-11). Did you mean 2026-11-14?')
    expect(err(searchEvents(P, { date_to: '2025-11-14' }, WED))).toContain('Did you mean 2026-11-14?')
    expect(MSG.pastDateFrom('2026-11-01', '2026-11-11')).not.toContain('Did you mean')
  })
})

describe('search_events pagination', () => {
  it('pages with a cursor and checks it', () => {
    const first = search({ limit: 3 })
    expect(first.total).toBeGreaterThan(6)
    expect(first.next_cursor).toBeDefined()
    expect(first.text).toContain(`cursor="${first.next_cursor}"`)
    const second = search({ limit: 3, cursor: first.next_cursor })
    expect(second.events.map((e) => e.id)).not.toEqual(expect.arrayContaining(first.events.map((e) => e.id)))
    expect(second.text).toMatch(/Showing 4-6/)

    expect(err(searchEvents(P, { limit: 3, cursor: 'not-a-cursor' }, WED))).toBe(MSG.badCursor())
    expect(err(searchEvents(P, { limit: 3, cursor: first.next_cursor, query: 'caz' }, WED))).toBe(MSG.otherSearchCursor())
    const refreshed = prepare({ ...INDEX, generated_at: '2026-11-11T05:00:00+03:00' })
    expect(err(searchEvents(refreshed, { limit: 3, cursor: first.next_cursor }, WED))).toBe(MSG.staleCursor())
    const week = search({ when: 'this_week', limit: 2 })
    expect(err(searchEvents(P, { when: 'this_week', limit: 2, cursor: week.next_cursor }, ist('2026-11-12T00:10')))).toBe(
      MSG.dayChanged('2026-11-12'),
    )
  })

  it('shortens a page of very long texts to stay under 16,000 characters and continues from there', () => {
    const long: SourceEvent[] = Array.from({ length: 30 }, (_, i) => ({
      id: `e${(0xd00 + i).toString(16).padStart(11, '0')}`,
      title: `Çok Uzun Başlıklı Bir Etkinlik ${i} ${'ğüşıöç '.repeat(30)}`,
      start: `${addDays('2026-11-11', i % 10)}T20:00`,
      venue: `Çok Uzun Adlı Bir Mekân ${'salon '.repeat(30)}`,
      district: 'Kadıköy',
      cat: 'konser',
      price: "1.250 TL'den başlayan fiyatlarla",
      flags: ['basvuru', 'yabanci', 'yer:3'],
      is_new: true,
    }))
    const p = prepare(buildMcpIndex({ meta: FIXTURE.meta, events: long }))
    const first = ok(searchEvents(p, { limit: 20 }, WED))
    expect(first.events.length).toBeLessThan(20)
    expect(first.text.length + JSON.stringify({ ...first, text: undefined }).length).toBeLessThan(16_000)
    const second = ok(searchEvents(p, { limit: 20, cursor: first.next_cursor }, WED))
    expect(second.text).toContain(`Showing ${first.events.length + 1}-`)
    expect(new Set([...first.events, ...second.events].map((e) => e.id)).size).toBe(first.events.length + second.events.length)
  })

  it('reports zero results with a hint that names the filter to drop', () => {
    const none = search({ query: 'caz', side: 'anadolu', categories: ['tiyatro'] })
    expect(none.total).toBe(0)
    expect(none.hint).toMatch(/No events match all filters/)
    expect(none.hint).toContain('Without "categories": 1 event.')
    expect(none.hint).not.toContain('Without "side"')
    expect(none.hint).toMatch(/"caz" alone has 3 upcoming events \(next: Perşembe, 12 Kasım 2026\)/)
    // a running exhibition is "next" today, never on its past start day
    expect(search({ query: 'fotograflari', side: 'anadolu' }).hint).toContain('(next: Çarşamba, 11 Kasım 2026)')
    expect(none.hint).not.toContain('wider')

    // counts are per show, like `total`: Hamlet's three dates count once
    const hamlet = search({ query: 'hamlet', side: 'anadolu' })
    expect(hamlet.hint).toContain('Without "side": 1 event.')

    // several words: each word alone
    const two = search({ query: 'kadikoy caz', side: 'avrupa' })
    expect(two.hint).toMatch(/Each word alone, all upcoming: "kadikoy" \d+ events, "caz" 3 events\./)

    const nothing = search({ query: 'zzyzx' })
    expect(nothing.hint).toContain('Without "query": ')
    expect(nothing.hint).toContain('Try other or fewer words.')
    const stuck = search({ query: 'zzyzx', language: 'fr' })
    expect(stuck.hint).toContain('Dropping any one filter still gives 0 events in this range. ')
    expect(stuck.hint).toMatch(/Try a wider "when" or other words\.$/)
  })

  it('explains scope limits and filter words found in the query', () => {
    expect(search({ query: 'çocuk' }).hint).toContain(MSG.scopeChildren())
    expect(search({ query: 'kids' }).hint).toContain(MSG.scopeChildren())
    expect(search({ query: 'dj' }).hint).toContain(MSG.scopeNight())
    expect(search({ query: 'free konser' }).hint).toContain(MSG.priceWord())
    expect(search({ query: 'english' }).hint).toContain(MSG.languageWord())
  })

  it('refuses a cursor past the last page', () => {
    const first = search({ limit: 3 })
    const forged = btoa(JSON.stringify({ ...JSON.parse(atob(first.next_cursor!.replace(/-/g, '+').replace(/_/g, '/'))), o: 999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(err(searchEvents(P, { limit: 3, cursor: forged }, WED))).toBe(MSG.cursorPastEnd(first.total))
  })
})

describe('get_event', () => {
  it('finds an event by id, link or slug', () => {
    expect(ok(getEvent(P, 'e83d55d4cfe7', WED))).toMatchObject({ id: 'e83d55d4cfe7', resolved_by: 'id' })
    const byLink = ok(getEvent(P, 'https://secki.istanbul/etkinlik/soen-memorial-tour-e83d55d4cfe7', WED))
    expect(byLink).toMatchObject({
      id: 'e83d55d4cfe7',
      url: 'https://secki.istanbul/etkinlik/soen-memorial-tour-e83d55d4cfe7',
      ticket_url: 'https://tickets.example/soen',
      side: 'avrupa',
    })
    expect(byLink.transit).toHaveLength(3)
    expect(ok(getEvent(P, 'soen-memorial-tour-e83d55d4cfe7', WED)).id).toBe('e83d55d4cfe7')
    expect(ok(getEvent(P, 'secki.istanbul/etkinlik/soen-memorial-tour-e83d55d4cfe7/', WED)).id).toBe('e83d55d4cfe7')
  })

  it('falls back to the title when the id in a link is old', () => {
    const r = ok(getEvent(P, 'https://secki.istanbul/etkinlik/hamlet-e0123456789a', WED))
    expect(r).toMatchObject({ id: 'e00000000b01', resolved_by: 'title', dates: 3 })
    expect(r.other_dates?.map((d) => d.id)).toEqual(['e00000000b02', 'e00000000b03'])
    expect(r.text).toMatch(/Resolved by title/)
  })

  it('returns recoverable errors that point at search_events', () => {
    expect(err(getEvent(P, 'e0123456789', WED))).toBe(MSG.notFound('e0123456789'))
    expect(err(getEvent(P, 'e0123456789a', WED))).toBe(MSG.notFound('e0123456789a'))
    expect(err(getEvent(P, 'foo bar', WED))).toBe(MSG.notAnId('foo bar', 'foo bar'))
    expect(err(getEvent(P, 'https://example.com/x', WED))).toBe(MSG.notAnId('https://example.com/x'))
    expect(err(getEvent(P, 'e00000000a18', WED))).toBe(MSG.notFound('e00000000a18'))
    const gone = 'kizilay-kan-bagisi-gunu-e123456789ab'
    expect(err(getEvent(P, gone, WED))).toBe(MSG.notFound(gone, 'kizilay kan bagisi'))
    expect(MSG.notFound(gone, 'kizilay kan bagisi')).toContain('search_events {"query":"kizilay kan bagisi"}')
  })

  it('accepts a link with non-ASCII letters and an id without its "e", and warns on a title mismatch', () => {
    expect(ok(getEvent(P, 'https://secki.istanbul/etkinlik/%C4%B0stanbul-e83d55d4cfe7', WED)).id).toBe('e83d55d4cfe7')
    expect(ok(getEvent(P, '83d55d4cfe7', WED)).id).toBe('e83d55d4cfe7')
    const mismatch = ok(getEvent(P, 'https://secki.istanbul/etkinlik/hamlet-e83d55d4cfe7', WED))
    expect(mismatch.id).toBe('e83d55d4cfe7')
    expect(mismatch.warning).toMatch(/does not match this event's title/)
    expect(mismatch.text).toMatch(/^Warning: /m)
    expect(ok(getEvent(P, 'soen-memorial-tour-e83d55d4cfe7', WED)).warning).toBeUndefined()
  })

  it('reports a status, and says cancellations are not tracked', () => {
    const soen = ok(getEvent(P, 'e83d55d4cfe7', WED))
    expect(soen.status).toBe('scheduled')
    expect(soen.text).toMatch(/Status: scheduled, as of the list of 2026-11-10 05:12\. Seçki does not track cancellations/)
    expect(ok(getEvent(P, 'e00000000a08', WED)).status).toBe('sold_out')
    expect(ok(getEvent(P, 'e00000000a09', WED)).status).toBe('full')
    expect(ok(getEvent(P, 'e00000000a07', ist('2026-11-14T15:00'))).status).toBe('in_progress')
    // ended earlier today: still found by id, marked as ended
    expect(ok(getEvent(P, 'e00000000a07', ist('2026-11-14T17:30'))).status).toBe('ended')
    expect(ok(getEvent(P, 'e00000000a03', WED)).status).toBe('in_progress')
    expect(ok(getEvent(P, 'e00000000a14', ist('2026-11-13T19:30'))).text).toContain('in progress (started 19:00; end time not stated)')
  })

  it('names the mode of each transit line', () => {
    expect(ok(getEvent(P, 'e83d55d4cfe7', WED)).transit).toEqual([
      'Gayrettepe (M2/M11 metro; 9 min walk)',
      'Zincirlikuyu (Metrobüs; 6 min walk)',
      'Levent (M2 metro; 15 min walk)',
    ])
  })

  it('computes the registration window from the Istanbul clock', () => {
    expect(ok(getEvent(P, 'e00000000a07', WED)).registration).toEqual({ status: 'opening_soon', opens: '2026-11-12T10:00' })
    expect(ok(getEvent(P, 'e00000000a07', ist('2026-11-12T10:00'))).registration?.status).toBe('open')
    expect(ok(getEvent(P, 'e00000000a12', WED)).registration).toEqual({ status: 'closed', last_day: '2026-11-09' })
  })

  it('keeps details small: other_dates <= 12, transit <= 3, under 4 KB', () => {
    const many: SourceEvent[] = Array.from({ length: 20 }, (_, i) => ({
      id: `e${(0xc00 + i).toString(16).padStart(11, '0')}`,
      title: 'Uzun Seri',
      start: `${addDays('2026-11-11', i)}T20:00`,
      venue: 'Sahne',
      district: 'Kadıköy',
      cat: 'tiyatro',
      series: { id: 's-long', count: 20 },
    }))
    const p = prepare(buildMcpIndex({ meta: FIXTURE.meta, events: many }))
    const r = ok(getEvent(p, many[0]!.id, WED))
    expect(r.other_dates).toHaveLength(12)
    expect(r.dates).toBe(20)
    expect(r.text).toMatch(/Other dates \(19\)/)
    for (const e of P.events) {
      const d = ok(getEvent(P, e.id, WED))
      expect(JSON.stringify(d).length + d.text.length).toBeLessThan(4096)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Privacy, schema and size                                            */
/* ------------------------------------------------------------------ */

const SUMMARY_KEYS = [
  'id',
  'title',
  'when',
  'start',
  'end',
  'venue',
  'district',
  'side',
  'category',
  'category_label',
  'workshop_type',
  'language',
  'price',
  'is_free',
  'flags',
  'dates',
  'url',
]
const DETAIL_KEYS = [
  ...SUMMARY_KEYS,
  'status',
  'note',
  'doors',
  'registration',
  'registration.status',
  'registration.opens',
  'registration.last_day',
  'ticket_url',
  'info_url',
  'transit',
  'location_approximate',
  'other_dates',
  'other_dates.id',
  'other_dates.when',
  'other_dates.start',
  'resolved_by',
  'warning',
  'data_updated',
]
const SEARCH_KEYS = ['today', 'range', 'range.from', 'range.to', 'range.label', 'data_updated', 'data_note', 'total', 'events', 'next_cursor', 'hint', ...SUMMARY_KEYS.map((k) => `events.${k}`)]

/** Dotted key paths of an output (array items share their parent's path). */
function keyPaths(v: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keyPaths(x, prefix, out))
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const path = prefix ? `${prefix}.${k}` : k
      out.add(path)
      keyPaths(x, path, out)
    }
  }
  return out
}

/** Every output both tools can give for an index: all pages of a few searches, and get_event for every event. */
function allOutputs(p: ReturnType<typeof prepare>, now: number) {
  const searches: Record<string, unknown>[] = []
  for (const args of [{}, { include_sold_out: true }, { sort: 'soonest' as const }, { categories: ['kultur' as const] }]) {
    let cursor: string | undefined
    do {
      const r = ok(searchEvents(p, { ...args, limit: 20, ...(cursor ? { cursor } : {}) }, now))
      const { text, ...structured } = r
      expect(text.length + JSON.stringify(structured).length).toBeLessThan(16_000)
      searches.push(structured)
      cursor = r.next_cursor
    } while (cursor)
  }
  const details = p.events.map((e) => {
    const { text, ...structured } = ok(getEvent(p, e.id, now))
    expect(text.length + JSON.stringify(structured).length).toBeLessThan(4096)
    return structured as Record<string, unknown>
  })
  return { searches, details }
}

describe('privacy', () => {
  const { searches, details } = allOutputs(P, WED)

  it('builds every output from the allowlist', () => {
    for (const s of searches) for (const k of keyPaths(s)) expect(SEARCH_KEYS).toContain(k)
    for (const d of details) for (const k of keyPaths(d)) expect(DETAIL_KEYS).toContain(k)
    expect(details).toHaveLength(INDEX.events.length)
  })

  it('never sends profile, backstage fields, din or source names out', () => {
    const all = JSON.stringify({ searches, details })
    expect(all).not.toMatch(/gizli/i)
    expect(all).not.toMatch(/"(score|source|profile|lat|lng|image|parking|series|hidden|alerts|flights|campaigns|rank|q|tl|group)"/)
    for (const e of [...details, ...searches.flatMap((s) => s.events as Record<string, unknown>[])]) {
      expect(e.category).not.toBe('din')
      expect(String(e.category_label)).not.toMatch(/din|tasavvuf/i)
    }
  })

  it('keeps the build-time index free of private data and cleans third-party text', () => {
    const file = JSON.stringify(INDEX)
    expect(file).not.toMatch(/gizli/i)
    expect(file).not.toMatch(/"(score|source|profile|lat|lng|image|parking|series|hidden|alerts|flights|campaigns|cat":"din)"/)
    expect(INDEX.events.find((e) => e.id === 'e00000000a18')).toBeUndefined()
    const long = INDEX.events.find((e) => e.id === 'e00000000a19')!
    expect(long.title).not.toMatch(/[\n\u0007]/)
    expect(long.title.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(long.note.length).toBeLessThanOrEqual(NOTE_MAX)
    expect(INDEX.events.find((e) => e.id === 'e00000000a15')!.flags).toEqual(['yer:1'])
  })
})

describe('output schemas', () => {
  it('accept every output for the fixture (null venue, null and unknown categories included)', () => {
    const { searches, details } = allOutputs(P, WED)
    for (const s of searches) expect(SearchOutput.safeParse(s).error).toBeUndefined()
    for (const d of details) expect(GetOutput.safeParse(d).error).toBeUndefined()
    expect(details.find((d) => d.id === 'e00000000a05')).toMatchObject({ venue: null, district: null, side: null, category: 'teknoloji' })
    expect(details.find((d) => d.id === 'e00000000a16')).toMatchObject({ category: 'diger', category_label: 'Diğer' })
  })

  /** A live-shaped file: the bundled demo sample, and the real events.json when a local run put one in public-demo/. */
  async function liveShaped(path: string): Promise<SourceFile | null> {
    try {
      const mod = (await import(/* @vite-ignore */ path)) as { default: SourceFile }
      return mod.default
    } catch {
      return null
    }
  }

  for (const path of ['../../src/data/sample-demo.json', '../../public-demo/data/events.json']) {
    it(`accept every event of ${path.replace(/^(\.\.\/)+/, 'web/')} (skipped when the file is absent)`, async (ctx) => {
      const src = await liveShaped(path)
      if (!src) return ctx.skip()
      // keep every event: index from the earliest day and query on that day
      const first = src.events.map((e) => e.start.slice(0, 10)).sort()[0]!
      const index: McpIndex = buildMcpIndex({ meta: { ...src.meta, today: first }, events: src.events })
      const p = prepare(index)
      const now = ist(`${first}T00:00`)
      const { searches, details } = allOutputs(p, now)
      expect(details.length).toBe(index.events.length)
      for (const s of searches) expect(SearchOutput.safeParse(s).error).toBeUndefined()
      for (const d of details) expect(GetOutput.safeParse(d).error).toBeUndefined()
      for (const d of details) expect(d.category).not.toBe('din')
    }, 60_000)
  }
})

describe('categories', () => {
  it('match the labels of server/events.ts and hide din', () => {
    for (const key of CATEGORY_KEYS) if (key !== 'teknoloji' && key !== 'diger') expect(CATEGORY_LABEL[key]).toBe(CAT_LABEL[key])
    expect(CATEGORY_LABEL.teknoloji).toBe(CAT_LABEL.tech)
    expect(publicCategory('din')).toBe('kultur')
    expect(publicCategory(undefined)).toBe('diger')
    expect(CATEGORY_KEYS).not.toContain('din')
    expect(WORKSHOP_LABEL.seramik).toBe('Seramik ve heykel')
  })

  it('fixture covers the cases the spec lists', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(16)
  })
})

describe('llms.txt', () => {
  it('counts shows like search_events and lists the tools, values and gaps', () => {
    const txt = llmsTxt('https://secki.istanbul', INDEX)
    const shows = new Set(INDEX.events.map((e, i) => e.group ?? `e${i}`)).size
    expect(txt).toContain(`About ${shows} upcoming events (${INDEX.events.length} dated listings; a repeating show counts once) at the last refresh`)
    expect(txt).toContain('claude mcp add --transport http --scope user secki https://secki.istanbul/mcp')
    expect(txt).toContain('tomorrow_evening')
    expect(txt).toContain(CATEGORY_KEYS.join(', '))
    expect(txt).toMatch(/children's and family events/)
    expect(txt).not.toMatch(/gizli/i)
  })
})
