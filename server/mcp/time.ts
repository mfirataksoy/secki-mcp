/**
 * Istanbul clock and date ranges for the MCP tools. Owner: backend (MCP). No dependencies.
 *
 * Istanbul is UTC+3 all year (no DST since 2016; web/src/lib/date.ts ISTANBUL.utcOffsetMin = 180), so wall
 * clock = UTC + 3 h, read with getUTC* only. `now` is always passed in (milliseconds), so tests freeze it.
 * "Today" is the real Istanbul date, never meta.today (that lags when a daily run fails).
 *
 *   istanbulNow(Date.UTC(2026, 10, 10, 21, 30)) -> { ymd: '2026-11-11', dow: 3, hhmm: '00:30', stamp: '2026-11-11T00:30' }
 *   whenRange('this_weekend', now)              -> { from: '2026-11-13', to: '2026-11-15', fridayFrom1700: true }
 */

export const OFFSET_MIN = 180

export interface IstanbulNow {
  /** 'YYYY-MM-DD' */
  ymd: string
  /** 0 Sunday … 6 Saturday */
  dow: number
  /** 'HH:MM' */
  hhmm: string
  /** 'YYYY-MM-DDTHH:MM', comparable with event start strings */
  stamp: string
}

export function istanbulNow(nowMs: number): IstanbulNow {
  const d = new Date(nowMs + OFFSET_MIN * 60_000)
  const iso = d.toISOString()
  return { ymd: iso.slice(0, 10), dow: d.getUTCDay(), hhmm: iso.slice(11, 16), stamp: iso.slice(0, 16) }
}

function parts(ymd: string): [number, number, number] {
  return ymd.split('-').map(Number) as [number, number, number]
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = parts(ymd)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** 0 Sunday … 6 Saturday */
export function dayOfWeek(ymd: string): number {
  const [y, m, d] = parts(ymd)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function isRealDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const [y, m, d] = parts(ymd)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

function lastOfMonth(ymd: string): string {
  const [y, m] = parts(ymd)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export const WHEN_VALUES = [
  'today',
  'tonight',
  'tomorrow',
  'tomorrow_evening',
  'this_weekend',
  'next_weekend',
  'this_week',
  'next_week',
  'next_7_days',
  'this_month',
  'next_30_days',
] as const

export type When = (typeof WHEN_VALUES)[number]

export interface DayRange {
  from: string
  /** Inclusive last day; null = open-ended. */
  to: string | null
  /** tonight / tomorrow_evening: timed events must start at 17:00 or later; all-day exhibitions are left out. */
  evening?: boolean
  /** this_weekend / next_weekend: timed events on the Friday must start at 17:00 or later. */
  fridayFrom1700?: boolean
}

/**
 * The days a `when` keyword covers. Weeks run Monday to Sunday as on the site; the weekend is Friday 17:00
 * to Sunday (Mon-Thu: the coming one; Fri-Sun: the current one), as weekendRange in web/src/lib/date.ts.
 */
export function whenRange(when: When, now: IstanbulNow): DayRange {
  const t = now.ymd
  const dow = now.dow
  const toSunday = dow === 0 ? 0 : 7 - dow
  switch (when) {
    case 'today':
      return { from: t, to: t }
    case 'tonight':
      return { from: t, to: t, evening: true }
    case 'tomorrow':
      return { from: addDays(t, 1), to: addDays(t, 1) }
    case 'tomorrow_evening':
      return { from: addDays(t, 1), to: addDays(t, 1), evening: true }
    case 'this_weekend':
    case 'next_weekend': {
      // Friday of the current weekend (Fri-Sun) or of the coming one (Mon-Thu)
      const toFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow
      const fri = addDays(t, toFri + (when === 'next_weekend' ? 7 : 0))
      const from = fri < t ? t : fri
      return { from, to: addDays(fri, 2), fridayFrom1700: from === fri }
    }
    case 'this_week':
      return { from: t, to: addDays(t, toSunday) }
    case 'next_week':
      return { from: addDays(t, toSunday + 1), to: addDays(t, toSunday + 7) }
    case 'next_7_days':
      return { from: t, to: addDays(t, 6) }
    case 'this_month':
      return { from: t, to: lastOfMonth(t) }
    case 'next_30_days':
      return { from: t, to: addDays(t, 29) }
  }
}

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

/** '2026-11-14' -> 'Cumartesi, 14 Kasım 2026' (the tables of fmtStart in web/src/lib/prerender.ts). */
export function dayLabel(ymd: string): string {
  const [y, m, d] = parts(ymd)
  return `${WEEKDAYS[dayOfWeek(ymd)]}, ${d} ${MONTHS[m - 1]} ${y}`
}

/** 'Cuma, 13 Kasım 2026, 17:00 – Pazar, 15 Kasım 2026', 'Salı, 10 Kasım 2026 and later'. */
export function rangeLabel(r: DayRange): string {
  const first = `${dayLabel(r.from)}${r.evening || r.fridayFrom1700 ? ', 17:00' : ''}`
  if (r.to === null) return `${first} and later`
  return r.to === r.from ? first + (r.evening ? ' onwards' : '') : `${first} – ${dayLabel(r.to)}`
}
