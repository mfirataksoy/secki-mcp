/**
 * Which side of the Bosphorus a district or neighbourhood is on. Owner: shell.
 * Mirrors the pipeline's venues.py lists (neighbourhood-level labels as written in
 * `event.district`). The pipeline subtracts points for recurring activities on the
 * Anatolian side; the UI uses this to show that at a glance.
 *
 *   sideOf('Kadıköy') -> 'anadolu', sideOf('Beşiktaş') -> 'avrupa', sideOf('Bolu') -> null
 */
import { fold } from './text'

export type Side = 'avrupa' | 'anadolu'

const EUROPE = `
Arnavutköy Avcılar Bağcılar Bahçelievler Bakırköy Başakşehir Bayrampaşa Beşiktaş Beylikdüzü Beyoğlu
Büyükçekmece Çatalca Esenler Esenyurt Eyüpsultan Eyüp Fatih Gaziosmanpaşa Güngören Kağıthane
Küçükçekmece Sarıyer Silivri Sultangazi Şişli Zeytinburnu
Karaköy Galata Şişhane Tepebaşı Tünel Cihangir Taksim Harbiye Nişantaşı Teşvikiye Maçka Bomonti
Mecidiyeköy Zincirlikuyu Levent Maslak Ayazağa Etiler Bebek Ortaköy Kuruçeşme Rumelihisarı Hisarüstü
Emirgan İstinye Yeniköy Tarabya Kilyos Zekeriyaköy Dolapdere Tophane Kasımpaşa Hasköy Haliç Fındıklı
Kabataş Dolmabahçe Gümüşsuyu Beyazıt Sultanahmet Eminönü Sirkeci Balat Fener Cibali Unkapanı Vefa
Aksaray Laleli Yenikapı Kumkapı Samatya Kazlıçeşme Yedikule Topkapı Yeşilköy Florya Ataköy Bahçeşehir
Göktürk Kemerburgaz Akatlar Ulus Kurtuluş Feriköy Pangaltı Gayrettepe Esentepe Fulya Balmumcu Yıldız
Çırağan Seyrantepe Vadistanbul Hasdal Bahçeköy Okmeydanı Piyalepaşa Elmadağ Osmanbey Pera Salıpazarı
Asmalımescit Kuledibi Fındıkzade Çapa Yeşilyurt Halkalı Kocamustafapaşa Sütlüce Rumelifeneri
`

const ASIA = `
Adalar Ataşehir Beykoz Çekmeköy Kadıköy Kartal Maltepe Pendik Sancaktepe Sultanbeyli Şile Tuzla Ümraniye
Üsküdar Moda Fenerbahçe Kalamış Caddebostan Göztepe Erenköy Suadiye Bostancı Kozyatağı Hasanpaşa
Yeldeğirmeni Acıbadem Koşuyolu Altunizade Bağlarbaşı Kuzguncuk Çengelköy Beylerbeyi Kandilli Vaniköy
Anadoluhisarı Kanlıca Çubuklu Paşabahçe Riva Polonezköy Küçükyalı İdealtepe Dragos Cevizli Soğanlık
Kurtköy Ağva Büyükada Heybeliada Burgazada Kınalıada Çamlıca Kısıklı İçerenköy Kayışdağı Ferhatpaşa
Haydarpaşa Feneryolu Selamiçeşme Ziverbey Fikirtepe Söğütlüçeşme Rasimpaşa Osmanağa Bahariye Kuşdili
Harem Selimiye Salacak Validebağ Sahrayıcedit Bulgurlu Aydos Esenkent Yakacık Gebze
Kavacık Caferağa Uğurmumcu Samandıra
`

const MULTI: Record<string, Side> = {
  'Büyük Çamlıca': 'anadolu',
  'Bağdat Caddesi': 'anadolu',
  'Batı Ataşehir': 'anadolu',
  'Anadolu Kavağı': 'anadolu',
  'Rumeli Feneri': 'avrupa',
  'Rumeli Kavağı': 'avrupa',
  'Belgrad Ormanı': 'avrupa',
}

const SIDE_BY_KEY = new Map<string, Side>()
for (const n of EUROPE.split(/\s+/)) if (n) SIDE_BY_KEY.set(fold(n), 'avrupa')
for (const n of ASIA.split(/\s+/)) if (n) SIDE_BY_KEY.set(fold(n), 'anadolu')
for (const [n, s] of Object.entries(MULTI)) SIDE_BY_KEY.set(fold(n), s)

/** Side for a district label ('Kadıköy', 'Batı Ataşehir'), or null when unknown / outside İstanbul. */
export function sideOf(district: string | null | undefined): Side | null {
  const key = fold(district).trim()
  if (!key) return null
  const direct = SIDE_BY_KEY.get(key)
  if (direct) return direct
  // 'Kadıköy, Moda' or 'Üsküdar / Kuzguncuk': the first known part decides.
  for (const part of key.split(/[,/]+/)) {
    const s = SIDE_BY_KEY.get(part.trim())
    if (s) return s
  }
  return null
}

export const SIDE_LABEL: Record<Side, string> = { avrupa: 'Avrupa yakası', anadolu: 'Anadolu yakası' }
