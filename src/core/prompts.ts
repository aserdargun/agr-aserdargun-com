/**
 * Panel prompts, one per round kind.
 *
 * Two rules shape all of them:
 *
 * 1. Model names never appear. Seats are letters. A member that can read a brand has
 *    something to defer to, so the floor round only ever shows the other letters.
 * 2. The requested shape is a request, not a guarantee. Only a minority of the free
 *    roster advertises structured output, so the reader recovers prose answers and marks
 *    them non-compliant rather than discarding the argument.
 */

const SHAPE_EN = (reason: string, extra = '') => `Reply with one JSON object and nothing else:
{"position": "support" | "oppose" | "abstain", "reason": "${reason}", "confidence": 0-100${extra}}

"position" is your stance on the proposition, not whether you like it.
"confidence" is how sure you are of your own stance, 0 to 100.
Do not add keys, comments, or text outside the JSON object.`

const SHAPE_TR = (reason: string, extra = '') => `Yalnızca bir JSON nesnesi döndür, başka hiçbir şey yazma:
{"position": "support" | "oppose" | "abstain", "reason": "${reason}", "confidence": 0-100${extra}}

"position", öneriye karşı kendi duruşundur; öneriyi beğenip beğenmediğin değil.
"confidence", kendi duruşuna ne kadar güvendiğindir, 0 ile 100 arasında.
JSON nesnesinin dışına anahtar, açıklama ya da metin ekleme.`

const AGENDA_SHAPE_EN = `Reply with one JSON object and nothing else:
{"proposition": "one debatable claim, at most 20 words", "reason": "why the panel should settle this, at most 25 words"}

A proposition is a claim that can be supported or opposed. Not a question, not a topic label.
Something like "Regular code review is cheaper than testing" is a proposition.
"Scrum methodology" is not. Do not add keys, comments, or text outside the JSON object.`

const AGENDA_SHAPE_TR = `Yalnızca bir JSON nesnesi döndür, başka hiçbir şey yazma:
{"proposition": "tek bir tartışılabilir iddia, en fazla 20 kelime", "reason": "panelin neden bunu gündeme alması gerektiği, en fazla 25 kelime"}

Öneri, desteklenebilen ya da karşı çıkılabilen bir iddiadır. Soru değil, konu etiketi değil.
"Standart kod incelemesi test etmekten ucuzdur" bir öneridir.
"Scrum metodolojisi" değildir. JSON nesnesinin dışına anahtar, açıklama ya da metin ekleme.`

/** Round 0. The panel is allowed to choose what it argues about. */
export const AGENDA_PROMPT_EN = `You are one member of a small deliberation panel. The panel has no topic yet.
Propose one proposition this panel is well placed to argue about, and that a free-model
panel could genuinely disagree on. Avoid questions that need private data or current
events, and avoid anything that needs a single number to be answered.

${AGENDA_SHAPE_EN}`

export const AGENDA_PROMPT_TR = `Küçük bir müzakere panelinin bir üyesisin. Panelin henüz bir konusu yok.
Bu panelin tartışmaya uygun bir öneri ileri sür: özel veri ya da güncel olay gerektirmesin,
ücretsiz modellerin gerçekten ayrışabileceği bir konu olsun. Tek bir sayıyla yanıtlanacak
sorulardan ve anahtar gerektiren sorulardan kaçın.

${AGENDA_SHAPE_TR}`

/** Round 1. No cross-talk is possible yet, and no letter is known. */
export const BLIND_PROMPT_EN = `You are one member of a small deliberation panel.
Other members answer the same proposition independently. You will see their positions later.

${SHAPE_EN('at most 40 words')}`

export const BLIND_PROMPT_TR = `Küçük bir müzakere panelinin bir üyesisin.
Diğer üyeler aynı öneriye bağımsız olarak cevap verir; onların konumlarını sonra göreceksin.

${SHAPE_TR('en fazla 40 kelime')}`

/** Round 2. The debate proper: a seat must name who it is answering. */
export const FLOOR_PROMPT_EN = `You are one member of a small deliberation panel in its second round.
You will be given the first-round positions of the other seats, under their seat letters.
Answer them. Name at least one seat letter in "addressed" and say why you agree or disagree
with that specific argument. If you still hold your own position against the room, say what
the others have not understood.

${SHAPE_EN('at most 80 words', ', "addressed": ["B", "D"]')}`

export const FLOOR_PROMPT_TR = `Künek bir müzakere panelinin ikinci turundasın.
Sana diğer koltukların birinci tur konumları, koltuk harfleriyle verilecek.
Onlara cevap ver. "addressed" içinde en az bir koltuk harfi belirt ve o specific argümana
neden katıldığını ya da neden katılmadığını yaz. Oda karşı kendi konumunda ısrar ediyorsan,
diğerlerinin anlamadığı şeyi söyle.

${SHAPE_TR('en fazla 80 kelime', ', "addressed": ["B", "D"]')}`

/** Round 3. Only seats that dissented are invited. Move, or hold, and give the reason. */
export const CONVERGENCE_PROMPT_EN = `You are one member of a small deliberation panel, invited back for a final round.
You did not join the leading position last round. The leading position and its arguments are given below.

Decide: either move to the leading position, or hold your own. Either is a legitimate outcome.
- If you move, say which argument changed your mind.
- If you hold, say the strongest argument against you that you still think is wrong, and why.
Name at least one seat letter in "addressed". Do not split the difference to be agreeable.

${SHAPE_EN('at most 60 words', ', "addressed": ["B"]')}`

export const CONVERGENCE_PROMPT_TR = `Küçük bir müzakere panelinin bir üyesisin, son tur için geri çağrıldın.
Geçen turda önde gelen konuma katılmadın. Önde gelen konum ve onun argümanları aşağıda.

Karar ver: ya önde gelen konuma geç, ya da kendi konumunda kal. İkisi de meşru bir sonuçtur.
- Geçersen, hangi argümanın seni değiştirdiğini söyle.
- Kalırsan, kendine karşı en güçlü argümanın hangisi olduğunu ve neden hâlâ yanlış saydığını söyle.
"addressed" içinde en az bir koltuk harfi belirt. Görünmek için orta yol tutma.

${SHAPE_TR('en fazla 60 kelime', ', "addressed": ["B"]')}`
