/**
 * Panel prompts.
 *
 * The requested shape is a single JSON object. It is a request, not a guarantee: only
 * some free models advertise structured output support, and the reader records honestly
 * when a member answers in prose instead.
 */

const SHAPE_EN = `Reply with one JSON object and nothing else:
{"position": "support" | "oppose" | "abstain", "reason": "at most 40 words", "confidence": 0-100}

"position" is your stance on the proposition, not whether you like it.
"confidence" is how sure you are of your own stance, 0 to 100.
Do not add keys, comments, or text outside the JSON object.`

const SHAPE_TR = `Yalnızca bir JSON nesnesi döndür, başka hiçbir şey yazma:
{"position": "support" | "oppose" | "abstain", "reason": "en fazla 40 kelime", "confidence": 0-100}

"position", öneriye karşı kendi duruşundur; öneriyi beğenip beğenmediğin değil.
"confidence", kendi duruşuna ne kadar güvendiğindir, 0 ile 100 arasında.
JSON nesnesinin dışına anahtar, açıklama ya da metin ekleme.`

export const SEAT_PROMPT_EN = `You are one member of a small deliberation panel.
Other members answer the same proposition independently; you will see their positions later.

${SHAPE_EN}`

export const SEAT_PROMPT_TR = `Küçük bir müzakere panelinin bir üyesisin.
Diğer üyeler aynı öneriye bağımsız olarak cevap verir; onların konumlarını sonra göreceksin.

${SHAPE_TR}`
