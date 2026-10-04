import type {
  FloorTurn,
  Locale,
  PanelSeat,
  Position,
  Quota,
  RosterEntry,
  Tally,
  Vote,
} from './types'
import { SEAT_LABELS } from './types'
import { readVote } from './parse'
import { SEAT_PROMPT_TR, SEAT_PROMPT_EN } from './prompts'

export interface Proposition {
  proposition: string
  context?: string
}

export const buildPanel = (members: RosterEntry[], seatCount: number): PanelSeat[] =>
  members.slice(0, seatCount).map((member, index) => ({
    label: SEAT_LABELS[index] ?? `S${index + 1}`,
    member,
  }))

const promptFor = (locale: Locale): string => (locale === 'tr' ? SEAT_PROMPT_TR : SEAT_PROMPT_EN)

const blindUserMessage = (motion: Proposition, locale: Locale): string => {
  const context = motion.context?.trim()
  return [
    locale === 'tr' ? `Öneri: ${motion.proposition}` : `Proposition: ${motion.proposition}`,
    context ? (locale === 'tr' ? `Bağlam: ${context}` : `Context: ${context}`) : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The floor message shows other positions under their blind seat labels, never under
 * their model names. A panelist that can read "nvidia/nemotron-3-ultra" has something
 * to defer to; a panelist that can only read "Member C argued for…" has to argue.
 */
const floorUserMessage = (
  motion: Proposition,
  others: { label: string; position: Position; reason: string }[],
  locale: Locale,
): string => {
  const lines = others.map((other) => `- ${other.label}: ${other.position} — ${other.reason}`)
  const header =
    locale === 'tr'
      ? 'Diğer üyelerin birinci tur konumları (üye etiketleriyle):'
      : 'Other members’ first-round positions, under their seat labels:'
  return [blindUserMessage(motion, locale), '', header, ...lines].join('\n')
}

export const readFloorTurn = (raw: string, first: Vote, addressed: string[], measured: number | null): FloorTurn => {
  const parsed = readVote(raw, { measuredLogprob: measured })
  return {
    ...parsed,
    raw,
    seat: first.seat,
    memberId: first.memberId,
    changed: parsed.position !== first.position,
    firstRoundPosition: first.position,
    addressed,
  }
}

const DEFAULT_WEIGHT = 1

/**
 * Count the floor round, falling back to the blind round only for a seat that failed
 * outright. Weight is flat: a stated confidence is reported as a descriptive
 * statistic beside the vote rather than silently rescaling the count.
 */
export const tally = (blind: Vote[], floor: FloorTurn[]): Tally => {
  const counts: Record<Position, number> = { support: 0, oppose: 0, abstain: 0, unclear: 0 }
  const weights: Record<Position, number> = { support: 0, oppose: 0, abstain: 0, unclear: 0 }
  const unreadableSeats: string[] = []
  const dissentingSeats: string[] = []

  const effective = new Map<string, Position>()
  for (const vote of blind) effective.set(vote.seat, vote.position)
  for (const turn of floor) {
    if (turn.error) continue
    effective.set(turn.seat, turn.position)
  }

  for (const [seat, position] of effective) {
    counts[position] += 1
    weights[position] += DEFAULT_WEIGHT
    if (position === 'unclear') unreadableSeats.push(seat)
  }

  const decided = weights.support + weights.oppose
  const abstained = weights.abstain

  let leading: Position
  if (decided === 0) leading = 'abstain'
  else if (abstained > decided) leading = 'abstain'
  else leading = weights.support >= weights.oppose ? 'support' : 'oppose'

  const leadingWeight = leading === 'abstain' ? abstained : weights[leading]
  const consensus = decided === 0 || leading === 'abstain' ? 0 : leadingWeight / decided
  const dissentShare = leading === 'abstain' ? 0 : 1 - consensus

  for (const [seat, position] of effective) {
    if (position !== leading) dissentingSeats.push(seat)
  }
  dissentingSeats.sort()

  return {
    counts,
    weights,
    consensus,
    dissentShare,
    leading,
    dissentingSeats,
    unreadableSeats: unreadableSeats.sort(),
  }
}

const percent = (value: number): string => `${Math.round(value * 100)}%`

export const verdictText = (result: Tally, locale: Locale): string => {
  const tr = locale === 'tr'
  const support = result.counts.support
  const oppose = result.counts.oppose
  const abstain = result.counts.abstain
  const unreadable = result.unreadableSeats.length

  const headline = (() => {
    switch (result.leading) {
      case 'support':
        return tr
          ? `Panel öneriyi destekleme eğiliminde: ${support} destek, ${oppose} karşı.`
          : `The panel leaned toward supporting the proposition: ${support} for, ${oppose} against.`
      case 'oppose':
        return tr
          ? `Panel öneriye karşı eğilimde: ${oppose} karşı, ${support} destek.`
          : `The panel leaned against the proposition: ${oppose} against, ${support} for.`
      default:
        return tr
          ? 'Panel bir karara varamadı: çekimser ağırlığı baskın ya da okunabilir oy yok.'
          : 'The panel reached no decision: abstentions dominate, or no seat could be read.'
    }
  })()

  const agreement = (() => {
    if (result.leading === 'abstain') return tr ? 'Uzlaşı ölçülemedi.' : 'Agreement was not measured.'
    return tr
      ? `Karar veren oylar içinde uzlaşı ${percent(result.consensus)}, karşı görüş payı ${percent(result.dissentShare)}.`
      : `Among the seats that decided, agreement is ${percent(result.consensus)} and the dissenting share is ${percent(result.dissentShare)}.`
  })()

  const caveats = [
    abstain > 0 ? (tr ? `${abstain} çekimser.` : `${abstain} abstained.`) : null,
    unreadable > 0
      ? tr
        ? `${unreadable} üye istenen biçime uymadı ve düzeltilemedi; bu oylar karara girmedi.`
        : `${unreadable} member(s) ignored the requested shape and could not be recovered; those votes are excluded.`
      : null,
  ].filter(Boolean)

  const closing = tr
    ? 'Bu, panelin bu andaki eğilimidir; doğrulanmış bir doğru cevap değildir.'
    : 'This is the panel’s leaning at this moment. It is not a verified correct answer.'

  return [headline, agreement, ...caveats, closing].join(' ')
}

export interface RunnerDeps {
  key: string
  call: (args: {
    model: string
    messages: { role: 'system' | 'user'; content: string }[]
    logprobs: boolean
    json: boolean
    signal: AbortSignal
  }) => Promise<{ text: string; meanLogprob: number | null; midStreamError: string | null }>
  onProgress?: (phase: 'blind' | 'floor', seat: string) => void
}

export interface RunResult {
  blind: Vote[]
  floor: FloorTurn[]
  quotaBefore: Quota | null
  quotaAfter: Quota | null
  requestsSpent: number
}

const runSeat = async (
  seat: PanelSeat,
  messages: { role: 'system' | 'user'; content: string }[],
  deps: RunnerDeps,
): Promise<{ text: string; meanLogprob: number | null; error: string | null }> => {
  try {
    const result = await deps.call({
      model: seat.member.id,
      messages,
      logprobs: seat.member.supports.logprobs,
      json: seat.member.supports.responseFormat || seat.member.supports.structuredOutputs,
      signal: new AbortController().signal,
    })
    if (result.midStreamError) {
      return { text: result.text, meanLogprob: result.meanLogprob, error: result.midStreamError }
    }
    return { text: result.text, meanLogprob: result.meanLogprob, error: null }
  } catch (error) {
    return { text: '', meanLogprob: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Blind round, then floor round. The panel is parallel inside each round. */
export const runDeliberation = async (
  panel: PanelSeat[],
  motion: Proposition,
  locale: Locale,
  deps: RunnerDeps,
): Promise<RunResult> => {
  const system = promptFor(locale)
  const user = blindUserMessage(motion, locale)
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ]

  deps.onProgress?.('blind', 'all')
  const blindResults = await Promise.all(panel.map((seat) => runSeat(seat, messages, deps)))

  const blind: Vote[] = panel.map((seat, index) => {
    const result = blindResults[index]
    if (result.error) {
      return {
        seat: seat.label,
        memberId: seat.member.id,
        position: 'unclear',
        reason: '',
        confidence: null,
        confidenceBasis: 'absent',
        formatCompliant: false,
        raw: result.text,
        error: result.error,
      }
    }
    return {
      seat: seat.label,
      memberId: seat.member.id,
      ...readVote(result.text, { measuredLogprob: result.meanLogprob }),
      raw: result.text,
    }
  })

  const floor: FloorTurn[] = []
  const floorPromises = panel.map(async (seat, index) => {
    const others = blind
      .filter((vote) => vote.seat !== seat.label && !vote.error)
      .map((vote) => ({ label: vote.seat, position: vote.position, reason: vote.reason }))
    const addressed = others.map((other) => other.label)

    const floorMessages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: floorUserMessage(motion, others, locale) },
    ]

    deps.onProgress?.('floor', seat.label)
    const result = await runSeat(seat, floorMessages, deps)
    return { seat, index, result, addressed }
  })

  const floorResults = await Promise.all(floorPromises)
  for (const { seat, result, addressed } of floorResults) {
    if (result.error) {
      floor.push({
        seat: seat.label,
        memberId: seat.member.id,
        position: 'unclear',
        reason: '',
        confidence: null,
        confidenceBasis: 'absent',
        formatCompliant: false,
        raw: result.text,
        changed: false,
        firstRoundPosition: blind[panel.indexOf(seat)].position,
        addressed,
        error: result.error,
      })
      continue
    }
    floor.push(readFloorTurn(result.text, blind[panel.indexOf(seat)], addressed, result.meanLogprob))
  }

  floor.sort((a, b) => a.seat.localeCompare(b.seat))

  return {
    blind,
    floor,
    quotaBefore: null,
    quotaAfter: null,
    requestsSpent: panel.length * 2,
  }
}
