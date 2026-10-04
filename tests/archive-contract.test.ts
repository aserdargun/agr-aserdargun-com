import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_SCHEMA_VERSION,
  recount,
  recountTimelineRow,
  toTimelineRow,
  validateArchiveRecord,
  validateTimelineRecord,
} from '../scripts/archive-contract.mjs'
import { tally } from '../src/core/engine'
import { toTimelineRecord, validateTimelineRow } from '../src/core/archive-schema'
import type { FloorTurn, Position, RosterEntry, SessionRecord, Vote } from '../src/core/types'

const seat = (label: string, overrides: Partial<Vote> = {}): Vote => ({
  seat: label,
  memberId: `${label.toLowerCase()}/model:free`,
  position: 'support' as const,
  reason: 'because',
  confidence: 70,
  confidenceBasis: 'self-reported' as const,
  meanLogprob: null,
  addressed: [],
  formatCompliant: true,
  raw: '{"position":"support"}',
  ...overrides,
})

const turn = (label: string, overrides: Partial<FloorTurn> = {}): FloorTurn => ({
  ...seat(label),
  changed: false,
  firstRoundPosition: 'support',
  addressed: [],
  ...overrides,
})

const record = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: ARCHIVE_SCHEMA_VERSION,
  id: '2026-10-04T16-00-00-5',
  motion: 'The free tier is a research instrument.',
  locale: 'en',
  startedAt: '2026-10-04T16:00:00.000Z',
  finishedAt: '2026-10-04T16:04:00.000Z',
  panel: [
    { label: 'A', modelId: 'a/one:free' },
    { label: 'B', modelId: 'b/two:free' },
    { label: 'C', modelId: 'c/three:free' },
  ],
  agenda: { mode: 'given', proposals: [], chosen: 'The free tier is a research instrument.', chosenBy: 'given', clusterSize: 0 },
  blind: [seat('A'), seat('B'), seat('C')],
  floor: [turn('A'), turn('B'), turn('C', { position: 'oppose' })],
  convergence: [],
  trajectory: {
    snapshots: [
      { kind: 'blind', positions: { support: 3, oppose: 0, abstain: 0, unclear: 0 }, leading: 'support', agreement: 1, seats: ['A', 'B', 'C'] },
      { kind: 'floor', positions: { support: 2, oppose: 1, abstain: 0, unclear: 0 }, leading: 'support', agreement: 2 / 3, seats: ['A', 'B', 'C'] },
    ],
    threshold: 2 / 3,
    reached: true,
    moved: [],
    held: [],
    invited: [],
  },
  requestsSpent: 6,
  // The counter moves by exactly what the session claims, so the self-proof holds.
  quota: {
    before: { used: 8, limit: 50, remaining: 42 },
    after: { used: 14, limit: 50, remaining: 36 },
  },
  tally: {
    counts: { support: 2, oppose: 1, abstain: 0, unclear: 0 },
    leading: 'support',
    consensus: 2 / 3,
    dissentShare: 1 / 3,
    dissentingSeats: ['C'],
    unreadableSeats: [],
  },
  ...overrides,
})

describe('archive contract', () => {
  it('accepts a well-formed record', () => {
    expect(validateArchiveRecord(record())).toEqual([])
  })

  it('re-derives the count the same way the engine does', () => {
    // The plain-JS contract cannot import the TypeScript engine, so the two are pinned
    // to each other here over the cases that decide a verdict.
    const cases: { blind: Position[]; floor: Position[]; convergence?: Position[] }[] = [
      { blind: ['support', 'support', 'oppose'], floor: ['support', 'support', 'oppose'] },
      { blind: ['support', 'oppose', 'abstain'], floor: ['oppose', 'oppose', 'abstain'] },
      { blind: ['abstain', 'abstain', 'support'], floor: ['abstain', 'abstain', 'support'] },
      { blind: ['support', 'unclear', 'unclear'], floor: ['support', 'unclear', 'unclear'] },
      { blind: ['support', 'oppose', 'oppose'], floor: ['support', 'oppose', 'oppose'], convergence: ['support', 'oppose'] },
      { blind: ['support', 'oppose', 'oppose'], floor: ['support', 'oppose', 'oppose'], convergence: ['support', 'support'] },
    ]

    for (const { blind, floor, convergence = [] } of cases) {
      const blindVotes = blind.map((position, index) => seat('ABC'[index], { position }))
      const floorTurns = floor.map((position, index) => turn('ABC'[index], { position }))
      const convergenceTurns = convergence.map((position, index) =>
        turn('ABC'[index], { position, changed: position !== floor[index] }),
      )

      const fromEngine = tally({ blind: blindVotes, floor: floorTurns, convergence: convergenceTurns })
      const fromContract = recount({
        blind: blind.map((position, index) => ({ seat: 'ABC'[index], position })),
        floor: floor.map((position, index) => ({ seat: 'ABC'[index], position })),
        convergence: convergence.map((position, index) => ({ seat: 'ABC'[index], position })),
      })

      expect(fromContract.leading).toBe(fromEngine.leading)
      expect(fromContract.counts).toEqual(fromEngine.counts)
      expect(fromContract.consensus).toBeCloseTo(fromEngine.consensus, 12)
      expect(fromContract.dissentingSeats).toEqual(fromEngine.dissentingSeats)
      expect(fromContract.unreadableSeats).toEqual(fromEngine.unreadableSeats)

      // The row is a second presentation of the same count, so it is pinned the same way:
      // a mapping mistake in the row would otherwise reach the shared feed unnoticed.
      const row = toTimelineRow({
        ...record(),
        blind: blind.map((position, index) => ({ seat: 'ABC'[index], position, reason: 'because' })),
        floor: floor.map((position, index) => ({ seat: 'ABC'[index], position, reason: 'because' })),
        convergence: convergence.map((position, index) => ({ seat: 'ABC'[index], position, reason: 'because' })),
        requestsSpent: 6 + convergence.length,
      })
      expect(row.counts).toEqual(fromEngine.counts)
      expect(row.leading).toBe(fromEngine.leading)
      expect(row.consensus).toBeCloseTo(fromEngine.consensus, 12)
      expect(row.dissentShare).toBeCloseTo(fromEngine.dissentShare, 12)
      expect(row.unreadable).toEqual(fromEngine.unreadableSeats)
      expect(row.dissent.map((entry) => entry.seat)).toEqual(fromEngine.dissentingSeats)
      expect(validateTimelineRecord(row)).toEqual([])
    }
  })

  it('refuses a record whose stored count disagrees with its own positions', () => {
    const errors = validateArchiveRecord(
      record({ tally: { ...record().tally, leading: 'oppose', counts: { support: 0, oppose: 3, abstain: 0, unclear: 0 } } }),
    )
    expect(errors.join('\n')).toMatch(/tally\.leading/)
  })

  it('refuses a record that does not prove its own cost', () => {
    const forged = record({ quota: { before: { used: 8, limit: 50, remaining: 42 }, after: { used: 9, limit: 50, remaining: 41 } } })
    const errors = validateArchiveRecord(forged)
    expect(errors.join('\n')).toMatch(/does not prove its own cost/)
  })

  it('refuses a record whose quota arithmetic does not add up', () => {
    const broken = record({ quota: { before: { used: 8, limit: 50, remaining: 99 }, after: { used: 14, limit: 50, remaining: 36 } } })
    expect(validateArchiveRecord(broken).join('\n')).toMatch(/quota\.before/)
  })

  it('refuses a request cost that does not match the rounds that were actually run', () => {
    expect(validateArchiveRecord(record({ requestsSpent: 5 })).join('\n')).toMatch(/expected 6 for 3 seats/)
  })

  it('charges the agenda round only when the panel chose its own topic', () => {
    const agenda = { mode: 'panel', proposals: [], chosen: 'The free tier is a research instrument.', chosenBy: 'cluster', clusterSize: 2 }
    const withAgendaCost = record({
      agenda,
      requestsSpent: 9,
      quota: { before: { used: 8, limit: 50, remaining: 42 }, after: { used: 17, limit: 50, remaining: 33 } },
    })
    expect(validateArchiveRecord(withAgendaCost)).toEqual([])

    // The agenda round is charged, so a record that forgets it is rejected on cost alone.
    const forgotAgenda = record({
      agenda,
      requestsSpent: 6,
      quota: { before: { used: 8, limit: 50, remaining: 42 }, after: { used: 17, limit: 50, remaining: 33 } },
    })
    expect(validateArchiveRecord(forgotAgenda).join('\n')).toMatch(/expected 9/)
  })

  it('charges the final round only for the seats it actually invited back', () => {
    const withFinal = record({
      floor: [turn('A'), turn('B'), turn('C', { position: 'oppose' })],
      // B came back and rejoined the leading position; C refused and held.
      convergence: [turn('B'), turn('C', { position: 'oppose' })],
      trajectory: {
        ...record().trajectory,
        invited: ['B', 'C'],
        moved: [{ seat: 'B', from: 'oppose', to: 'support' }],
        held: ['C'],
      },
      requestsSpent: 8,
      quota: { before: { used: 8, limit: 50, remaining: 42 }, after: { used: 16, limit: 50, remaining: 34 } },
      tally: {
        counts: { support: 2, oppose: 1, abstain: 0, unclear: 0 },
        leading: 'support',
        consensus: 2 / 3,
        dissentShare: 1 / 3,
        dissentingSeats: ['C'],
        unreadableSeats: [],
      },
    })
    expect(validateArchiveRecord(withFinal)).toEqual([])

    // Under-charging the final round is rejected on the cost rule alone.
    expect(validateArchiveRecord({ ...withFinal, requestsSpent: 6 }).join('\n')).toMatch(/expected 8/)

    // And so is claiming a final round that was never run.
    expect(validateArchiveRecord({ ...withFinal, requestsSpent: 10 }).join('\n')).toMatch(/expected 8/)
  })

  it('refuses a record whose trajectory claims a seat was invited but shows no final round for it', () => {
    const broken = record({ trajectory: { ...record().trajectory, invited: ['B'], moved: [], held: [] } })
    expect(validateArchiveRecord(broken).join('\n')).toMatch(/trajectory\.invited/)
  })

  it('refuses a trajectory with fewer than two rounds, because then no discussion is traceable', () => {
    const broken = record({ trajectory: { ...record().trajectory, snapshots: [record().trajectory.snapshots[0]] } })
    expect(validateArchiveRecord(broken).join('\n')).toMatch(/trajectory\.snapshots/)
  })

  it('refuses a seat that is not in the panel', () => {
    expect(validateArchiveRecord(record({ floor: [turn('A'), turn('B'), turn('D')] })).join('\n')).toMatch(/floor\[2\]\.seat/)
  })

  it('refuses a round entry with no reason, because the shared record shows it', () => {
    const { reason: _dropped, ...withoutReason } = turn('A') as Partial<FloorTurn>
    expect(validateArchiveRecord(record({ floor: [withoutReason, turn('B'), turn('C', { position: 'oppose' })] })).join('\n')).toMatch(
      /floor\[0\]\.reason/,
    )
  })

  it('refuses a missing convergence round, so a partial record cannot be filed as complete', () => {
    const { convergence: _omitted, ...withoutConvergence } = record() as Record<string, unknown>
    expect(validateArchiveRecord(withoutConvergence).join('\n')).toMatch(/convergence: missing/)
  })

  it('refuses a measured confidence that carries no log-probability', () => {
    const measured = turn('A', { confidenceBasis: 'measured', confidence: 80, meanLogprob: null })
    expect(validateArchiveRecord(record({ floor: [measured, turn('B'), turn('C', { position: 'oppose' })] })).join('\n')).toMatch(
      /meanLogprob/,
    )
  })

  it('refuses a non-free model in the panel', () => {
    const paid = record({
      panel: [{ label: 'A', modelId: 'a/one:free' }, { label: 'B', modelId: 'b/two' }, { label: 'C', modelId: 'c/three:free' }],
    })
    expect(validateArchiveRecord(paid).join('\n')).toMatch(/must be a `:free` variant id/)
  })

  it('refuses a duplicate id when one already exists', () => {
    expect(validateArchiveRecord(record(), { existingIds: [record().id] }).join('\n')).toMatch(/already present/)
  })

  it('refuses a record with fewer than two seats', () => {
    expect(validateArchiveRecord(record({ panel: [{ label: 'A', modelId: 'a/one:free' }] })).join('\n')).toMatch(/at least two seats/)
  })
})

const member = (index: number): RosterEntry => ({
  id: `${'abc'[index]}/model:free`,
  slug: `${'abc'[index]}/model`,
  provider: 'abc'[index],
  contextLength: 8192,
  maxCompletionTokens: 4096,
  isModerated: false,
  supports: { structuredOutputs: false, responseFormat: false, logprobs: false, tools: false },
})

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => {
  const base = record()
  return {
    id: base.id,
    motion: base.motion,
    locale: 'en',
    startedAt: base.startedAt,
    finishedAt: base.finishedAt,
    agenda: { mode: 'given', proposals: [], chosen: base.motion, chosenBy: 'given', clusterSize: 0 },
    panel: base.panel.map((entry, index) => ({ label: entry.label, member: member(index) })),
    blind: [seat('A'), seat('B'), seat('C')],
    floor: [turn('A'), turn('B'), turn('C', { position: 'oppose' })],
    convergence: [],
    trajectory: base.trajectory as unknown as SessionRecord['trajectory'],
    verdict: {
      tally: base.tally as unknown as SessionRecord['verdict']['tally'],
      synthesis: null,
      synthesisSeat: null,
      synthesisFormatCompliant: true,
    },
    quota: { before: base.quota.before, after: base.quota.after },
    requestsSpent: base.requestsSpent,
    ...overrides,
  }
}

describe('timeline rows', () => {
  it('names a seat that was invited back and held once, not once per round', () => {
    const held = record({
      floor: [turn('A'), turn('B'), turn('C', { position: 'oppose' })],
      convergence: [turn('B'), turn('C', { position: 'oppose' })],
      requestsSpent: 8,
      quota: { before: { used: 8, limit: 50, remaining: 42 }, after: { used: 16, limit: 50, remaining: 34 } },
    })
    const row = toTimelineRow(held)
    expect(row.dissent.map((entry) => entry.seat)).toEqual(['C'])
    expect(row.invited).toBe(2)
    expect(validateTimelineRecord(row)).toEqual([])
  })

  it('refuses a row whose shares were edited after it was written', () => {
    const row = toTimelineRow(record())
    expect(validateTimelineRecord({ ...row, consensus: 1 })).toEqual(expect.arrayContaining([expect.stringMatching(/consensus/)]))
  })

  it('refuses a row that names as dissenting a seat holding the leading position', () => {
    const row = toTimelineRow(record())
    const errors = validateTimelineRecord({ ...row, dissent: [{ seat: 'A', position: 'support', reason: 'because' }] })
    expect(errors.join('\n')).toMatch(/dissent\[A\]/)
  })

  it('refuses a row whose request count does not match its seats and its invited seats', () => {
    const row = toTimelineRow(record())
    expect(validateTimelineRecord({ ...row, requestsSpent: 9 }).join('\n')).toMatch(/expected 6 for 3 seats/)
    expect(validateTimelineRecord({ ...row, invited: 1, requestsSpent: 6 }).join('\n')).toMatch(/expected 7/)
  })

  it('refuses a row whose unreadable list disagrees with its own count', () => {
    const row = toTimelineRow(record())
    expect(validateTimelineRecord({ ...row, unreadable: ['B'] }).join('\n')).toMatch(/unreadable/)
  })

  it('re-derives a row from the count it carries, the same way a record is re-derived', () => {
    const row = toTimelineRow(record({ blind: [seat('A'), seat('B'), seat('C', { position: 'unclear' })] }))
    const recounted = recountTimelineRow(row)
    expect(recounted.leading).toBe(row.leading)
    expect(recounted.consensus).toBeCloseTo(row.consensus, 12)
    expect(recounted.dissentShare).toBeCloseTo(row.dissentShare, 12)
  })

  it('gives the row of a live session the same check the archive gives a stored one', () => {
    const row = toTimelineRecord(session())
    expect(row).not.toBeNull()
    expect(validateTimelineRow(row)).toEqual([])
    expect(validateTimelineRecord(row)).toEqual([])
  })
})

describe('the archive endpoint', () => {
  it('copies the contract into the Functions app byte for byte', async () => {
    execFileSync('node', ['scripts/sync-api-contract.mjs'], { stdio: 'pipe' })
    const [source, copied] = await Promise.all([
      readFile('scripts/archive-contract.mjs'),
      readFile('api/lib/archive-contract.mjs'),
    ])
    expect(copied.equals(source)).toBe(true)
  })

  it('runs the copied contract rather than a second copy of the rule', async () => {
    const endpoint = await readFile('api/archive/index.js', 'utf8')
    expect(endpoint).toContain("import('../lib/archive-contract.mjs')")
  })
})
