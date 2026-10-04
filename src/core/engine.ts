import type {
  Agenda,
  Convergence,
  FloorTurn,
  Locale,
  PanelSeat,
  Position,
  Proposal,
  RosterEntry,
  RoundKind,
  RoundSnapshot,
  Tally,
  Vote,
} from './types'
import { AGREEMENT_THRESHOLD, SEAT_LABELS } from './types'
import { readAddressed, readProposal, readVote } from './parse'
import {
  AGENDA_PROMPT_EN,
  AGENDA_PROMPT_TR,
  BLIND_PROMPT_EN,
  BLIND_PROMPT_TR,
  CONVERGENCE_PROMPT_EN,
  CONVERGENCE_PROMPT_TR,
  FLOOR_PROMPT_EN,
  FLOOR_PROMPT_TR,
} from './prompts'

export interface Proposition {
  proposition: string
  context?: string
}

export const buildPanel = (members: RosterEntry[], seatCount: number): PanelSeat[] =>
  members.slice(0, seatCount).map((member, index) => ({
    label: SEAT_LABELS[index] ?? `S${index + 1}`,
    member,
  }))

const prompt = {
  agenda: (locale: Locale) => (locale === 'tr' ? AGENDA_PROMPT_TR : AGENDA_PROMPT_EN),
  blind: (locale: Locale) => (locale === 'tr' ? BLIND_PROMPT_TR : BLIND_PROMPT_EN),
  floor: (locale: Locale) => (locale === 'tr' ? FLOOR_PROMPT_TR : FLOOR_PROMPT_EN),
  convergence: (locale: Locale) => (locale === 'tr' ? CONVERGENCE_PROMPT_TR : CONVERGENCE_PROMPT_EN),
}

export interface CallArgs {
  model: string
  messages: { role: 'system' | 'user'; content: string }[]
  logprobs: boolean
  json: boolean
  signal: AbortSignal
}

export interface RunnerDeps {
  key: string
  call: (args: CallArgs) => Promise<{ text: string; meanLogprob: number | null; midStreamError: string | null }>
  onProgress?: (phase: RoundKind, seat: string) => void
}

const propositionLine = (motion: Proposition, locale: Locale): string => {
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
const floorMessage = (
  motion: Proposition,
  others: { label: string; position: Position; reason: string }[],
  locale: Locale,
): string => {
  const lines = others.map((other) => `- ${other.label}: ${other.position} — ${other.reason}`)
  const header =
    locale === 'tr'
      ? 'Diğer üyelerin birinci tur konumları (üye etiketleriyle):'
      : 'Other members’ first-round positions, under their seat labels:'
  return [propositionLine(motion, locale), '', header, ...lines].join('\n')
}

const convergenceMessage = (
  motion: Proposition,
  leading: { label: string; position: Position; reason: string }[],
  locale: Locale,
): string => {
  const lines = leading.map((entry) => `- ${entry.label}: ${entry.position} — ${entry.reason}`)
  const header =
    locale === 'tr'
      ? `Önde gelen konum (${leading[0]?.position ?? '—'}) ve savunucuları:`
      : `The leading position (${leading[0]?.position ?? '—'}) and the seats holding it:`
  const invitation =
    locale === 'tr'
      ? 'Konumunu değiştir ya da koru. İkisi de meşrudur.'
      : 'Move to it or hold your own. Either is legitimate.'
  return [propositionLine(motion, locale), '', header, ...lines, '', invitation].join('\n')
}

const emptyVote = (seat: PanelSeat, error: string, raw: string): Vote => ({
  seat: seat.label,
  memberId: seat.member.id,
  position: 'unclear',
  reason: '',
  confidence: null,
  confidenceBasis: 'absent',
  meanLogprob: null,
  addressed: [],
  formatCompliant: false,
  raw,
  error,
})

interface SeatOutcome {
  text: string
  meanLogprob: number | null
  error: string | null
}

const callSeat = async (seat: PanelSeat, messages: CallArgs['messages'], deps: RunnerDeps): Promise<SeatOutcome> => {
  try {
    const result = await deps.call({
      model: seat.member.id,
      messages,
      logprobs: seat.member.supports.logprobs,
      json: seat.member.supports.responseFormat || seat.member.supports.structuredOutputs,
      signal: new AbortController().signal,
    })
    return { text: result.text, meanLogprob: result.meanLogprob, error: result.midStreamError }
  } catch (error) {
    return { text: '', meanLogprob: null, error: error instanceof Error ? error.message : String(error) }
  }
}

const messagesFor = (system: string, user: string): CallArgs['messages'] => [
  { role: 'system' as const, content: system },
  { role: 'user' as const, content: user },
]

/** Round 0: the panel is asked what it should argue about. */
export const runAgenda = async (panel: PanelSeat[], locale: Locale, deps: RunnerDeps): Promise<Proposal[]> => {
  const system = prompt.agenda(locale)
  const ask =
    locale === 'tr'
      ? 'Panelin tartışacağı bir öneri ileri sür.'
      : 'Propose one proposition for this panel to argue about.'

  deps.onProgress?.('blind', 'agenda')
  const outcomes = await Promise.all(panel.map((seat) => callSeat(seat, messagesFor(system, ask), deps)))

  return panel.map((seat, index) => {
    const outcome = outcomes[index]
    if (outcome.error) {
      return { seat: seat.label, memberId: seat.member.id, proposition: '', reason: '', formatCompliant: false, raw: outcome.text, error: outcome.error }
    }
    const parsed = readProposal(outcome.text)
    return { seat: seat.label, memberId: seat.member.id, ...parsed }
  })
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'that',
  'this', 'it', 'as', 'at', 'by', 'with', 'from', 'more', 'than', 'its', 'it’s', 'not', 'but', 'you', 'your', 'their',
  'bir', 've', 'için', 'ile', 'daha', 'çok', 'bu', 'da', 'de', 'ya', 'her', 'gibi', 'olan', 'ise', 'ancak',
])

/**
 * Reduce a word to a comparable stem.
 *
 * Only plural and third-person endings are stripped. Without this, "prevents" and
 * "prevent" or "types" and "type" are different terms, and two proposals saying the same
 * thing in ordinary English fail to group — which would silently turn the panel's agenda
 * into a list of singletons.
 */
const stem = (word: string): string => {
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('sses')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

const termsOf = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      .map(stem),
  )

/** Jaccard overlap between two term sets. */
const overlap = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const term of left) if (right.has(term)) shared += 1
  return shared / (left.size + right.size - shared)
}

export interface Cluster {
  proposition: string
  seats: string[]
  terms: Set<string>
}

/**
 * Group proposals that are asking the same question.
 *
 * The threshold is a declared constant, not a tuned one, and the result is reported with
 * its size so a single proposer cannot quietly pass as a panel consensus. When no two
 * proposals overlap, every cluster is a singleton and the panel has no shared agenda —
 * which is itself an honest answer.
 */
export const clusterProposals = (proposals: Proposal[], threshold = 0.34): Cluster[] => {
  const usable = proposals.filter((entry) => entry.proposition.trim().length > 0)
  const clusters: Cluster[] = []

  for (const entry of usable) {
    const terms = termsOf(entry.proposition)
    const match = clusters.find((cluster) => overlap(cluster.terms, terms) >= threshold)
    if (match) {
      match.seats.push(entry.seat)
      // The cluster's terms grow with its members, so a third agreeing proposal lands
      // with the first two instead of forming a rival pair.
      for (const term of terms) match.terms.add(term)
    } else {
      clusters.push({ proposition: entry.proposition.trim(), seats: [entry.seat], terms })
    }
  }

  return clusters.sort((a, b) => b.seats.length - a.seats.length || a.seats[0].localeCompare(b.seats[0]))
}

/** The panel's own pick: the largest cluster, ties broken by the earliest seat. */
export const pickByCluster = (clusters: Cluster[]): Cluster | null => clusters[0] ?? null

export const readFloorTurn = (raw: string, first: Vote, addressed: string[], measured: number | null): FloorTurn => {
  const parsed = readVote(raw, { measuredLogprob: measured, ownSeat: first.seat })
  return {
    ...parsed,
    raw,
    meanLogprob: measured,
    seat: first.seat,
    memberId: first.memberId,
    changed: parsed.position !== first.position,
    firstRoundPosition: first.position,
    addressed,
  }
}

const DEFAULT_WEIGHT = 1

/**
 * Count a discussion, taking the latest position each seat actually gave.
 *
 * Weight is flat: a stated confidence is reported beside the vote rather than silently
 * rescaling the count, because a self-reported number from a small free model is not a
 * measurement and must not outweigh a neighbour.
 */
export const tally = (rounds: { blind: Vote[]; floor: FloorTurn[]; convergence: FloorTurn[] }): Tally => {
  const counts: Record<Position, number> = { support: 0, oppose: 0, abstain: 0, unclear: 0 }
  const effective = new Map<string, Position>()
  const reasons = new Map<string, Position>()

  for (const vote of rounds.blind) if (!vote.error) effective.set(vote.seat, vote.position)
  for (const turn of rounds.floor) if (!turn.error) effective.set(turn.seat, turn.position)
  for (const turn of rounds.convergence) if (!turn.error) effective.set(turn.seat, turn.position)

  for (const [seat, position] of effective) {
    counts[position] += 1
    reasons.set(seat, position)
  }

  const weights: Record<Position, number> = { support: 0, oppose: 0, abstain: 0, unclear: 0 }
  for (const [position, count] of Object.entries(counts)) weights[position as Position] = count * DEFAULT_WEIGHT

  const decided = weights.support + weights.oppose
  const abstained = weights.abstain

  const leading: Position =
    decided === 0 ? 'abstain' : abstained > decided ? 'abstain' : weights.support >= weights.oppose ? 'support' : 'oppose'

  const leadingWeight = leading === 'abstain' ? abstained : weights[leading]
  const consensus = decided === 0 || leading === 'abstain' ? 0 : leadingWeight / decided
  const dissentShare = leading === 'abstain' ? 0 : 1 - consensus

  const dissentingSeats = [...reasons.entries()].filter(([, position]) => position !== leading).map(([seat]) => seat).sort()
  const unreadableSeats = [...reasons.entries()].filter(([, position]) => position === 'unclear').map(([seat]) => seat).sort()

  return { counts, weights, consensus, dissentShare, leading, dissentingSeats, unreadableSeats }
}

const snapshot = (kind: RoundKind, result: Tally, seats: string[]): RoundSnapshot => ({
  kind,
  positions: result.counts,
  leading: result.leading,
  agreement: result.consensus,
  seats,
})

/**
 * Measure whether the panel actually converged.
 *
 * Convergence is not agreement: a panel can agree immediately without ever having argued,
 * and it can split further after a real debate. The trajectory shows which of those
 * happened, and `moved`/`held` name the seats responsible, so "the panel agreed" is never
 * a claim without a subject.
 */
export const buildTrajectory = (
  rounds: { blind: Vote[]; floor: FloorTurn[]; convergence: FloorTurn[] },
  allSeats: string[],
  threshold = AGREEMENT_THRESHOLD,
): Convergence => {
  const blind = tally({ blind: rounds.blind, floor: [], convergence: [] })
  const floor = tally({ blind: rounds.blind, floor: rounds.floor, convergence: [] })
  const final = tally(rounds)

  // The round argument has to be honoured. Reading the final round first for both
  // endpoints would make every move look like a hold, because `from` and `to` would be
  // the same position.
  const positionAt = (seat: string, round: 'blind' | 'floor' | 'final'): Position => {
    const read = (entries: (Vote | FloorTurn)[]) =>
      entries.find((entry) => entry.seat === seat && !entry.error)?.position
    if (round === 'blind') return read(rounds.blind) ?? 'unclear'
    if (round === 'floor') return read(rounds.floor) ?? read(rounds.blind) ?? 'unclear'
    return read(rounds.convergence) ?? read(rounds.floor) ?? read(rounds.blind) ?? 'unclear'
  }

  const invited = rounds.convergence.filter((turn) => !turn.error).map((turn) => turn.seat)
  const moved: { seat: string; from: Position; to: Position }[] = []
  const held: string[] = []

  for (const seat of invited) {
    const from = positionAt(seat, 'floor')
    const to = positionAt(seat, 'final')
    if (from !== to) moved.push({ seat, from, to })
    else held.push(seat)
  }

  return {
    snapshots: [
      snapshot('blind', blind, allSeats),
      snapshot('floor', floor, allSeats),
      ...(invited.length > 0 ? [snapshot('convergence', final, allSeats)] : []),
    ],
    threshold,
    reached: final.leading !== 'abstain' && final.consensus >= threshold,
    moved,
    held,
    invited,
  }
}

const percent = (value: number): string => `${Math.round(value * 100)}%`

/**
 * The verdict sentence, plus the convergence sentence.
 *
 * Both are generated from the stored count rather than written by a model, so no seat
 * authors the summary that reports it.
 */
export const verdictText = (result: Tally, locale: Locale, trajectory?: Convergence): string => {
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
      ? `Karar veren koltuklar içinde uzlaşı ${percent(result.consensus)}, karşı görüş payı ${percent(result.dissentShare)}.`
      : `Among the seats that decided, agreement is ${percent(result.consensus)} and the dissenting share is ${percent(result.dissentShare)}.`
  })()

  const convergenceLine = (() => {
    if (!trajectory || trajectory.snapshots.length === 0) return null
    const first = trajectory.snapshots[0]
    const last = trajectory.snapshots[trajectory.snapshots.length - 1]
    if (first.kind === last.kind) return null
    const delta = last.agreement - first.agreement
    const direction =
      delta > 0.001 ? (tr ? 'arttı' : 'rose') : delta < -0.001 ? (tr ? 'azaldı' : 'fell') : tr ? 'değişmedi' : 'held'

    const movement = (() => {
      if (trajectory.moved.length === 0) {
        return tr
          ? trajectory.held.length > 0
            ? `Son turda ${trajectory.held.join(', ')} konumunu değiştirmedi.`
            : 'Konum değiştiren koltuk olmadı.'
          : trajectory.held.length > 0
            ? `${trajectory.held.join(', ')} held in the final round.`
            : 'No seat changed position in the final round.'
      }
      const list = trajectory.moved.map((entry) => `${entry.seat} ${entry.from}→${entry.to}`).join(', ')
      return tr ? `Konum değiştirenler: ${list}.` : `Seats that moved: ${list}.`
    })()

    return tr
      ? `Uzlaşma görüşme boyunca ${percent(first.agreement)} değerinden ${percent(last.agreement)} değerine ${direction}. ${movement}`
      : `Agreement ran from ${percent(first.agreement)} in the first round to ${percent(last.agreement)} at the end, ${direction}. ${movement}`
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

  return [headline, agreement, ...(convergenceLine ? [convergenceLine] : []), ...caveats, closing]
    .filter(Boolean)
    .join(' ')
}

export interface DeliberationResult {
  blind: Vote[]
  floor: FloorTurn[]
  convergence: FloorTurn[]
  tally: Tally
  trajectory: Convergence
  requestsSpent: number
}

/**
 * Blind round, floor round, then a convergence round for the seats that dissented.
 *
 * The third round is spent only on dissenters, which is both what a real deliberation
 * would do and what keeps a session inside the daily ceiling: a panel that agrees
 * immediately never spends it at all.
 */
export const runDeliberation = async (
  panel: PanelSeat[],
  motion: Proposition,
  locale: Locale,
  deps: RunnerDeps,
): Promise<DeliberationResult> => {
  const blindSystem = prompt.blind(locale)
  const user = propositionLine(motion, locale)
  const blindMessages = messagesFor(blindSystem, user)

  deps.onProgress?.('blind', 'all')
  const blindOutcomes = await Promise.all(panel.map((seat) => callSeat(seat, blindMessages, deps)))

  const blind: Vote[] = panel.map((seat, index) => {
    const outcome = blindOutcomes[index]
    if (outcome.error) return emptyVote(seat, outcome.error, outcome.text)
    return {
      seat: seat.label,
      memberId: seat.member.id,
      ...readVote(outcome.text, { measuredLogprob: outcome.meanLogprob, ownSeat: seat.label }),
      raw: outcome.text,
      meanLogprob: outcome.meanLogprob,
      addressed: [],
    }
  })

  const floorSystem = prompt.floor(locale)
  const floorWork = panel.map(async (seat) => {
    const others = blind
      .filter((vote) => vote.seat !== seat.label && !vote.error)
      .map((vote) => ({ label: vote.seat, position: vote.position, reason: vote.reason }))

    deps.onProgress?.('floor', seat.label)
    const outcome = await callSeat(seat, messagesFor(floorSystem, floorMessage(motion, others, locale)), deps)
    return { seat, outcome, addressed: others.map((other) => other.label) }
  })

  const floorResults = await Promise.all(floorWork)
  const floor: FloorTurn[] = floorResults.map(({ seat, outcome, addressed }) => {
    if (outcome.error) {
      return {
        ...emptyVote(seat, outcome.error, outcome.text),
        changed: false,
        firstRoundPosition: blind[panel.indexOf(seat)].position,
        addressed,
      }
    }
    return readFloorTurn(outcome.text, blind[panel.indexOf(seat)], addressed, outcome.meanLogprob)
  })

  const afterFloor = tally({ blind, floor, convergence: [] })

  // Only the seats that did not join the leading position are invited back.
  const dissenters = afterFloor.leading === 'abstain' ? [] : afterFloor.dissentingSeats
  const convergence: FloorTurn[] = []

  if (dissenters.length > 0) {
    const convergenceSystem = prompt.convergence(locale)
    const holders = floor.filter((turn) => turn.position === afterFloor.leading)
    const holderSummary = holders.map((turn) => ({
      label: turn.seat,
      position: turn.position,
      reason: turn.reason,
    }))

    await Promise.all(
      dissenters.map(async (label) => {
        const seat = panel.find((entry) => entry.label === label)
        if (!seat) return
        const first = blind.find((vote) => vote.seat === label)
        if (!first) return
        const before = floor.find((turn) => turn.seat === label)
        deps.onProgress?.('convergence', label)
        const outcome = await callSeat(seat, messagesFor(convergenceSystem, convergenceMessage(motion, holderSummary, locale)), deps)
        if (outcome.error) {
          convergence.push({
            ...emptyVote(seat, outcome.error, outcome.text),
            changed: false,
            firstRoundPosition: before?.position ?? first.position,
            addressed: holderSummary.map((entry) => entry.label),
          })
          return
        }
        const parsed = readVote(outcome.text, { measuredLogprob: outcome.meanLogprob, ownSeat: label })
        convergence.push({
          ...parsed,
          raw: outcome.text,
          meanLogprob: outcome.meanLogprob,
          seat: label,
          memberId: seat.member.id,
          changed: parsed.position !== (before?.position ?? first.position),
          firstRoundPosition: before?.position ?? first.position,
          addressed: readAddressed(null, outcome.text),
        })
      }),
    )
    convergence.sort((a, b) => a.seat.localeCompare(b.seat))
  }

  const finalTally = tally({ blind, floor, convergence })
  const trajectory = buildTrajectory({ blind, floor, convergence }, panel.map((seat) => seat.label))

  return {
    blind,
    floor,
    convergence,
    tally: finalTally,
    trajectory,
    requestsSpent: panel.length * 2 + convergence.length,
  }
}

export const agendaFor = (motion: string, proposals: Proposal[], mode: Agenda['mode'], chosen: string, chosenBy: Agenda['chosenBy'], clusterSize: number): Agenda => ({
  mode,
  proposals,
  chosen,
  chosenBy,
  clusterSize,
})
