/**
 * Neighbourhood -> ilçe (district municipality) for the MCP search. Owner: backend (MCP).
 *
 * `event.district` holds the label the pipeline wrote, often a neighbourhood (Moda, Galata, Zincirlikuyu),
 * so a search for the ilçe ("Kadıköy", "Beyoğlu") missed most of its events. The indexer adds the ilçe
 * names below to the folded search text, and prepare() (query.ts) uses them for the side of a
 * neighbourhood that web/src/lib/geo.ts does not know (e.g. Yenibosna).
 *
 * Only unambiguous neighbourhoods are listed; one on an ilçe border lists both ilçe. Names are those of
 * geo.ts plus a few seen in the live data; an ilçe name itself needs no entry.
 *
 *   ilceOf('Moda') -> ['Kadıköy'], ilceOf('Zincirlikuyu') -> ['Beşiktaş', 'Şişli'], ilceOf('Kadıköy') -> []
 */
import { fold } from '../../src/lib/text.ts'

const BY_ILCE: Record<string, string> = {
  Beyoğlu:
    'Karaköy Galata Şişhane Tepebaşı Tünel Cihangir Taksim Dolapdere Tophane Kasımpaşa Hasköy Fındıklı Kabataş Gümüşsuyu Pera Asmalımescit Kuledibi Salıpazarı Piyalepaşa Sütlüce',
  Şişli: 'Harbiye Nişantaşı Teşvikiye Bomonti Mecidiyeköy Kurtuluş Feriköy Pangaltı Esentepe Fulya Osmanbey Elmadağ',
  Beşiktaş: 'Levent Etiler Bebek Ortaköy Kuruçeşme Ulus Dolmabahçe Yıldız Çırağan Gayrettepe Balmumcu Akatlar',
  Sarıyer:
    'Maslak Ayazağa Rumelihisarı Emirgan İstinye Yeniköy Tarabya Kilyos Zekeriyaköy Bahçeköy Rumelifeneri Vadistanbul',
  Fatih:
    'Beyazıt Sultanahmet Eminönü Sirkeci Balat Fener Cibali Unkapanı Vefa Aksaray Laleli Yenikapı Kumkapı Samatya Yedikule Fındıkzade Çapa Kocamustafapaşa',
  Zeytinburnu: 'Kazlıçeşme',
  Bakırköy: 'Yeşilköy Florya Ataköy Yeşilyurt',
  Başakşehir: 'Bahçeşehir',
  Küçükçekmece: 'Halkalı',
  Bahçelievler: 'Yenibosna',
  Eyüpsultan: 'Göktürk Kemerburgaz',
  Kadıköy:
    'Moda Fenerbahçe Kalamış Caddebostan Göztepe Erenköy Suadiye Bostancı Kozyatağı Hasanpaşa Yeldeğirmeni Koşuyolu Haydarpaşa Feneryolu Selamiçeşme Ziverbey Fikirtepe Söğütlüçeşme Rasimpaşa Osmanağa Bahariye Kuşdili Caferağa Sahrayıcedit',
  Üsküdar:
    'Altunizade Bağlarbaşı Kuzguncuk Çengelköy Beylerbeyi Kandilli Vaniköy Çamlıca Kısıklı Harem Selimiye Salacak Validebağ Bulgurlu',
  Ataşehir: 'İçerenköy Kayışdağı Ferhatpaşa Esenkent',
  Maltepe: 'Dragos Cevizli Küçükyalı İdealtepe',
  Kartal: 'Soğanlık Yakacık Uğurmumcu',
  Pendik: 'Kurtköy',
  Sancaktepe: 'Samandıra',
  Beykoz: 'Anadoluhisarı Kanlıca Çubuklu Paşabahçe Riva Polonezköy Kavacık',
  Adalar: 'Büyükada Heybeliada Burgazada Kınalıada',
  Şile: 'Ağva',
}

/** Neighbourhoods on an ilçe border, or written as two words. */
const MULTI: Record<string, string[]> = {
  Zincirlikuyu: ['Beşiktaş', 'Şişli'],
  Maçka: ['Şişli', 'Beşiktaş'],
  Acıbadem: ['Kadıköy', 'Üsküdar'],
  'Bağdat Caddesi': ['Kadıköy', 'Maltepe'],
  'Büyük Çamlıca': ['Üsküdar'],
  'Batı Ataşehir': ['Ataşehir'],
  'Anadolu Kavağı': ['Beykoz'],
  'Rumeli Feneri': ['Sarıyer'],
  'Rumeli Kavağı': ['Sarıyer'],
  'Belgrad Ormanı': ['Sarıyer', 'Eyüpsultan'],
}

const ILCE_BY_KEY = new Map<string, string[]>()
for (const [ilce, list] of Object.entries(BY_ILCE)) for (const n of list.split(/\s+/)) if (n) ILCE_BY_KEY.set(fold(n), [ilce])
for (const [n, ilce] of Object.entries(MULTI)) ILCE_BY_KEY.set(fold(n), ilce)

/** The ilçe a neighbourhood label belongs to ('Moda' -> ['Kadıköy']); [] for an ilçe or an unknown label. */
export function ilceOf(district: string | null | undefined): string[] {
  const key = fold(district).trim()
  if (!key) return []
  const direct = ILCE_BY_KEY.get(key)
  if (direct) return direct
  // 'Kadıköy, Moda' or 'Üsküdar / Kuzguncuk': every known part adds its ilçe
  const out = new Set<string>()
  for (const part of key.split(/[,/]+/)) for (const i of ILCE_BY_KEY.get(part.trim()) ?? []) out.add(i)
  return [...out]
}
