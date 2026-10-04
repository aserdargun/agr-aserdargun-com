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
