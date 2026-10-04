export declare const ARCHIVE_SCHEMA_VERSION: '0.1'
export declare const POSITIONS: readonly ['support', 'oppose', 'abstain', 'unclear']
export declare const CONFIDENCE_BASES: readonly ['measured', 'self-reported', 'absent']

export interface RecountedTally {
  counts: Record<'support' | 'oppose' | 'abstain' | 'unclear', number>
  leading: 'support' | 'oppose' | 'abstain' | 'unclear'
  consensus: number
  dissentShare: number
  dissentingSeats: string[]
  unreadableSeats: string[]
}

export declare function recount(record: unknown): RecountedTally
export declare function validateArchiveRecord(
  record: unknown,
  options?: { existingIds?: string[] },
): string[]

/** One row of the shared timeline, derived from a record's rounds. */
export interface TimelineRow {
  id: string
  startedAt: string
  finishedAt: string
  motion: string
  topicSource: 'given' | 'panel'
  panel: { label: string; modelId: string }[]
  counts: Record<'support' | 'oppose' | 'abstain' | 'unclear', number>
  leading: 'support' | 'oppose' | 'abstain' | 'unclear'
  consensus: number
  dissentShare: number
  dissent: { seat: string; position: 'support' | 'oppose' | 'abstain' | 'unclear'; reason: string }[]
  unreadable: string[]
  requestsSpent: number
  invited: number
  seats: string[]
  agreementPath: { blind: number; final: number }
  quotaAfter: { used: number; limit: number; remaining: number }
}

export declare function toTimelineRow(record: unknown): TimelineRow

export interface RecountedTimelineRow {
  counts: Record<'support' | 'oppose' | 'abstain' | 'unclear', number>
  leading: 'support' | 'oppose' | 'abstain' | 'unclear'
  consensus: number
  dissentShare: number
  total: number
}

export declare function recountTimelineRow(row: unknown): RecountedTimelineRow
export declare function validateTimelineRecord(row: unknown): string[]
