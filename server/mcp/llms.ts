/**
 * /llms.txt (https://llmstxt.org): what Seçki İstanbul is and how agents can query it through /mcp.
 * Owner: backend (MCP). Written by the demo prerender (vite.config.ts) next to sitemap.xml and served as
 * text/plain. Counts come from the same index the MCP server reads, so they match what search_events reports
 * (a repeating show counted once).
 *
 *   llmsTxt('https://secki.istanbul', buildMcpIndex(data)) -> '# Seçki İstanbul\n\n> …'
 */
import { CATEGORY_KEYS } from './categories.ts'
import type { McpIndex } from './indexer.ts'
import { WHEN_VALUES } from './time.ts'

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

export function llmsTxt(site: string, index: McpIndex): string {
  const shows = new Set(index.events.map((e, i) => (e.group !== undefined ? `g${e.group}` : `e${i}`))).size
  const refreshed = index.generated_at.slice(0, 16).replace('T', ' ')
  return `# Seçki İstanbul

> Curated, daily-refreshed list of upcoming public events in Istanbul, Turkey: concerts, theatre, exhibitions, talks, workshops, dance, sports, nature trips and fairs. About ${fmt(shows)} upcoming events (${fmt(index.events.length)} dated listings; a repeating show counts once) at the last refresh, ${refreshed} (Europe/Istanbul, UTC+3); later in the day search_events counts fewer, as events that have started drop out. Event text is mostly Turkish.

Agents can query it through a public, read-only MCP server (no sign-in): ${site}/mcp (Streamable HTTP, stateless; protocol 2026-07-28 and the 2025 initialize handshake). One JSON-RPC message per POST; GET returns 405.

Claude Code: \`claude mcp add --transport http --scope user secki ${site}/mcp\`

## MCP tools

- search_events: upcoming events by any mix of filters, in Seçki's editorial ranking or soonest first; 10 per page (max 20) with a cursor.
  - when: ${WHEN_VALUES.join(', ')} (Istanbul time; tonight and tomorrow_evening = from 17:00)
  - date_from, date_to: YYYY-MM-DD
  - query: words that must all start a word in the title, venue, neighbourhood, district or category; accent- and case-insensitive
  - categories: ${CATEGORY_KEYS.join(', ')}
  - side: avrupa (European side) or anadolu (Asian side)
  - free_only, max_price_tl, language ("en"/"tr"), registration ("opening_soon"/"open"), include_sold_out, sort (best/soonest)
- get_event: one event by id or secki.istanbul/etkinlik link: status, times, venue, price, registration, transit, other dates, ticket and organiser links.

Examples:

- search_events {"when":"this_weekend","categories":["konser"],"side":"anadolu"}
- search_events {"when":"tonight","query":"caz"}
- get_event {"id":"${site}/etkinlik/ornek-konser-e0123456789a"}

## Known gaps

- Not listed, by design: children's and family events, DJ sets and club nights, ceremonies.
- Many events state no price, and some no district, so price and side filters leave them out (the tool's hint says how many).
- The language of an event is known for few events.
- Cancellations are not tracked: confirm on the organiser's page.

## Data

- [Event pages](${site}/sitemap.xml): one page per upcoming event at /etkinlik/<title-slug>-<id>, with schema.org Event JSON-LD
- [Calendar feed](${site}/takvim.ics): iCalendar, recommended events for the next 60 days
- [events.json](${site}/data/events.json): the raw daily file (about 2 MB, fields may change; prefer the MCP tools)

## Optional

- [Privacy notice (KVKK, Turkish)](${site}/kvkk/)
`
}
