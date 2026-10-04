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

export interface Vote {
  seat: string
  memberId: string
  position: Position
  reason: string
  confidence: number | null
  confidenceBasis: ConfidenceBasis
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

export interface SessionRecord {
  id: string
  motion: string
  locale: Locale
  startedAt: string
  finishedAt: string
  panel: PanelSeat[]
  blind: Vote[]
  floor: FloorTurn[]
  verdict: Verdict
  quota: { before: Quota | null; after: Quota | null }
  requestsSpent: number
}

export const SEAT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const

/**
 * Requests consumed by a session: one blind call and one floor call per seat.
 *
 * No synthesis call. The verdict is computed by Agora from the counted positions
 * instead of being written by a panelist, so no panelist also acts as its own judge.
 */
export const estimateRequests = (seatCount: number): number => seatCount * 2
