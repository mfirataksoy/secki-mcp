/**
 * Every recoverable error and hint of the MCP tools, in one place (the tests import them). Owner: backend (MCP).
 *
 * Tool errors are returned as results with isError: true, so the client hands them to the model. Each one
 * names the problem, shows valid input and says what to do next. English on purpose: the reader is an agent.
 */
import { isRealDate } from './time.ts'

export const MSG = {
  /** E1 */
  dateOrder: (from: string, to: string) =>
    `date_to (${to}) is before date_from (${from}). Swap them, or send only date_from.`,
  /** E2 */
  whenAndDates: () =>
    'Use either "when" or date_from/date_to, not both. Examples: {"when":"this_weekend"} or {"date_from":"2026-11-14","date_to":"2026-11-16"}.',
  /** E3 */
  pastDateTo: (to: string, today: string) =>
    `date_to (${to}) is in the past. Seçki lists upcoming events only; today in Istanbul is ${today}.${didYouMean(to, today)} Use a date on or after today, or use "when".`,
  /** Hint (not an error): a past date_from is moved to today. */
  pastDateFrom: (from: string, today: string) =>
    `date_from ${from} is in the past and was moved to today (${today}).${didYouMean(from, today)}`,
  /** E4 */
  noWords: (query: string) =>
    `query ${JSON.stringify(query)} has no searchable words (single letters and symbols are ignored). Send a word such as "caz" or "tiyatro", or leave query out.`,
  /** E5 is not an error: free_only wins over max_price_tl and this hint is added. */
  freeWins: () => 'free_only and max_price_tl were both set; free_only was used.',
  /** E6 */
  badCursor: () => 'This cursor is not valid. Repeat the search without "cursor" to start from the first page.',
  /** E7 */
  staleCursor: () =>
    'The event list was refreshed after this cursor was made, so pages would shift. Repeat the same search without "cursor".',
  /** E8 */
  otherSearchCursor: () =>
    'This cursor belongs to a different search. Send exactly the same filters as the first call, or drop "cursor".',
  /** E9: `query` is built from the title words of the link, when it has some. */
  notFound: (input: string, query?: string) =>
    `No upcoming event matches ${JSON.stringify(input)}. It may have ended or been removed, or the id is wrong; ids come from search_events and can change when the daily list is rebuilt. ${
      query ? `To look for it by name, call search_events ${JSON.stringify({ query })}.` : 'To look for it by name, call search_events with one or two words of its title.'
    }`,
  /** E10: `query` is the input itself when it looks like a title. */
  notAnId: (input: string, query?: string) =>
    `${JSON.stringify(input)} is not an event id or a secki.istanbul event link. Ids look like "e0123456789a" ("e" + 11 hex characters).${
      query ? ` To find an event by name, call search_events ${JSON.stringify({ query })}.` : ''
    }`,
  /** E11 */
  dataDown: (detail: string) =>
    `Event data is temporarily unavailable (${detail}). This is a problem on Seçki's side, not with your request; retry in about 30 seconds.`,
  /** E13 */
  cursorPastEnd: (total: number) =>
    `This cursor is past the last page (${count(total, 'event')} in all). Repeat the search without "cursor".`,
  /** E12 */
  dayChanged: (today: string) =>
    `The Istanbul date changed since this cursor was made (today is ${today}), so the same filters now cover different days. Repeat the same search without "cursor".`,
  /** Any other failure inside a tool (never shows internals). */
  internal: () => 'Something went wrong on Seçki’s side while answering. Retry once; if it fails again, try different filters.',
  /** HTTP 405 body for GET/PUT/DELETE/… on /mcp. */
  methodNotAllowed: (site: string) =>
    `This is the Seçki İstanbul MCP endpoint. Connect an MCP client to ${site}/mcp (POST, Streamable HTTP, no sign-in). Docs: ${site}/llms.txt\n`,
  /** HTTP 429 (JSON-RPC error message). */
  rateLimited: (seconds: number) =>
    `Too many requests from this client. Retry in ${seconds} s. The tools are read-only and safe to retry.`,
  /** HTTP 404 for subscriptions/listen (JSON-RPC -32601). */
  noSubscriptions: () =>
    'Method not found: subscriptions/listen. This server has no subscriptions; its tool list changes only when the site is deployed.',
  /** Hint when the query asks for something Seçki leaves out by design. */
  scopeChildren: () =>
    'Seçki does not list children\'s or family events by design; this is a scope limit, not a search problem. Results that mention "çocuk" are events for adults (e.g. talks about children).',
  scopeNight: () => 'Seçki does not list DJ sets and club nights by design; this is a scope limit, not a search problem.',
  priceWord: () => '"free" is a filter, not a search word: send free_only: true (or max_price_tl) instead of putting it in query.',
  languageWord: () =>
    'Language is a filter, not a search word: send language: "en" (or "tr") instead of putting it in query. Most events are in Turkish; the language is known for few of them.',
  /** HTTP 400 for a JSON array body (JSON-RPC batch). */
  noBatch: () => 'Batching is not supported; send one JSON-RPC message per POST.',
  /** HTTP 413 (JSON-RPC error message). */
  tooLarge: (max: number) => `Request body too large (max ${Math.round(max / 1024)} KB).`,
} as const

/** '1 event', '3 events' */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * A date in an earlier year (a model's usual slip): ' Did you mean 2026-11-14?' with the same month and day
 * this year or next year, whichever is still ahead; '' otherwise.
 */
export function didYouMean(ymd: string, today: string): string {
  const year = Number(today.slice(0, 4))
  if (Number(ymd.slice(0, 4)) >= year) return ''
  for (const y of [year, year + 1]) {
    const guess = `${y}${ymd.slice(4)}`
    if (guess >= today && isRealDate(guess)) return ` Did you mean ${guess}?`
  }
  return ''
}

/** Shown with data_note when the daily refresh has not run yet today. */
export function staleDataNote(generatedAt: string): string {
  const stamp = generatedAt.slice(0, 16).replace('T', ' ')
  return `Event data was last refreshed ${stamp} (Istanbul); today's refresh has not run yet, so late changes may be missing.`
}
