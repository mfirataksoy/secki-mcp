/**
 * Turkish-aware text helpers. Owner: shell.
 *
 * - trLower('İSTANBUL') -> 'istanbul', trLower('IŞIK') -> 'ışık'
 * - fold('Yapay Zekâ AI') -> 'yapay zeka ai'  (lower + strip Turkish/diacritic marks, ı -> i)
 * Use `fold` on both sides for forgiving search and keyword matching.
 */

export function trLower(s: string | null | undefined): string {
  return (s ?? '').toLocaleLowerCase('tr')
}

const FOLD_MAP: Record<string, string> = {
  ı: 'i',
  i̇: 'i',
  ş: 's',
  ğ: 'g',
  ü: 'u',
  ö: 'o',
  ç: 'c',
  â: 'a',
  î: 'i',
  û: 'u',
}

/**
 * Lower-case with both Turkish and plain rules, then strip diacritics, so that
 * 'AI', 'Aı', 'aı' all become 'ai' and 'Kılıç' becomes 'kilic'.
 */
export function fold(s: string | null | undefined): string {
  const lower = (s ?? '').toLocaleLowerCase('tr')
  return lower
    .replace(/[ışğüöçâîû]|i̇/g, (ch) => FOLD_MAP[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Turkish-insensitive `haystack.includes(needle)`. */
export function includesFold(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  const n = fold(needle).trim()
  if (!n) return true
  return fold(haystack).includes(n)
}

/** True when any keyword (already or not yet folded) occurs in the folded text. */
export function hasAnyKeyword(foldedText: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => foldedText.includes(fold(k)))
}

/** Whole-word match on folded text, e.g. wordMatch(t, 'dj') does not hit 'adjust'. */
export function hasWord(foldedText: string, word: string): boolean {
  const w = fold(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(foldedText)
}

/** URL/file-safe slug: 'Sülüklügöl günübirlik' -> 'suluklugol-gunubirlik'. */
export function slugify(s: string, max = 60): string {
  return fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

/** Turkish thousands formatting: 1483 -> '1.483 TL'. */
export function fmtTL(n: number): string {
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n)} TL`
}

/** Turkish plural-free count label helper: count(3, 'etkinlik') -> '3 etkinlik'. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}`
}
