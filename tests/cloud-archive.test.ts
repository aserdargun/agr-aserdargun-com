import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSharedTimeline, storeRecord } from '../src/core/cloud-archive'
import { toArchiveRecord, toTimelineRecord, type TimelineRecord } from '../src/core/archive-schema'
import { toTimelineRow } from '../scripts/archive-contract.mjs'
import type { FloorTurn, RosterEntry, SessionRecord, Vote } from '../src/core/types'

/**
 * The endpoint is exercised through a stubbed `fetch` rather than a live archive: these
 * tests are about what the browser does with an answer, and a test that needs a storage
 * account would stop being a unit test.
 */
const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const member = (index: number): RosterEntry => ({
  id: `${'abc'[index]}/model:free`,
  slug: `${'abc'[index]}/model`,
  provider: 'abc'[index],
  contextLength: 8192,
  maxCompletionTokens: 4096,
  isModerated: false,
  supports: { structuredOutputs: false, responseFormat: false, logprobs: false, tools: false },
})

const vote = (label: string, position: Vote['position'] = 'support'): Vote => ({
  seat: label,
  memberId: `${label.toLowerCase()}/model:free`,
  position,
  reason: 'because',
  confidence: 70,
  confidenceBasis: 'self-reported',
  meanLogprob: null,
  addressed: [],
  formatCompliant: true,
  raw: '{}',
})

const turn = (label: string, position: Vote['position'] = 'support'): FloorTurn => ({
  ...vote(label, position),
  changed: false,
  firstRoundPosition: 'support',
})

const session = (): SessionRecord => {
  const blind = [vote('A'), vote('B'), vote('C')]
  const floor = [turn('A'), turn('B'), turn('C', 'oppose')]
  return {
    id: '2026-10-04T16-00-00-5',
    motion: 'The free tier is a research instrument.',
    locale: 'en',
    startedAt: '2026-10-04T16:00:00.000Z',
    finishedAt: '2026-10-04T16:04:00.000Z',
    agenda: { mode: 'given', proposals: [], chosen: 'The free tier is a research instrument.', chosenBy: 'given', clusterSize: 0 },
    panel: [0, 1, 2].map((index) => ({ label: 'ABC'[index], member: member(index) })),
    blind,
    floor,
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
    verdict: {
      tally: {
        counts: { support: 2, oppose: 1, abstain: 0, unclear: 0 },
        weights: { support: 2, oppose: 1, abstain: 0, unclear: 0 },
        consensus: 2 / 3,
        dissentShare: 1 / 3,
        leading: 'support',
        dissentingSeats: ['C'],
        unreadableSeats: [],
      },
      synthesis: null,
      synthesisSeat: null,
      synthesisFormatCompliant: true,
    },
    quota: { before: { used: 8, limit: 50, remaining: 42 }, after: { used: 14, limit: 50, remaining: 36 } },
    requestsSpent: 6,
  }
}

const archiveRecord = () => {
  const candidate = toArchiveRecord(session())
  if (!candidate) throw new Error('fixture must be archivable')
  return candidate
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('filing a session', () => {
  it('posts the record to the site’s own route and reports the stored id', async () => {
    const seen: { url?: string; method?: string; body?: unknown } = {}
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        seen.url = url
        seen.method = init.method
        seen.body = JSON.parse(typeof init.body === 'string' ? init.body : '')
        return jsonResponse(201, { id: '2026-10-04T16-00-00-5', storedAt: '2026-10-04T16:05:00.000Z' })
      }),
    )

    const result = await storeRecord(archiveRecord())

    expect(result).toEqual({ ok: true, id: '2026-10-04T16-00-00-5' })
    expect(seen.url).toBe('/api/archive')
    expect(seen.method).toBe('POST')
    // The visitor's key is not part of the payload: the record carries the panel and the
    // count, and nothing that could identify who ran it.
    expect(JSON.stringify(seen.body)).not.toMatch(/sk-or-v1/)
  })

  it('reports what the archive refused, so the card can say why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, { errors: ['quota: the record does not prove its own cost'] })))

    const result = await storeRecord(archiveRecord())

    expect(result).toEqual({ ok: false, reason: 'refused', errors: ['quota: the record does not prove its own cost'] })
  })

  it('reports an unreachable archive as a state rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('failed to fetch')
      }),
    )

    expect(await storeRecord(archiveRecord())).toEqual({ ok: false, reason: 'unreachable', errors: [] })
  })

  it('does not call a rewritten 200 a stored record', async () => {
    // A static host answers unknown paths with the app shell and a 200. The archive copy
    // would not exist, so the card must say the archive is not there.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><title>Agora</title>', { status: 200 })))

    expect(await storeRecord(archiveRecord())).toEqual({ ok: false, reason: 'unreachable', errors: [] })
  })
})

describe('reading the shared record', () => {
  const row = (): TimelineRecord => toTimelineRecord(session()) as TimelineRecord

  it('accepts rows the contract accepts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { schemaVersion: '0.1', records: [row()], refused: 0 })))

    const result = await fetchSharedTimeline()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.records).toHaveLength(1)
      expect(result.records[0].motion).toBe('The free tier is a research instrument.')
    }
  })

  it('drops a row whose numbers were edited, and says how many it dropped', async () => {
    const forged = { ...toTimelineRow(archiveRecord()), consensus: 1 }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { records: [row(), forged] })))

    const result = await fetchSharedTimeline()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.records).toHaveLength(1)
      expect(result.refused).toBe(1)
    }
  })

  it('reports a missing endpoint instead of pretending the record is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { errors: ['not found'] })))

    const result = await fetchSharedTimeline()

    expect(result.ok).toBe(false)
  })
})
