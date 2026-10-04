import type { Locale, Position } from '../core/types'

type Text = { en: string; tr: string }

export const copy = {
  title: { en: 'Agora', tr: 'Agora' },
  tagline: {
    en: 'OpenRouter’s free models answer alone, then answer each other, and you can read the whole argument.',
    tr: 'OpenRouter’ın ücretsiz modelleri önce tek başına, sonra birbirlerine cevap verir; tüm tartışmayı okuyabilirsin.',
  },

  keyHeading: { en: 'Your OpenRouter key', tr: 'OpenRouter anahtarın' },
  keyWhy: {
    en: 'Agora has no server. The key is stored in this browser and sent to openrouter.ai, nowhere else. Free models cost nothing, and the requests are charged against your own daily free quota.',
    tr: 'Agora’nın sunucusu yok. Anahtar bu tarayıcıda saklanır ve yalnızca openrouter.ai’ye gider. Ücretsiz modeller hiçbir şeye mal olmaz ve istekler kendi günlük ücretsiz kotandan düşülür.',
  },
  keyPlaceholder: { en: 'sk-or-v1-…', tr: 'sk-or-v1-…' },
  keySave: { en: 'Save and check quota', tr: 'Kaydet ve kotayı denetle' },
  keyForget: { en: 'Forget the key', tr: 'Anahtarı unut' },
  keyInvalid: { en: 'That key was rejected. Check that it starts with sk-or- and is still active.', tr: 'Anahtar kabul edilmedi. sk-or- ile başladığını ve etkin olduğunu denetle.' },

  quotaHeading: { en: 'Today’s free quota', tr: 'Bugünün ücretsiz kotası' },
  quotaNote: {
    en: '20 requests per minute, 50 per UTC day. A panel of N seats spends 2N requests: one blind answer and one floor answer each.',
    tr: 'Dakikada 20, UTC gününde 50 istek. N üyeli panel 2N istek harcar: her üye için bir kör cevap ve bir meydan cevabı.',
  },
  quotaUnknown: { en: 'Enter a key to read your quota.', tr: 'Kotanı görmek için anahtar gir.' },

  rosterHeading: { en: 'This week’s roster', tr: 'Bu haftanın kadrosu' },
  rosterNote: {
    en: 'The free catalogue rotates without notice. What follows was read from the public catalogue just now.',
    tr: 'Ücretsiz katalog haber verilmeden değişir. Aşağıdaki liste az önce herkese açık katalogdan okundu.',
  },
  rosterExcluded: { en: 'Left off the panel', tr: 'Panelin dışında' },
  rosterEmpty: { en: 'No free model could be read.', tr: 'Hiçbir ücretsiz model okunamadı.' },
  capability: { en: 'Reports logprobs', tr: 'logprobs verir' },
  structuredOnly: { en: 'Only this many models can return a JSON object as asked. The rest answer in prose; Agora says so instead of hiding it.', tr: 'Yalnızca bu kadar model istendiği gibi bir JSON nesnesi döndürebilir. Diğerleri düz metinle yanıt verir; Agora bunu gizlemek yerine söyler.' },

  formHeading: { en: 'Put a proposition to the panel', tr: 'Öneriyi panele koy' },
  propositionLabel: { en: 'Proposition', tr: 'Öneri' },
  propositionPlaceholder: {
    en: 'The free tier is a research instrument, not a free tier.',
    tr: 'Ücretsiz katman bir araştırma enstrümanıdır, bedava bir katman değil.',
  },
  contextLabel: { en: 'Context (optional)', tr: 'Bağlam (isteğe bağlı)' },
  seatsLabel: { en: 'Seats', tr: 'Koltuk' },
  willCost: { en: 'This run costs', tr: 'Bu koşu harcar' },
  requests: { en: 'requests', tr: 'istek' },
  run: { en: 'Convene the panel', tr: 'Paneli topla' },
  running: { en: 'In session…', tr: 'Oturum sürüyor…' },
  needKey: { en: 'Save a key first.', tr: 'Önce bir anahtar kaydet.' },

  phaseBlind: { en: 'First round · every seat answers alone', tr: 'Birinci tur · her üye tek başına cevaplıyor' },
  phaseFloor: { en: 'Floor round · seats answer each other', tr: 'Meydan turu · üyeler birbirlerine cevap veriyor' },
  seat: { en: 'Seat', tr: 'Koltuk' },
  changed: { en: 'moved', tr: 'değiştirdi' },
  stayed: { en: 'held', tr: 'korudu' },
  nonCompliant: { en: 'answered in prose', tr: 'düz metinle yanıtladı' },
  measured: { en: 'measured from logprobs', tr: 'logprobs’tan ölçüldü' },
  selfReported: { en: 'self-reported', tr: 'kendi beyanı' },
  noConfidence: { en: 'no confidence given', tr: 'güven vermedi' },
  unreadable: { en: 'could not be read', tr: 'okunamadı' },

  verdictHeading: { en: 'The count', tr: 'Sayım' },
  agreement: { en: 'Agreement among deciding seats', tr: 'Karar veren koltuklar arasında uzlaşı' },
  dissentShare: { en: 'Dissenting share', tr: 'Karşı görüş payı' },
  dissentHeading: { en: 'Dissent, kept visible', tr: 'Karşı görüş, görünür tutuldu' },
  noDissent: { en: 'Every readable seat took the same position.', tr: 'Okunabilen her koltuk aynı konumda.' },
  tallyNote: {
    en: 'Agora counts the floor round itself. No panel member writes the verdict, so nobody judges their own vote.',
    tr: 'Sayımı Agora kendisi yapar. Hiçbir panel üyesi kararı yazmaz; yani kimse kendi oyunu yargılamaz.',
  },

  archiveHeading: { en: 'Your record', tr: 'Kaydın' },
  archiveEmpty: { en: 'No session yet. The first one costs the least, because the catalogue is fresh.', tr: 'Henüz oturum yok. İlk oturum en ucuzu, çünkü katalog taze.' },
  archiveStored: { en: 'Stored in this browser only. The shared timeline arrives with the archive service.', tr: 'Yalnızca bu tarayıcıda saklanır. Paylaşımlı zaman çizelgesi arşiv servisiyle gelir.' },
  clearArchive: { en: 'Clear', tr: 'Temizle' },
  reask: { en: 'Re-ask with today’s roster', tr: 'Bugünün kadrosuyla yeniden sor' },

  positionLabel: {
    support: { en: 'For', tr: 'Destek' },
    oppose: { en: 'Against', tr: 'Karşı' },
    abstain: { en: 'Abstain', tr: 'Çekimser' },
    unclear: { en: 'Unreadable', tr: 'Okunamadı' },
  } satisfies Record<Position, Text>,

  footer: {
    en: 'Agreement is not correctness. These are small free models, and their roster changes every week.',
    tr: 'Uzlaşı doğruluk değildir. Bunlar küçük ücretsiz modellerdir ve kadrosu her hafta değişir.',
  },
} as const

export const text = (value: Text, locale: Locale): string => value[locale]
