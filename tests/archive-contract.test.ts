import { describe, expect, it } from 'vitest'
import { ARCHIVE_SCHEMA_VERSION, recount, validateArchiveRecord } from '../scripts/archive-contract.mjs'
import { tally } from '../src/core/engine'
import type { FloorTurn, Position, Vote } from '../src/core/types'

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
