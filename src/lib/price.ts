/**
 * Price strings as the pipeline writes them. Owner: shell. No Vue imports (used by the build's prerender).
 *
 *   priceTl('Ücretsiz') -> 0, priceTl('2.000 TL') -> 2000, priceTl("410 TL'den") -> 410, priceTl('₺350') -> 350,
 *   anything else -> null
 */
import { fold } from './text.ts'

export function priceTl(price: string | null | undefined): number | null {
  if (!price) return null
  const f = fold(price)
  if (/\b(ucretsiz|bedava|free)\b/.test(f)) return 0
  const m = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?\s*(?:tl|try)\b/.exec(f) ?? /₺\s*(\d{1,3}(?:\.\d{3})+|\d+)/.exec(price)
  return m ? Number(m[1]!.replace(/\./g, '')) : null
}
