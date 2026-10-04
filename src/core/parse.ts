import type { ConfidenceBasis, Position } from './types'

export interface ParsedProposal {
  proposition: string
  reason: string
  formatCompliant: boolean
  raw: string
}

export interface ParsedVote {
  position: Position
  reason: string
  confidence: number | null
  confidenceBasis: ConfidenceBasis
  addressed: string[]
  formatCompliant: boolean
}

/** Seat letters Agora addresses members by. A-J only, so a stray capital is not a seat. */
const SEAT_LABELS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])

/**
 * Read which seats an answer names.
 *
 * This is what turns a row of parallel statements into a debate: without it there is no
 * way to show that B answered C rather than everyone talking past each other. The JSON
 * `addressed` field is preferred; otherwise the prose forms below are used, and an
 * answer that names nobody is recorded as addressing nobody rather than being guessed at.
 */
export const readAddressed = (payload: Record<string, unknown> | null, raw: string): string[] => {
  const found = new Set<string>()

  if (payload && Array.isArray(payload.addressed)) {
    for (const value of payload.addressed) {
      if (typeof value === 'string' && SEAT_LABELS.has(value.trim().toUpperCase())) {
        found.add(value.trim().toUpperCase())
      }
    }
  }
  if (found.size > 0) return [...found].sort()

  const patterns = [
    /\b(?:seat|member|üye|koltuk)\s+\(?([A-J])\)?/gi,
    /^\s*[-–—]?\s*\(?([A-J])\)?\s*[:.、]/gm,
    /\(([A-J])\)/g,
    /\[([A-J])\]/g,
  ]
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const label = match[1].toUpperCase()
      if (SEAT_LABELS.has(label)) found.add(label)
    }
  }
  return [...found].sort()
}

/** Read one agenda proposal, recovering a plain-text answer rather than discarding it. */
export const readProposal = (raw: string): ParsedProposal => {
  const payload = extractJson(raw)
  if (payload) {
    const proposition = typeof payload.proposition === 'string' ? payload.proposition.trim() : ''
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
    if (proposition) return { proposition, reason: reason || raw.trim(), formatCompliant: true, raw }
  }

  const lines = stripFences(raw)
    .split('\n')
    .map((line) => line.replace(/^[-–—*\s]+/, '').trim())
    .filter(Boolean)

  if (lines.length === 0) return { proposition: '', reason: '', formatCompliant: false, raw }
  return { proposition: lines[0], reason: lines.slice(1).join(' ').trim(), formatCompliant: false, raw }
}

const SUPPORT_WORDS = [
  'support',
  'supports',
  'supported',
  'yes',
  'true',
  'agree',
  'agrees',
  'endorse',
  'onay',
  'destek',
  'evet',
  'katiliyorum',
  'doğru',
]

const OPPOSE_WORDS = [
  'oppose',
  'opposed',
  'no',
  'false',
  'disagree',
  'disagrees',
  'reject',
  'against',
  'karşı',
  'hayır',
  'ret',
  'katılmıyorum',
  'yanlış',
]

const ABSTAIN_WORDS = ['abstain', 'abstains', 'abstention', 'pass', 'cekimser', 'çekimser', 'kararsiz', 'kararsız']

const UNKNOWN_WORDS = ['unknown', 'unclear', 'belirsiz', 'bilinmiyor', 'none', 'yok']

const stripFences = (text: string): string =>
  text.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim()

/** Read a balanced `{...}` run starting at `start`, ignoring braces inside quoted strings. */
const balancedFrom = (text: string, start: number): string | null => {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

/**
 * Every balanced object candidate, in the order they appear.
 *
 * A model that writes `the idea is "{x}" and my answer is {…}` puts a decoy brace
 * before the real one, so returning only the first balanced run would give up before
 * trying the object that actually parses.
 */
const balancedObjects = (text: string): string[] => {
  const found: string[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue
    const run = balancedFrom(text, index)
    if (run) found.push(run)
  }
  return found
}

export const extractJson = (raw: string): Record<string, unknown> | null => {
  const cleaned = stripFences(raw)
  for (const candidate of [cleaned, ...balancedObjects(cleaned)]) {
    if (!candidate) continue
    try {
      const parsed: unknown = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

const normalizeToken = (value: string): string =>
  value.toLowerCase().trim().replace(/[.,;:!?¿¡"'`]/g, '').replace(/\s+/g, ' ')

/** Map a free-form position token onto the four-value vocabulary. */
export const normalizePosition = (value: unknown): Position => {
  if (typeof value !== 'string') return 'unclear'
  const token = normalizeToken(value)
  if (!token) return 'unclear'
  if (SUPPORT_WORDS.includes(token)) return 'support'
  if (OPPOSE_WORDS.includes(token)) return 'oppose'
  if (ABSTAIN_WORDS.includes(token)) return 'abstain'
  if (UNKNOWN_WORDS.includes(token)) return 'unclear'
  return 'unclear'
}

const clampConfidence = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

/**
 * Recover a position from prose when the model ignored the requested shape.
 *
 * A model that answered in sentences still gave a position; silently counting it as
 * `unclear` would understate disagreement, and silently trusting a guessed word would
 * overstate it. So the guess is marked non-compliant and surfaced in the interface.
 */
export const positionFromProse = (raw: string): Position => {
  const labelled = raw.match(
    /(?:position|karar|kararı|sonuç|sonuc|verdict)\s*[:\-–]\s*([a-zçğıöşüA-ZÇĞİÖŞÜ\s]{2,24})/i,
  )
  if (labelled) {
    const direct = normalizePosition(labelled[1])
    if (direct !== 'unclear') return direct
  }

  // Compare only the leading word: "Support. The second clause…" is a stance, while
  // a token built from the whole first clause would never match a single-word list.
  const head = normalizeToken(raw.slice(0, 60).split(/[\s.,;:!?¿¡"'`]/)[0] ?? '')
  if (SUPPORT_WORDS.includes(head)) return 'support'
  if (OPPOSE_WORDS.includes(head)) return 'oppose'
  if (ABSTAIN_WORDS.includes(head)) return 'abstain'

  return 'unclear'
}

/** Map a mean token log-probability onto a 0..100 confidence for models that report logprobs. */
export const confidenceFromLogprobs = (meanLogprob: number | null): number | null => {
  if (meanLogprob === null || !Number.isFinite(meanLogprob)) return null
  const probability = Math.exp(Math.max(-20, Math.min(0, meanLogprob)))
  return Math.max(0, Math.min(100, Math.round(probability * 100)))
}

/**
 * Read one panel answer.
 *
 * `measuredLogprob` is only passed when the member advertises `logprobs`; otherwise the
 * confidence is the model's own claim and is labelled `self-reported` so the two are
 * never presented as the same kind of number.
 */
export const readVote = (
  raw: string,
  options: { measuredLogprob?: number | null; ownSeat?: string } = {},
): ParsedVote => {
  const ownSeat = options.ownSeat
  const measured = confidenceFromLogprobs(options.measuredLogprob ?? null)
  const payload = extractJson(raw)

  if (payload) {
    const position = normalizePosition(payload.position ?? payload.vote ?? payload.decision)
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
    const stated = clampConfidence(payload.confidence)

    return {
      position,
      reason: reason || raw.trim(),
      confidence: measured ?? stated,
      confidenceBasis: measured !== null ? 'measured' : stated !== null ? 'self-reported' : 'absent',
      addressed: readAddressed(payload, raw).filter((label) => label !== ownSeat),
      formatCompliant: true,
    }
  }

  return {
    position: positionFromProse(raw),
    reason: raw.trim(),
    confidence: measured,
    confidenceBasis: measured !== null ? 'measured' : 'absent',
    addressed: readAddressed(null, raw).filter((label) => label !== ownSeat),
    formatCompliant: false,
  }
}
