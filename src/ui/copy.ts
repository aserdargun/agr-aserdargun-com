import type { Locale, Position } from '../core/types'

type Text = { en: string; tr: string }

export const copy = {
  title: { en: 'Agora', tr: 'Agora' },
  tagline: {
    en: 'OpenRouter’s free models argue with each other until they agree, hold, or run out of room. You can read the whole argument.',
    tr: 'OpenRouter’ın ücretsiz modelleri birbirleriyle tartışır; uzlaşırlar, direnirler ya da yere bağlanırlar. Tüm tartışmayı okuyabilirsin.',
  },

  keyHeading: { en: 'Your OpenRouter key', tr: 'OpenRouter anahtarın' },
  keyWhy: {
    en: 'Agora has no server. The key is stored in this browser and sent to openrouter.ai, nowhere else. Free models cost nothing, and every request is charged against your own daily free quota.',
    tr: 'Agora’nın sunucusu yok. Anahtar bu tarayıcıda saklanır ve yalnızca openrouter.ai’ye gider. Ücretsiz modeller hiçbir şeye mal olmaz ve her istek kendi günlük kotandan düşülür.',
  },
  keyPlaceholder: { en: 'sk-or-v1-…', tr: 'sk-or-v1-…' },
  keySave: { en: 'Save and check quota', tr: 'Kaydet ve kotayı denetle' },
  keyForget: { en: 'Forget the key', tr: 'Anahtarı unut' },
  keyInvalid: { en: 'That key was rejected. Check that it starts with sk-or- and is still active.', tr: 'Anahtar kabul edilmedi. sk-or- ile başladığını ve etkin olduğunu denetle.' },

  quotaHeading: { en: 'Today’s free quota', tr: 'Bugünün ücretsiz kotası' },
  quotaNote: {
    en: '20 requests per minute, 50 per UTC day. Two requests a seat to argue, plus one more for each seat that refused to join the leading position, plus the agenda round when the panel picks the topic.',
    tr: 'Dakikada 20, UTC gününde 50 istek. Koltuk başına iki istek, öne çıkan konuma katılmayı reddeden her koltuk için bir istek daha, konuyu panel seçerse bir gündem turu.',
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
  structuredOnly: {
    en: 'Only this many models can return a JSON object as asked. The rest answer in prose; Agora says so instead of hiding it.',
    tr: 'Yalnızca bu kadar model istendiği gibi bir JSON nesnesi döndürebilir. Diğerleri düz metinle yanıt verir; Agora bunu gizlemek yerine söyler.',
  },

  topicHeading: { en: 'What should the panel argue about?', tr: 'Panel ne hakkında tartışsın?' },
  topicGiven: { en: 'I give the topic', tr: 'Konuyu ben veririm' },
  topicPanel: { en: 'The panel chooses', tr: 'Panel kendi konusunu seçer' },
  topicPanelNote: {
    en: 'Every seat proposes one claim it thinks the panel is well placed to argue about, and you pick which one to deliberate. Agora also names the largest group of similar proposals.',
    tr: 'Her üye, panelin tartışmaya uygun olduğunu düşündüğü bir iddia ileri sürer ve hangisi üzerinde tartışılacağına sen karar verirsin. Agora ayrıca benzer önerilerin en büyük grubunu da gösterir.',
  },
  propositionLabel: { en: 'Proposition', tr: 'Öneri' },
  propositionPlaceholder: {
    en: 'The free tier is a research instrument, not a free tier.',
    tr: 'Ücretsiz katman bir araştırma enstrümanıdır, bedava bir katman değil.',
  },
  contextLabel: { en: 'Context (optional)', tr: 'Bağlam (isteğe bağlı)' },
  seatsLabel: { en: 'Seats', tr: 'Koltuk' },
  willCost: { en: 'This run costs', tr: 'Bu koşu harcar' },
  requests: { en: 'requests', tr: 'istek' },
  costRange: { en: 'at least', tr: 'en az' },
  run: { en: 'Convene the panel', tr: 'Paneli topla' },
  running: { en: 'In session…', tr: 'Oturum sürüyor…' },
  needKey: { en: 'Save a key first.', tr: 'Önce bir anahtar kaydet.' },

  agendaHeading: { en: 'The panel proposes', tr: 'Panel öneriyor' },
  agendaNote: {
    en: 'Each seat proposed one claim. Proposals that overlap in wording are grouped; the largest group is Agora’s pick, but you choose what is debated.',
    tr: 'Her üye bir iddia ileri sürdü. İfadeleri örtüşen öneriler gruplanır; en büyük grup Agora’nın seçimidir, ama ne üzerinde tartışılacağına sen karar verirsin.',
  },
  agendaCluster: { en: 'similar proposals', tr: 'benzer öneri' },
  agendaChosenBy: { en: 'Agora’s pick', tr: 'Agora’nın seçimi' },
  agendaEmpty: {
    en: 'No seat returned a usable proposition, so the panel has no topic to debate.',
    tr: 'Hiçbir koltuk kullanılabilir bir öneri vermedi, panelin tartışacak bir konusu yok.',
  },
  debateThis: { en: 'Debate this', tr: 'Bunu tartış' },

  roundAgenda: { en: 'Agenda round · the panel chooses the topic', tr: 'Gündem turu · panel konuyu seçiyor' },
  roundBlind: { en: 'First round · every seat answers alone', tr: 'Birinci tur · her üye tek başına cevaplıyor' },
  roundFloor: { en: 'Second round · seats answer each other', tr: 'İkinci tur · üyeler birbirlerine cevap veriyor' },
  roundConvergence: { en: 'Final round · the dissenters answer once more', tr: 'Son tur · karşı çıkanlar bir kez daha cevaplıyor' },
  seat: { en: 'Seat', tr: 'Koltuk' },
  changed: { en: 'moved', tr: 'değiştirdi' },
  stayed: { en: 'held', tr: 'korudu' },
  answersTo: { en: 'answers', tr: 'cevap veriyor' },
  answeredNobody: { en: 'named nobody', tr: 'kimseye cevap vermedi' },
  nonCompliant: { en: 'answered in prose', tr: 'düz metinle yanıtladı' },
  measured: { en: 'measured from logprobs', tr: 'logprobs’tan ölçüldü' },
  selfReported: { en: 'self-reported', tr: 'kendi beyanı' },
  noConfidence: { en: 'no confidence given', tr: 'güven vermedi' },
  unreadable: { en: 'could not be read', tr: 'okunamadı' },

  convergenceHeading: { en: 'Did they agree?', tr: 'Uzlaştılar mı?' },
  convergenceReached: { en: 'The panel reached agreement at or above the stated bar.', tr: 'Panel, belirtilen eşiğin üzerinde uzlaştı.' },
  convergenceNotReached: { en: 'The panel did not reach the stated bar.', tr: 'Panel belirtilen eşiğe ulaşmadı.' },
  convergenceBar: { en: 'Bar for agreement', tr: 'Uzlaşı eşiği' },
  convergenceMoved: { en: 'Moved in the final round', tr: 'Son turda konum değiştiren' },
  convergenceHeld: { en: 'Held their position', tr: 'Konumunu koruyan' },
  convergenceNone: { en: 'Nobody disagreed, so no final round was needed.', tr: 'Kimse karşı çıkmadı, son tur gerekmedi.' },
  convergenceUndecided: { en: 'The panel reached no position to agree on.', tr: 'Panelin üzerinde anlaşacağı bir konum oluşmadı.' },

  verdictHeading: { en: 'The count', tr: 'Sayım' },
  agreement: { en: 'Agreement among deciding seats', tr: 'Karar veren koltuklar arasında uzlaşı' },
  dissentShare: { en: 'Dissenting share', tr: 'Karşı görüş payı' },
  dissentHeading: { en: 'Dissent, kept visible', tr: 'Karşı görüş, görünür tutuldu' },
  noDissent: { en: 'Every readable seat took the same position.', tr: 'Okunabilen her koltuk aynı konumda.' },
  tallyNote: {
    en: 'Agora counts the rounds itself. No panel member writes the verdict, so nobody judges their own vote.',
    tr: 'Sayımı Agora kendisi yapar. Hiçbir panel üyesi kararı yazmaz; yani kimse kendi oyunu yargılamaz.',
  },

  exportHeading: { en: 'Archive this session', tr: 'Bu oturumu arşivle' },
  exportButton: { en: 'Download the record', tr: 'Kaydı indir' },
  exportNote: {
    en: 'The record is re-checked against the archive contract before it is offered, and the shared timeline only accepts a record whose own free-request count proves its cost.',
    tr: 'Kayıt arşiv sözleşmesine göre yeniden denetlenir ve paylaşımlı zaman çizelgesi yalnızca kendi ücretsiz istek sayacı maliyetini kanıtlayan kaydı kabul eder.',
  },
  exportRefused: { en: 'This session cannot be archived:', tr: 'Bu oturum arşivlenemez:' },
  exportNoQuota: {
    en: 'The session has no quota snapshot, so it cannot prove what it cost.',
    tr: 'Oturumun kota anlık görüntüsü yok, bu yüzden maliyetini kanıtlayamıyor.',
  },

  timelineHeading: { en: 'The shared record', tr: 'Paylaşımlı kayıt' },
  timelineNote: {
    en: 'Verdicts filed in the repository. When a proposition is answered more than once, the count from each roster sits next to the others.',
    tr: 'Depoya kaydedilmiş kararlar. Bir öneri birden çok kez yanıtlandığında her kadronun sayımı yan yana durur.',
  },
  timelineEmpty: { en: 'No verdict has been filed yet.', tr: 'Henüz kaydedilmiş bir karar yok.' },
  mySessions: { en: 'Your sessions in this browser', tr: 'Bu tarayıcıdaki oturumlarınız' },

  clearArchive: { en: 'Clear', tr: 'Temizle' },
  reask: { en: 'Debate this again', tr: 'Bunu tekrar tartış' },

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
