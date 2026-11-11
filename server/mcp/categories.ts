/**
 * Public category keys of the MCP tools. Owner: backend (MCP).
 *
 * The raw `cat` of events.json is mapped to a public key: din -> kultur (KVKK art. 6, the public site has
 * no tasavvuf category either), tech -> teknoloji, anything unknown or missing -> diger. Labels match
 * CAT_LABEL in ../events.ts (a test checks that); they are copied, not imported, because the build-time
 * indexer (vite.config.ts) cannot import events.ts and its Workers types.
 *
 *   publicCategory('din') -> 'kultur', publicCategory(null) -> 'diger', CATEGORY_LABEL.teknoloji -> 'Teknoloji'
 */

export const CATEGORY_KEYS = [
  'konser',
  'gece',
  'tiyatro',
  'sanat',
  'akademik',
  'kultur',
  'teknoloji',
  'doga',
  'yoga',
  'sosyal',
  'fuar',
  'atolye',
  'kurs',
  'dans',
  'spor',
  'diger',
] as const

export type CategoryKey = (typeof CATEGORY_KEYS)[number]

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  konser: 'Konser',
  gece: 'Gece',
  tiyatro: 'Tiyatro',
  sanat: 'Sanat',
  akademik: 'Akademik',
  kultur: 'Kültür',
  teknoloji: 'Teknoloji',
  doga: 'Doğa',
  yoga: 'Yoga',
  sosyal: 'Sosyal',
  fuar: 'Fuar',
  atolye: 'Atölye',
  kurs: 'Kurs',
  dans: 'Dans',
  spor: 'Spor',
  diger: 'Diğer',
}

/** Raw `cat` values that differ from their public key. */
const RAW_TO_PUBLIC: Record<string, CategoryKey> = { din: 'kultur', tech: 'teknoloji' }

const KEYS = new Set<string>(CATEGORY_KEYS)

export function publicCategory(raw: string | null | undefined): CategoryKey {
  if (!raw) return 'diger'
  const mapped = RAW_TO_PUBLIC[raw]
  if (mapped) return mapped
  return KEYS.has(raw) ? (raw as CategoryKey) : 'diger'
}

/** Labels of the pipeline's workshop types, copied from web/src/lib/kinds.ts WORKSHOP_TYPES (that file imports Vue). */
export const WORKSHOP_LABEL: Record<string, string> = {
  mutfak: 'Mutfak ve pastacılık',
  resim: 'Resim ve çizim',
  seramik: 'Seramik ve heykel',
  el_isi: 'El işi ve tasarım',
  koku: 'Mum, parfüm ve koku',
  geleneksel: 'Geleneksel sanatlar',
  icecek: 'Kahve, kokteyl ve tadım',
  sanat: 'Müze ve galeri atölyeleri',
  yazi: 'Yazı ve düşünce',
  sahne: 'Dans, ses ve sahne',
  dijital: 'Fotoğraf, film ve dijital',
  diger: 'Diğer atölyeler',
}
