/**
 * Agora core types.
 *
 * Vocabulary note: a model's stated position is a *claim inside a transcript*,
 * never an evidence record. Evidence records in this app cover only claims Agora
 * can stand behind itself (the public roster, the visitor's own quota, and the
 * arithmetic derived from panel statements). Agreement is never treated as
 * correctness.
 */

export type Locale = 'en' | 'tr'

export type Position = 'support' | 'oppose' | 'abstain' | 'unclear'

export type ConfidenceBasis = 'measured' | 'self-reported' | 'absent'

export interface LocalizedText {
  en: string
  tr?: string
}

export const t = (value: LocalizedText | undefined, locale: Locale): string => {
  if (!value) return ''
  return locale === 'tr' ? (value.tr ?? value.en) : value.en
}

/** One free model as published by OpenRouter's public catalog. */
export interface RosterEntry {
  /** Full routing id including the `:free` variant suffix. */
  id: string
  /** Id without the `:free` suffix, for display. */
  slug: string
  provider: string
  contextLength: number
  maxCompletionTokens: number | null
  isModerated: boolean
  supports: {
    structuredOutputs: boolean
    responseFormat: boolean
    logprobs: boolean
    tools: boolean
  }
}

/** A free model deliberately kept off the panel, with a stated reason. */
export interface ExcludedEntry {
  id: string
  reason: LocalizedText
}

export interface Roster {
  members: RosterEntry[]
  excluded: ExcludedEntry[]
  /** Catalog snapshot time, taken from the fetch, not from a build. */
  observedAt: string
}

export interface PanelSeat {
  /** Blind label shown to other members. Brand names are withheld on purpose. */
  label: string
  member: RosterEntry
}

export type RoundKind = 'blind' | 'floor' | 'convergence'

/** Seat labels this member addressed directly, read from the answer. */
export interface Vote {
  seat: string
  memberId: string
  position: Position
  reason: string
  confidence: number | null
  confidenceBasis: ConfidenceBasis
  /** Mean token log-probability, present whenever the member reported logprobs. */
  meanLogprob: number | null
  /** Seat labels named in the answer. Empty in the blind round by construction. */
  addressed: string[]
  /** False when the model ignored the requested shape and was recovered from prose. */
  formatCompliant: boolean
  raw: string
  error?: string
}

export interface FloorTurn extends Vote {
  /** True when the second-round position differs from the blind round. */
  changed: boolean
  firstRoundPosition: Position
  /** Seat labels this member addressed. */
  addressed: string[]
}

export interface Quota {
  used: number
  limit: number
  remaining: number
}

export interface Tally {
  counts: Record<Position, number>
  weights: Record<Position, number>
  /** Weight share of the leading position, 0..1. 1 means no disagreement. */
  consensus: number
  /** Weight share that did not join the leading position, 0..1. */
  dissentShare: number
  leading: Position
  dissentingSeats: string[]
  /** Seats whose round-two answer could not be read, in either shape. */
  unreadableSeats: string[]
}

export interface Verdict {
  tally: Tally
  synthesis: string | null
  synthesisSeat: string | null
  synthesisFormatCompliant: boolean
}

export type SessionPhase = 'idle' | 'blind' | 'floor' | 'verdict' | 'done' | 'failed'

/** One seat's suggestion for what the panel should argue about. */
export interface Proposal {
  seat: string
  memberId: string
  proposition: string
  reason: string
  formatCompliant: boolean
  raw: string
  error?: string
}

export interface Agenda {
  mode: 'given' | 'panel'
  proposals: Proposal[]
  /** The proposition that was actually debated. */
  chosen: string
  chosenBy: 'given' | 'user' | 'cluster'
  /** How many proposals agreed with the chosen one, in panel mode. Zero when given. */
  clusterSize: number
}

/** Agreement measured at one point in the discussion. */
export interface RoundSnapshot {
  kind: RoundKind
  positions: Record<Position, number>
  leading: Position
  /** Share of the deciding seats on the leading position, 0..1. */
  agreement: number
  seats: string[]
}

export interface Convergence {
  snapshots: RoundSnapshot[]
  /** Declared share of deciding seats that counts as agreement. */
  threshold: number
  reached: boolean
  /** Seats the final round moved, and what they moved from. */
  moved: { seat: string; from: Position; to: Position }[]
  /** Seats invited back that refused to move. */
  held: string[]
  invited: string[]
}

export interface SessionRecord {
  id: string
  motion: string
  locale: Locale
  startedAt: string
  finishedAt: string
  agenda: Agenda
  panel: PanelSeat[]
  blind: Vote[]
  floor: FloorTurn[]
  convergence: FloorTurn[]
  trajectory: Convergence
  verdict: Verdict
  quota: { before: Quota | null; after: Quota | null }
  requestsSpent: number
}

export const SEAT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const

/**
 * What a session costs, as a range.
 *
 * The range is honest because the final round is only spent on the seats that dissented,
 * and nobody knows who those are until the floor round is counted. A panel that agrees
 * immediately costs the minimum; a panel that splits costs the maximum.
 */
export const estimateRequests = (seatCount: number, options: { agenda?: boolean } = {}): { min: number; max: number } => {
  const agenda = options.agenda ? seatCount : 0
  return { min: agenda + seatCount * 2, max: agenda + seatCount * 3 }
}

/** Share of the deciding seats on the leading position that counts as agreement. */
export const AGREEMENT_THRESHOLD = 2 / 3
