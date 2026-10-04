import { describe, expect, it } from 'vitest'
import {
  buildPanel,
  buildTrajectory,
  clusterProposals,
  pickByCluster,
  runAgenda,
  runDeliberation,
  tally,
  verdictText,
} from '../src/core/engine'
import { AGREEMENT_THRESHOLD, estimateRequests, type FloorTurn, type Position, type Proposal, type RosterEntry, type Vote } from '../src/core/types'

const member = (slug: string, overrides: Partial<RosterEntry> = {}): RosterEntry => ({
  id: `${slug}:free`,
  slug,
  provider: slug.split('/')[0],
  contextLength: 262144,
  maxCompletionTokens: 8192,
  isModerated: false,
  supports: { structuredOutputs: false, responseFormat: false, logprobs: false, tools: true },
  ...overrides,
})

const vote = (seat: string, position: Position, overrides: Partial<Vote> = {}): Vote => ({
  seat,
  memberId: `${seat.toLowerCase()}/model:free`,
  position,
  reason: 'because',
  confidence: 60,
  confidenceBasis: 'self-reported',
  meanLogprob: null,
  addressed: [],
  formatCompliant: true,
  raw: '{}',
  ...overrides,
})

const turn = (seat: string, position: Position, overrides: Partial<FloorTurn> = {}): FloorTurn => ({
  ...vote(seat, position),
  changed: false,
  firstRoundPosition: position,
  addressed: [],
  ...overrides,
})

const proposal = (seat: string, proposition: string): Proposal => ({
  seat,
  memberId: `${seat.toLowerCase()}/model:free`,
  proposition,
  reason: 'because it matters',
  formatCompliant: true,
  raw: '{}',
})

describe('estimateRequests', () => {
  it('quotes a range, because the final round is only spent on dissenters', () => {
    expect(estimateRequests(5)).toEqual({ min: 10, max: 15 })
    expect(estimateRequests(3, { agenda: true })).toEqual({ min: 9, max: 12 })
  })
})

describe('clusterProposals', () => {
  it('groups proposals that overlap in wording', () => {
    const clusters = clusterProposals([
      proposal('A', 'Regular code review is cheaper than writing more unit tests'),
      proposal('B', 'Writing more unit tests is cheaper than regular code review'),
      proposal('C', 'The euro will devalue before 2030'),
    ])

    expect(clusters).toHaveLength(2)
    expect(clusters[0].seats).toEqual(['A', 'B'])
    expect(pickByCluster(clusters)?.proposition).toContain('code review')
  })

  it('groups the same claim written in different words', () => {
    // Without light stemming these are three singletons: "prevents" is not "prevent"
    // and "typing" is not "types", so the panel would lose its own shared agenda.
    const clusters = clusterProposals([
      proposal('A', 'Strong typing prevents whole classes of bugs'),
      proposal('B', 'Static types prevent whole classes of bugs'),
      proposal('C', 'The euro will devalue before 2030'),
    ])

    expect(clusters).toHaveLength(2)
    expect(clusters[0].seats).toEqual(['A', 'B'])
    expect(clusters[1].seats).toEqual(['C'])
  })

  it('reports singleton clusters so one proposer cannot look like a panel consensus', () => {
    const clusters = clusterProposals([proposal('A', 'Coffee is better than tea')])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].seats).toEqual(['A'])
  })

  it('drops a proposal that failed rather than clustering an empty string', () => {
    const clusters = clusterProposals([
      proposal('A', 'Something debatable'),
      { ...proposal('B', ''), error: 'rate limited' },
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].seats).toEqual(['A'])
  })
})

describe('tally', () => {
  it('reads the latest position each seat actually gave', () => {
    const result = tally({
      blind: [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'abstain')],
      floor: [turn('A', 'oppose'), turn('B', 'oppose'), turn('C', 'abstain')],
      convergence: [],
    })

    expect(result.leading).toBe('oppose')
    expect(result.counts).toEqual({ support: 0, oppose: 2, abstain: 1, unclear: 0 })
  })

  it('counts a dissenter who came back and moved', () => {
    const result = tally({
      blind: [vote('A', 'support'), vote('B', 'oppose')],
      floor: [turn('A', 'support'), turn('B', 'oppose')],
      convergence: [turn('B', 'support')],
    })

    expect(result.leading).toBe('support')
    expect(result.consensus).toBe(1)
    expect(result.dissentingSeats).toEqual([])
  })

  it('keeps a seat that refused to move on the losing side', () => {
    const result = tally({
      blind: [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'oppose')],
      floor: [turn('A', 'support'), turn('B', 'oppose'), turn('C', 'oppose')],
      convergence: [turn('B', 'oppose')],
    })

    expect(result.leading).toBe('oppose')
    expect(result.dissentingSeats).toEqual(['A'])
    expect(result.dissentShare).toBeCloseTo(1 / 3, 6)
  })

  it('ignores a final-round entry that failed, and keeps that seat where it was', () => {
    const result = tally({
      blind: [vote('A', 'support'), vote('B', 'oppose')],
      floor: [turn('A', 'support'), turn('B', 'oppose')],
      convergence: [turn('B', 'unclear', { error: 'rate limited' })],
    })

    expect(result.leading).toBe('support')
    expect(result.dissentingSeats).toEqual(['B'])
  })

  it('treats an abstention-dominant panel as no decision', () => {
    const result = tally({
      blind: [vote('A', 'abstain'), vote('B', 'abstain'), vote('C', 'support')],
      floor: [],
      convergence: [],
    })
    expect(result.leading).toBe('abstain')
    expect(result.consensus).toBe(0)
  })
})

describe('buildTrajectory', () => {
  it('records the agreement path and names who moved', () => {
    const trajectory = buildTrajectory(
      {
        blind: [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'oppose')],
        floor: [turn('A', 'support'), turn('B', 'oppose'), turn('C', 'oppose')],
        convergence: [turn('B', 'support')],
      },
      ['A', 'B', 'C'],
    )

    expect(trajectory.snapshots.map((entry) => entry.kind)).toEqual(['blind', 'floor', 'convergence'])
    expect(trajectory.snapshots[0].agreement).toBeCloseTo(2 / 3, 6)
    expect(trajectory.snapshots[2].agreement).toBeCloseTo(2 / 3, 6)
    expect(trajectory.moved).toEqual([{ seat: 'B', from: 'oppose', to: 'support' }])
    // `held` means a seat that was invited back and refused to move. C never sat in the
    // final round, so it is not held: it was never asked.
    expect(trajectory.invited).toEqual(['B'])
    expect(trajectory.held).toEqual([])
    expect(trajectory.reached).toBe(true)
  })

  it('does not claim agreement when the panel stayed split', () => {
    const trajectory = buildTrajectory(
      {
        blind: [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'abstain')],
        floor: [turn('A', 'support'), turn('B', 'oppose'), turn('C', 'abstain')],
        convergence: [turn('B', 'oppose')],
      },
      ['A', 'B', 'C'],
    )

    expect(trajectory.reached).toBe(false)
    expect(trajectory.threshold).toBeCloseTo(AGREEMENT_THRESHOLD, 9)
  })

  it('has no convergence snapshot when nobody was invited back', () => {
    const trajectory = buildTrajectory(
      { blind: [vote('A', 'support'), vote('B', 'support')], floor: [turn('A', 'support'), turn('B', 'support')], convergence: [] },
      ['A', 'B'],
    )
    expect(trajectory.snapshots).toHaveLength(2)
    expect(trajectory.invited).toEqual([])
    expect(trajectory.reached).toBe(true)
  })
})

describe('verdictText', () => {
  it('reports the movement across the discussion, not just the final number', () => {
    const trajectory = buildTrajectory(
      {
        blind: [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'oppose')],
        floor: [turn('A', 'support'), turn('B', 'oppose'), turn('C', 'oppose')],
        convergence: [turn('B', 'support')],
      },
      ['A', 'B', 'C'],
    )
    const result = tally({
      blind: [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'oppose')],
      floor: [turn('A', 'support'), turn('B', 'oppose'), turn('C', 'oppose')],
      convergence: [turn('B', 'support')],
    })

    const text = verdictText(result, 'en', trajectory)
    expect(text).toMatch(/Agreement ran from 67%/)
    expect(text).toContain('B oppose→support')
    expect(text).toMatch(/not a verified correct answer/i)
  })

  it('says in Turkish when nobody had to be invited back', () => {
    const result = tally({ blind: [vote('A', 'support')], floor: [], convergence: [] })
    expect(verdictText(result, 'tr')).toMatch(/doğrulanmış bir doğru cevap değildir/i)
  })
})

describe('runAgenda', () => {
  it('asks every seat for one proposition and keeps prose answers', async () => {
    const panel = buildPanel([member('a/one'), member('b/two')], 2)
    const result = await runAgenda(panel, 'en', {
      key: 'test',
      call: async ({ model }) => ({
        text: model.startsWith('a/')
          ? '{"proposition":"Small models are good enough for drafts","reason":"Cheap and fast."}'
          : 'Static types prevent whole classes of bugs. They are worth the cost.',
        meanLogprob: null,
        midStreamError: null,
      }),
    })

    expect(result).toHaveLength(2)
    expect(result[0].formatCompliant).toBe(true)
    expect(result[0].proposition).toContain('drafts')
    expect(result[1].formatCompliant).toBe(false)
    expect(result[1].proposition).toContain('Static types')
  })
})

describe('runDeliberation', () => {
  const panelOf3 = () => buildPanel([member('nvidia/nemotron-3-ultra-550b-a55b'), member('google/gemma-4-31b-it'), member('qwen/qwen3.8-27b')], 3)

  it('never leaks a model name into a prompt, so brands cannot anchor a seat', async () => {
    const panel = panelOf3()
    const slugs = panel.map((seat) => seat.member.slug)
    const providers = panel.map((seat) => seat.member.provider)
    const seen: { model: string; content: string }[] = []

    await runDeliberation(panel, { proposition: 'Should the free tier be a research instrument?' }, 'en', {
      key: 'test',
      call: async ({ model, messages }) => {
        seen.push({ model, content: messages.map((message) => message.content).join('\n') })
        return { text: '{"position":"support","confidence":70}', meanLogprob: null, midStreamError: null }
      },
    })

    expect(seen.length).toBeGreaterThan(0)
    for (const entry of seen) {
      for (const slug of slugs) expect(entry.content).not.toContain(slug)
      for (const provider of providers) expect(entry.content).not.toContain(provider)
    }
  })

  it('sends one identical blind prompt, then a floor prompt that names the other seats', async () => {
    const panel = buildPanel([member('a/one'), member('b/two'), member('c/three')], 3)
    const prompts: { model: string; content: string }[] = []

    await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async ({ model, messages }) => {
        prompts.push({ model, content: messages[1].content })
        return { text: '{"position":"abstain","addressed":["B"]}', meanLogprob: null, midStreamError: null }
      },
    })

    const blind = prompts.slice(0, 3).map((entry) => entry.content)
    expect(new Set(blind).size).toBe(1)

    const floorA = prompts.filter((entry) => entry.model === 'a/one:free')[1].content
    expect(floorA).toContain('- B:')
    expect(floorA).toContain('- C:')
    expect(floorA).not.toContain('- A:')
  })

  it('spends no final-round request when the panel already agrees', async () => {
    const panel = buildPanel([member('a/one'), member('b/two')], 2)
    const result = await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async () => ({ text: '{"position":"support"}', meanLogprob: null, midStreamError: null }),
    })

    expect(result.convergence).toHaveLength(0)
    expect(result.requestsSpent).toBe(4)
    expect(result.trajectory.reached).toBe(true)
  })

  it('invites only the dissenters back, counts the extra request, and names who held', async () => {
    const panel = buildPanel([member('a/one'), member('b/two'), member('c/three')], 3)
    const seatOf: Record<string, string> = { 'a/one:free': 'A', 'b/two:free': 'B', 'c/three:free': 'C' }
    const answers: Record<string, Record<string, Position>> = {
      // Everyone starts out supporting it.
      blind: { A: 'support', B: 'support', C: 'support' },
      // On the floor B and C are talked round to opposing, leaving A in the minority.
      floor: { A: 'support', B: 'oppose', C: 'oppose' },
      // A is invited back and does not move.
      convergence: { A: 'support' },
    }
    let current = 'blind'

    const result = await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async ({ model }) => {
        const seat = seatOf[model]
        return { text: `{"position":"${answers[current][seat]}","addressed":["B"]}`, meanLogprob: null, midStreamError: null }
      },
      onProgress: (round) => {
        current = round
      },
    })

    expect(result.floor.map((entry) => [entry.seat, entry.position])).toEqual([
      ['A', 'support'],
      ['B', 'oppose'],
      ['C', 'oppose'],
    ])
    expect(result.convergence.map((entry) => entry.seat)).toEqual(['A'])
    expect(result.requestsSpent).toBe(7)
    expect(result.trajectory.invited).toEqual(['A'])
    expect(result.trajectory.moved).toEqual([])
    expect(result.trajectory.held).toEqual(['A'])
    expect(result.tally.leading).toBe('oppose')
    expect(result.tally.dissentingSeats).toEqual(['A'])
  })

  it('records a dissenter that comes back and moves as a move, not a hold', async () => {
    const panel = buildPanel([member('a/one'), member('b/two'), member('c/three')], 3)
    const seatOf: Record<string, string> = { 'a/one:free': 'A', 'b/two:free': 'B', 'c/three:free': 'C' }
    const answers: Record<string, Record<string, Position>> = {
      blind: { A: 'support', B: 'support', C: 'support' },
      floor: { A: 'support', B: 'oppose', C: 'oppose' },
      convergence: { A: 'oppose' },
    }
    let current = 'blind'

    const result = await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async ({ model }) => {
        const seat = seatOf[model]
        return { text: `{"position":"${answers[current][seat]}"}`, meanLogprob: null, midStreamError: null }
      },
      onProgress: (round) => {
        current = round
      },
    })

    expect(result.trajectory.moved).toEqual([{ seat: 'A', from: 'support', to: 'oppose' }])
    expect(result.trajectory.held).toEqual([])
    expect(result.requestsSpent).toBe(7)
  })

  it('surfaces a mid-stream failure as a seat error rather than a truncated position', async () => {
    const panel = buildPanel([member('a/one'), member('b/two')], 2)
    const result = await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async () => ({ text: '{"position":"sup', meanLogprob: null, midStreamError: 'Rate limit exceeded' }),
    })

    expect(result.blind.every((entry) => entry.position === 'unclear')).toBe(true)
    expect(result.blind.every((entry) => entry.error === 'Rate limit exceeded')).toBe(true)
  })

  it('never lets a seat address itself', async () => {
    const panel = buildPanel([member('a/one'), member('b/two')], 2)
    const result = await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async () => ({ text: '{"position":"support","addressed":["A","B"]}', meanLogprob: null, midStreamError: null }),
    })

    // The blind round withholds addressing entirely: nobody has been heard yet.
    expect(result.blind.every((entry) => entry.addressed.length === 0)).toBe(true)
    for (const entry of result.floor) expect(entry.addressed).not.toContain(entry.seat)
  })

  it('only requests logprobs from members that advertise them', async () => {
    const panel = buildPanel(
      [
        member('a/measured', { supports: { structuredOutputs: false, responseFormat: false, logprobs: true, tools: false } }),
        member('b/plain'),
      ],
      2,
    )
    const asked: Record<string, boolean> = {}

    await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async ({ model, logprobs }) => {
        asked[model] = logprobs
        return { text: '{"position":"support"}', meanLogprob: null, midStreamError: null }
      },
    })

    expect(asked['a/measured:free']).toBe(true)
    expect(asked['b/plain:free']).toBe(false)
  })
})
