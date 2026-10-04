import { validateArchiveRecord } from '../../scripts/archive-contract.mjs'
import type { FloorTurn, Locale, Position, Quota, SessionRecord, Vote } from './types'

/**
 * The archive record is the file Agora is willing to publish.
 *
 * It is deliberately narrower than the live session: the panel is reduced to seat labels
 * and model ids, and the verdict sentence is not stored at all because it is a pure
 * function of the tally. That keeps the file reviewable and lets the same record render
 * in both languages without either prose being stored twice.
 */
export interface ArchivePanelSeat {
  label: string
  modelId: string
}

export interface ArchiveRound {
  seat: string
  position: Position
  reason: string
  confidence: number | null
  confidenceBasis: Vote['confidenceBasis']
  addressed: string[]
  formatCompliant: boolean
  /** Required whenever confidenceBasis is `measured`; the contract rejects it otherwise. */
  meanLogprob?: number | null
  error?: string
}

export interface ArchiveRecord {
  schemaVersion: '0.1'
  id: string
  motion: string
  locale: Locale
  startedAt: string
  finishedAt: string
  agenda: SessionRecord['agenda']
  panel: ArchivePanelSeat[]
  blind: ArchiveRound[]
  floor: ArchiveRound[]
  convergence: ArchiveRound[]
  trajectory: SessionRecord['trajectory']
  requestsSpent: number
  quota: { before: Quota; after: Quota }
  tally: SessionRecord['verdict']['tally']
}

const roundOf = (entry: Vote | FloorTurn): ArchiveRound => ({
  seat: entry.seat,
  position: entry.position,
  reason: entry.reason,
  confidence: entry.confidence,
  confidenceBasis: entry.confidenceBasis,
  addressed: entry.addressed,
  formatCompliant: entry.formatCompliant,
  meanLogprob: entry.meanLogprob,
  ...(entry.error ? { error: entry.error } : {}),
})

/** A record is only exportable if both quota snapshots exist; the contract needs them to prove the cost. */
export const toArchiveRecord = (session: SessionRecord): ArchiveRecord | null => {
  if (!session.quota.before || !session.quota.after) return null
  return {
    schemaVersion: '0.1',
    id: session.id,
    motion: session.motion,
    locale: session.locale,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    agenda: session.agenda,
    panel: session.panel.map((seat) => ({ label: seat.label, modelId: seat.member.id })),
    blind: session.blind.map(roundOf),
    floor: session.floor.map(roundOf),
    convergence: session.convergence.map(roundOf),
    trajectory: session.trajectory,
    requestsSpent: session.requestsSpent,
    quota: { before: session.quota.before, after: session.quota.after },
    tally: session.verdict.tally,
  }
}

export const validateForArchive = (record: unknown, existingIds: string[] = []): string[] =>
  validateArchiveRecord(record, { existingIds })

export interface TimelineDissent {
  seat: string
  position: Position
  reason: string
}

/** One row of the shared timeline. Derived from a session, never authored by hand. */
export interface TimelineRecord {
  id: string
  startedAt: string
  finishedAt: string
  motion: string
  /** How the topic entered: given by the visitor, or proposed by the panel itself. */
  topicSource: 'given' | 'panel'
  panel: ArchivePanelSeat[]
  counts: Record<Position, number>
  leading: Position
  consensus: number
  dissentShare: number
  dissent: TimelineDissent[]
  unreadable: string[]
  requestsSpent: number
  /** Seat letters, so the same proposition can be compared across rosters. */
  seats: string[]
  /** Agreement after the first round and at the end, so a moved count is visible. */
  agreementPath: { blind: number; final: number }
  quotaAfter: Quota
}

export const toTimelineRecord = (session: SessionRecord): TimelineRecord | null => {
  if (!session.quota.after) return null
  const { tally } = session.verdict
  const trajectory = session.trajectory
  return {
    id: session.id,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    motion: session.motion,
    topicSource: session.agenda.mode,
    panel: session.panel.map((seat) => ({ label: seat.label, modelId: seat.member.id })),
    counts: tally.counts,
    leading: tally.leading,
    consensus: tally.consensus,
    dissentShare: tally.dissentShare,
    dissent: session.floor
      .filter((turn) => tally.dissentingSeats.includes(turn.seat))
      .map((turn) => ({ seat: turn.seat, position: turn.position, reason: turn.reason })),
    unreadable: tally.unreadableSeats,
    requestsSpent: session.requestsSpent,
    seats: session.panel.map((seat) => seat.label),
    agreementPath: {
      blind: trajectory.snapshots[0]?.agreement ?? tally.consensus,
      final: trajectory.snapshots[trajectory.snapshots.length - 1]?.agreement ?? tally.consensus,
    },
    quotaAfter: session.quota.after,
  }
}

/**
 * Group records by the proposition they answered.
 *
 * This is the reason the archive exists: the same question, re-asked with a different
 * week's roster, shows whether the count held or moved. A proposition that is a strict
 * prefix of another is kept apart so two different questions never share a line.
 */
export const groupByMotion = (records: TimelineRecord[]): { motion: string; records: TimelineRecord[] }[] => {
  const groups = new Map<string, TimelineRecord[]>()
  for (const record of records) {
    const key = record.motion.trim().toLowerCase()
    const bucket = groups.get(key)
    if (bucket) bucket.push(record)
    else groups.set(key, [record])
  }
  return [...groups.values()]
    .map((entries) => ({
      // The earliest spelling of the proposition, not the normalised grouping key, so the
      // heading shows what someone actually wrote.
      motion: entries[0].motion,
      records: entries.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
    }))
    .sort((a, b) => b.records[0].finishedAt.localeCompare(a.records[0].finishedAt))
}
