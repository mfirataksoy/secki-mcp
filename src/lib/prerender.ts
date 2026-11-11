/**
 * Static HTML for search engines and link previews, written by the demo build (vite.config.ts,
 * prerenderPlugin). Owner: shell. Pure string functions, no Vue or browser APIs.
 *
 * For every upcoming event, /etkinlik/<slug>.html is the built index.html with:
 *   - <title>, meta description, canonical, Open Graph / Twitter tags
 *   - schema.org Event JSON-LD (name, dates, place, image, offers)
 *   - a short static summary inside #app, replaced by the app once it loads
 * plus sitemap.xml and robots.txt. The private build is never prerendered and stays noindex.
 *
 *   renderEventHtml(indexHtml, event, 'https://secki.istanbul') -> html
 */
import { eventPath } from './eventUrl.ts'
import { priceTl } from './price.ts'
import { fold } from './text.ts'

export const SITE_NAME = 'Seçki İstanbul'
const DESCRIPTION_MAX = 160
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

/** The RawEvent fields a page needs (types/index.ts), spelled out so the build config can load this file. */
interface PageEvent {
  id: string
  title: string
  start: string
  end?: string | null
  venue: string
  district: string | null
  price: string | null
  why: string
  url: string
  flags: string[]
  lat?: number
  lng?: number
  approx?: boolean
  image?: string | null
  ticket_url?: string | null
  series?: { id: string; count: number } | null
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** JSON that is safe inside <script>: no '</script>' or '<!--' can close or open anything. */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

/** The event's last day, 'YYYY-MM-DD'. */
function lastDay(e: Pick<PageEvent, 'start' | 'end'>): string {
  return (e.end || e.start).slice(0, 10)
}

/** Still on or ahead of `today` ('YYYY-MM-DD', the pipeline's meta.today). */
export function isUpcoming(e: Pick<PageEvent, 'start' | 'end'>, today: string): boolean {
  return lastDay(e) >= today
}

/** '2026-11-03T20:30' -> 'Salı, 3 Kasım 2026, 20:30'; '2026-11-03' -> 'Salı, 3 Kasım 2026'. */
export function fmtStart(start: string): string {
  const [y, m, d] = start.slice(0, 10).split('-').map(Number) as [number, number, number]
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const time = start.length > 10 ? `, ${start.slice(11, 16)}` : ''
  return `${wd}, ${d} ${MONTHS[m - 1]} ${y}${time}`
}

/** Istanbul local 'YYYY-MM-DDTHH:mm' -> ISO 8601 with +03:00; date-only stays a date. */
function isoDate(s: string): string {
  return s.length > 10 ? `${s.slice(0, 16)}:00+03:00` : s.slice(0, 10)
}

function isOnline(e: PageEvent): boolean {
  return /\b(online|cevrimici|zoom)\b/.test(fold(e.venue))
}

function place(e: PageEvent): string {
  if (!e.district || fold(e.venue).includes(fold(e.district))) return e.venue
  return `${e.venue}, ${e.district}`
}

export function eventDescription(e: PageEvent): string {
  const parts = [e.why?.trim().replace(/\.$/, ''), `${fmtStart(e.start)}, ${place(e)}`, e.price?.trim()].filter(Boolean)
  const text = parts.join('. ') + '.'
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : text
}

function httpsOrNull(u: string | null | undefined): string | null {
  return u && /^https:\/\//.test(u) ? u : null
}

export function eventJsonLd(e: PageEvent, site: string): Record<string, unknown> {
  const url = site + eventPath(e)
  const online = isOnline(e)
  const tl = priceTl(e.price)
  const soldOut = e.flags.includes('tukendi') || e.flags.includes('dolu')
  const offerUrl = httpsOrNull(e.ticket_url) ?? httpsOrNull(e.url)
  const image = httpsOrNull(e.image)
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    startDate: isoDate(e.start),
    ...(e.end ? { endDate: isoDate(e.end) } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: online ? 'https://schema.org/OnlineEventAttendanceMode' : 'https://schema.org/OfflineEventAttendanceMode',
    location: online
      ? { '@type': 'VirtualLocation', url: offerUrl ?? url }
      : {
          '@type': 'Place',
          name: e.venue,
          address: {
            '@type': 'PostalAddress',
            ...(e.district ? { addressLocality: e.district } : {}),
            addressRegion: 'İstanbul',
            addressCountry: 'TR',
          },
          ...(e.lat != null && e.lng != null && !e.approx ? { geo: { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } } : {}),
        },
    description: eventDescription(e),
    url,
    ...(image ? { image: [image] } : {}),
  }
  if (tl != null || offerUrl) {
    ld.offers = {
      '@type': 'Offer',
      ...(offerUrl ? { url: offerUrl } : {}),
      ...(tl != null ? { price: tl, priceCurrency: 'TRY' } : {}),
      availability: soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    }
  }
  return ld
}

interface Head {
  title: string
  description: string
  canonical: string
  image?: string | null
  type: 'website' | 'article'
  jsonLd?: Record<string, unknown>
}

/** Swaps the template's <title>, description and robots tags and adds canonical, OG and JSON-LD. */
function withHead(template: string, h: Head): string {
  const tags = [
    `<link rel="canonical" href="${escapeHtml(h.canonical)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:type" content="${h.type}" />`,
    `<meta property="og:title" content="${escapeHtml(h.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(h.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(h.canonical)}" />`,
    `<meta property="og:locale" content="tr_TR" />`,
    ...(h.image ? [`<meta property="og:image" content="${escapeHtml(h.image)}" />`] : []),
    `<meta name="twitter:card" content="${h.image ? 'summary_large_image' : 'summary'}" />`,
    ...(h.jsonLd ? [`<script type="application/ld+json">${scriptJson(h.jsonLd)}</script>`] : []),
  ]
  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(h.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escapeHtml(h.description)}" />`)
    .replace(/\s*<meta name="robots"[^>]*>/, '')
    .replace('</head>', `    ${tags.join('\n    ')}\n  </head>`)
}

/** The demo's own index.html: indexable, with canonical and OG tags. */
export function renderHomeHtml(template: string, site: string, description: string): string {
  return withHead(template, { title: SITE_NAME, description, canonical: `${site}/`, type: 'website' })
}

/**
 * `canonicalOf`: for a series (the same show on several dates), the date every page points search
 * engines at, so the 30 dates of a daily exhibition count as one page. Defaults to the event itself.
 */
export function renderEventHtml(
  template: string,
  e: PageEvent,
  site: string,
  canonicalOf: Pick<PageEvent, 'id' | 'title'> = e,
): string {
  const canonical = site + eventPath(canonicalOf)
  const description = eventDescription(e)
  const html = withHead(template, {
    title: `${e.title} · ${SITE_NAME}`,
    description,
    canonical,
    image: httpsOrNull(e.image),
    type: 'article',
    jsonLd: eventJsonLd(e, site),
  })
  // Readable without JavaScript; the app replaces it on mount.
  const summary = [
    `<article style="max-width:42rem;margin:0 auto;padding:1.5rem 1rem;font-family:system-ui,sans-serif">`,
    `<h1>${escapeHtml(e.title)}</h1>`,
    `<p>${escapeHtml(fmtStart(e.start))} · ${escapeHtml(place(e))}</p>`,
    ...(e.price ? [`<p>${escapeHtml(e.price)}</p>`] : []),
    ...(e.why ? [`<p>${escapeHtml(e.why)}</p>`] : []),
    `<p><a href="/">${escapeHtml(SITE_NAME)}: İstanbul'da bugün neler var?</a></p>`,
    `</article>`,
  ].join('')
  return html.replace('<div id="app"></div>', `<div id="app">${summary}</div>`)
}

export function sitemapXml(site: string, paths: readonly string[], lastmod: string): string {
  const urls = paths
    .map((p) => `  <url><loc>${escapeHtml(site + p)}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

export function robotsTxt(site: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${site}/sitemap.xml\n`
}
