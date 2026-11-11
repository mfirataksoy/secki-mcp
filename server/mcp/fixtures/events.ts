/**
 * Hand-written events.json for the MCP tests: meta, about 20 events and the private top-level parts the
 * server must never expose (profile, alerts, hidden, flights, campaigns). A .ts module, not JSON, because
 * functions/tsconfig.json (which type-checks the tests) has no resolveJsonModule and no node:fs.
 *
 * Calendar: meta.today is Tuesday 2026-11-10. Wednesday 11, Friday 13, Saturday 14, Sunday 15 November.
 * Every event carries the backstage fields of the live file (source, score, lat/lng, image, parking) so the
 * privacy tests can check that none of them leaves the server.
 */
import type { SourceEvent, SourceFile } from '../indexer.ts'

type FixtureEvent = SourceEvent & {
  source: string
  score: number
  why: string
  lat?: number
  lng?: number
  image?: string
  parking?: { near: { name: string; m: number; walk: number; ispark: boolean }[] }
  far_future?: boolean
}

const base = (over: Partial<FixtureEvent> & Pick<FixtureEvent, 'id' | 'title' | 'start'>): FixtureEvent => ({
  venue: 'Mekân',
  district: 'Beşiktaş',
  cat: 'konser',
  source: 'Gizli Kaynak',
  url: 'https://organizer.example/etkinlik',
  price: null,
  score: 50,
  why: '',
  flags: [],
  is_new: false,
  lat: 41.0431,
  lng: 29.0099,
  image: 'https://organizer.example/poster.jpg',
  parking: { near: [{ name: 'İSPARK Gizli Otopark', m: 120, walk: 2, ispark: true }] },
  ...over,
})

export const EVENTS: FixtureEvent[] = [
  // a timed single event with a ticket page and transit; `why` carries a word ("tarih") search must not see
  base({
    id: 'e83d55d4cfe7',
    title: 'Soen: Memorial Tour',
    start: '2026-11-14T20:00',
    venue: 'Zorlu PSM',
    district: 'Beşiktaş',
    price: '1.500 TL',
    score: 92,
    why: 'Konser, tarih ile ilgili, Avrupa yakası',
    flags: ['yabanci'],
    ticket_url: 'https://tickets.example/soen',
    transit: {
      stops: [
        { name: 'Gayrettepe', lines: ['M2', 'M11'], kind: 'rail', m: 600, walk: 9 },
        { name: 'Zincirlikuyu', lines: ['Metrobüs'], kind: 'bus', m: 400, walk: 6 },
        { name: 'Levent', lines: ['M2'], kind: 'rail', m: 1100, walk: 15 },
        { name: 'Dördüncü Durak', lines: ['M6'], kind: 'rail', m: 1500, walk: 20 },
      ],
      note: null,
    },
  }),
  // a date-only, free event on the Asian side
  base({
    id: 'e00000000a02',
    title: 'Kadıköy Caz Günleri',
    start: '2026-11-12',
    venue: 'Moda Sahnesi',
    district: 'Kadıköy',
    price: 'Ücretsiz',
    score: 80,
    why: 'Caz, Anadolu yakası',
  }),
  // a multi-day exhibition that started last month (kind sergi under kultur); upper-case Turkish title
  base({
    id: 'e00000000a03',
    title: 'İSTANBUL FOTOĞRAFLARI',
    start: '2026-10-20',
    end: '2026-12-20',
    venue: 'Pera Müzesi',
    district: 'Beyoğlu',
    cat: 'kultur',
    kind: 'sergi',
    score: 70,
    approx: true,
  }),
  // a three-date series
  ...['2026-11-12T20:00', '2026-11-19T20:00', '2026-11-26T20:00'].map((start, i) =>
    base({
      id: `e00000000b0${i + 1}`,
      title: 'Hamlet',
      start,
      venue: 'Harbiye Muhsin Ertuğrul Sahnesi',
      district: 'Şişli',
      cat: 'tiyatro',
      price: "750 TL'den",
      score: 75,
      flags: ['seri'],
      series: { id: 'gizli-seri-1', count: 3 },
      lang: 'TR',
    }),
  ),
  // a din event (KVKK art. 6: never sent out as din, only as kultur / Kültür)
  base({
    id: 'e00000000a04',
    title: 'Tasavvuf Musikisi Akşamı',
    start: '2026-11-13T20:00',
    venue: 'Üsküdar Kültür Merkezi',
    district: 'Üsküdar',
    cat: 'din',
    price: 'Ücretsiz',
    score: 60,
  }),
  // a tech event with no venue, district or price (B2: 12 live events have venue null)
  base({
    id: 'e00000000a05',
    title: 'Yapay Zeka Buluşması',
    start: '2026-11-17T19:00',
    venue: null,
    district: null,
    cat: 'tech',
    url: null,
    score: 65,
  }),
  // a course (kurs is part of atolye) in Moda
  base({
    id: 'e00000000a06',
    title: 'Oyunculuk Kursu',
    start: '2026-11-16T18:00',
    venue: 'Moda Atölye',
    district: 'Moda',
    cat: 'kurs',
    price: '4.000 TL',
    score: 55,
  }),
  // a ceramics workshop: registration opens in the future, 3 spots left
  base({
    id: 'e00000000a07',
    title: 'Seramik Atölyesi',
    start: '2026-11-14T14:00',
    end: '2026-11-14T17:00',
    venue: 'Kil Evi',
    district: 'Kadıköy',
    cat: 'atolye',
    workshop: 'seramik',
    price: '900 TL',
    score: 68,
    flags: ['basvuru', 'yer:3'],
    reg_opens: '2026-11-12T10:00',
  }),
  // sold out
  base({
    id: 'e00000000a08',
    title: 'Duman Konseri',
    start: '2026-11-15T21:00',
    venue: 'Volkswagen Arena',
    district: 'Sarıyer',
    price: '2.000 TL',
    score: 99,
    flags: ['tukendi'],
  }),
  // full
  base({
    id: 'e00000000a09',
    title: 'Ebru Atölyesi',
    start: '2026-11-18T11:00',
    venue: 'Sanat Evi',
    district: 'Fatih',
    cat: 'atolye',
    workshop: 'geleneksel',
    price: '500 TL',
    score: 58,
    flags: ['dolu', 'basvuru'],
  }),
  // outside Istanbul (geo.ts sideOf -> null), forest ban flag
  base({
    id: 'e00000000a10',
    title: 'Yedigöller Doğa Yürüyüşü',
    start: '2026-11-15T07:00',
    venue: 'Yedigöller Milli Parkı',
    district: 'Bolu',
    cat: 'doga',
    price: '1.200 TL',
    score: 62,
    flags: ['orman_yasagi'],
  }),
  // upper-case IŞIK, language and doors
  base({
    id: 'e00000000a11',
    title: 'IŞIK VE GÖLGE',
    start: '2026-11-20T20:00',
    venue: 'Moda Sahnesi',
    district: 'Kadıköy',
    cat: 'dans',
    score: 57,
    lang: 'EN',
    doors: '19:30',
  }),
  // registration closed yesterday
  base({
    id: 'e00000000a12',
    title: 'Kuantum Fiziği Söyleşisi',
    start: '2026-11-25T18:30',
    venue: 'Boğaziçi Üniversitesi',
    district: 'Sarıyer',
    cat: 'akademik',
    price: 'Ücretsiz',
    score: 66,
    flags: ['basvuru'],
    reg_closes: '2026-11-09',
  }),
  // Friday 15:00 and Friday 19:00 (the weekend starts Friday 17:00)
  base({
    id: 'e00000000a13',
    title: 'Öğle Yogası',
    start: '2026-11-13T15:00',
    venue: 'Maçka Parkı',
    district: 'Beşiktaş',
    cat: 'yoga',
    price: 'Ücretsiz',
    score: 52,
  }),
  base({
    id: 'e00000000a14',
    title: 'Gülmek İlacaz: Stand-up Gecesi',
    start: '2026-11-13T19:00',
    venue: 'Moda Sahnesi',
    district: 'Kadıköy',
    cat: 'tiyatro',
    price: '600 TL',
    score: 54,
  }),
  // "konser" must match "Konserleri"; new since yesterday; 1-spot flag
  base({
    id: 'e00000000a15',
    title: 'Senfoni Konserleri: Mahler',
    start: '2026-11-21T20:00',
    venue: 'CRR Konser Salonu',
    district: 'Şişli',
    price: '350 TL',
    score: 74,
    is_new: true,
    flags: ['yer:1', 'gizli_bayrak'],
  }),
  // no category (models.py allows cat None) and an unknown one: both become diger
  base({ id: 'e00000000a16', title: 'Kategorisiz Buluşma', start: '2026-11-22', district: 'Beyoğlu', cat: null, score: 40 }),
  base({ id: 'e00000000a17', title: 'Yeni Tür Etkinlik', start: '2026-11-23T12:00', district: 'Beyoğlu', cat: 'yeni_tur', score: 41 }),
  // already over before meta.today: never indexed
  base({ id: 'e00000000a18', title: 'Geçen Haftanın Konseri', start: '2026-11-05T20:00', score: 100 }),
  // "caz" must find an English title (Jazz) and a title with neither word whose note starts "Caz konseri"
  base({
    id: 'e00000000a20',
    title: 'Blue Note Jazz Trio',
    start: '2026-11-19T21:30',
    venue: 'Nardis Jazz Club',
    district: 'Galata',
    price: '1.000 TL',
    score: 64,
    why: 'Yabancı caz, Avrupa yakası',
  }),
  base({
    id: 'e00000000a21',
    title: 'Tomot Shkoza Trio',
    start: '2026-11-20T21:30',
    venue: 'Nardis Jazz Kulübü',
    district: 'Galata',
    price: '1.000 TL',
    score: 63,
    why: 'Caz konseri, tarih ile ilgili',
  }),
  // an overnight event (Friday 21:00 to Saturday 01:00) in a neighbourhood geo.ts does not list (Yenibosna)
  base({
    id: 'e00000000a22',
    title: 'Milonga Gecesi',
    start: '2026-11-13T21:00',
    end: '2026-11-14T01:00',
    venue: 'Tango Evi',
    district: 'Yenibosna',
    cat: 'dans',
    score: 48,
  }),
  // control characters and an over-long title (third-party text)
  base({
    id: 'e00000000a19',
    title: `Uzun\nBaşlık\u0007 ${'çok '.repeat(60)}`,
    start: '2026-12-31T22:00',
    district: 'Beyoğlu',
    cat: 'gece',
    score: 45,
    why: 'Yılbaşı\n'.repeat(80),
  }),
]

export const FIXTURE = {
  meta: { today: '2026-11-10', generated_at: '2026-11-10T05:12:00+03:00' },
  profile: { name: 'Gizli Profil', topics: ['tarih', 'gizli konu'] },
  alerts: [{ type: 'uyari', text: 'Gizli uyarı' }],
  watch: [{ kind: 'sanatci', name: 'Gizli Sanatçı' }],
  events: EVENTS,
  hidden: [{ title: 'Çocuk Tiyatrosu', start: '2026-11-14T11:00', reason: 'çocuk' }],
  flights: [{ route: 'IST-ESB', price: 1000 }],
  campaigns: [{ title: 'Gizli Kampanya' }],
} satisfies SourceFile & Record<string, unknown>
