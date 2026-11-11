/**
 * Query words for search_events. Owner: backend (MCP).
 *
 * Words are folded with web/src/lib/text.ts `fold` (Turkish-aware: İ/I/ı -> i, ş -> s, …), split on anything
 * that is not a-z or 0-9, and 1-character words are dropped (the rule of words() in server/events.ts).
 * A word matches the start of a word in the folded search text, so Turkish suffixes still match
 * ("konser" finds "konserleri", "kadikoy" finds "kadikoyde") but "caz" does not hit "ilacaz".
 * A few common English words also match their Turkish form ("jazz" finds "caz"), and the Turkish word
 * matches the English one back ("caz" finds "Jazz Trio": many titles are in English).
 *
 *   queryWords('Kadıköy caz!') -> [['kadikoy'], ['caz', 'jazz']]
 *   queryWords('jazz')         -> [['jazz', 'caz']]
 *   matchesAll('caz gecesi kadikoy', queryWords('kadikoy caz')) -> true
 */
import { fold } from '../../src/lib/text.ts'

/** English word -> Turkish alternatives (folded). Short on purpose: no stemming, no guessing. */
export const SYNONYMS: Record<string, readonly string[]> = {
  jazz: ['caz'],
  concert: ['konser'],
  concerts: ['konser'],
  theatre: ['tiyatro'],
  theater: ['tiyatro'],
  exhibition: ['sergi'],
  exhibitions: ['sergi'],
  workshop: ['atolye'],
  workshops: ['atolye'],
  ceramics: ['seramik'],
  ceramic: ['seramik'],
  pottery: ['seramik'],
  dance: ['dans'],
  talk: ['soylesi', 'konferans'],
  lecture: ['soylesi', 'konferans'],
  cinema: ['film', 'sinema'],
  movie: ['film', 'sinema'],
  film: ['film', 'sinema'],
  ballet: ['bale'],
  classical: ['klasik'],
  museum: ['muze'],
  poetry: ['siir'],
  book: ['kitap'],
  cooking: ['mutfak'],
  wine: ['sarap'],
  hike: ['yuruyus'],
  hiking: ['yuruyus'],
  running: ['kosu'],
  painting: ['resim'],
  photography: ['fotograf'],
}

/** Turkish word -> the English words that map to it (SYNONYMS read backwards); a prefix covers its plural. */
export const REVERSE: Record<string, readonly string[]> = (() => {
  const out: Record<string, string[]> = {}
  for (const [en, trs] of Object.entries(SYNONYMS)) {
    for (const tr of trs) {
      const list = (out[tr] ??= [])
      if (en !== tr && !list.some((x) => en.startsWith(x))) list.push(en)
    }
  }
  return out
})()

/** Folded query words; each entry lists the alternatives of one word (the word itself first). */
export function queryWords(query: string): string[][] {
  return fold(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map((w) => [...new Set([w, ...(SYNONYMS[w] ?? []), ...(REVERSE[w] ?? [])])])
}

const cache = new Map<string, RegExp>()

function prefixRe(word: string): RegExp {
  let re = cache.get(word)
  if (!re) {
    // words are [a-z0-9]+ after folding, so they need no escaping
    re = new RegExp(`(?:^|[^a-z0-9])${word}`)
    if (cache.size > 500) cache.clear()
    cache.set(word, re)
  }
  return re
}

/** Every word (one of its alternatives) starts a word in `text` (already folded). */
export function matchesAll(text: string, words: readonly (readonly string[])[]): boolean {
  return words.every((alts) => alts.some((w) => prefixRe(w).test(text)))
}
