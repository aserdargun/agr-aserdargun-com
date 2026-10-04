import { describe, expect, it } from 'vitest'
import { buildPanel, runDeliberation, tally, verdictText } from '../src/core/engine'
import { estimateRequests } from '../src/core/types'
import type { FloorTurn, RosterEntry, Vote } from '../src/core/types'

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

const vote = (seat: string, position: Vote['position']): Vote => ({
  seat,
  memberId: `${seat}:free`,
  position,
  reason: 'because',
  confidence: 60,
  confidenceBasis: 'self-reported',
  formatCompliant: true,
  raw: '{}',
})

const turn = (seat: string, position: FloorTurn['position'], error?: string): FloorTurn => ({
  seat,
  memberId: `${seat}:free`,
  position,
  reason: 'because',
  confidence: 60,
  confidenceBasis: 'self-reported',
  formatCompliant: true,
  raw: '{}',
  changed: false,
  firstRoundPosition: position,
  addressed: [],
  error,
})

describe('estimateRequests', () => {
  it('charges two requests per seat and no synthesis call', () => {
    expect(estimateRequests(3)).toBe(6)
    expect(estimateRequests(5)).toBe(10)
    expect(estimateRequests(7)).toBe(14)
  })
})

describe('tally', () => {
  it('reads the leading position and reports the dissenting share', () => {
    const result = tally(
      [vote('A', 'support'), vote('B', 'support'), vote('C', 'support')],
      [turn('A', 'support'), turn('B', 'support'), turn('C', 'oppose')],
    )

    expect(result.leading).toBe('support')
    expect(result.counts).toEqual({ support: 2, oppose: 1, abstain: 0, unclear: 0 })
    expect(result.consensus).toBeCloseTo(2 / 3, 5)
    expect(result.dissentShare).toBeCloseTo(1 / 3, 5)
    expect(result.dissentingSeats).toEqual(['C'])
  })

  it('prefers the floor round over the blind round when they disagree', () => {
    const blind = [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'abstain')]
    const floor = [turn('A', 'oppose'), turn('B', 'oppose'), turn('C', 'abstain')]

    expect(tally(blind, floor).leading).toBe('oppose')
  })

  it('falls back to the blind position for a seat whose floor call failed', () => {
    const blind = [vote('A', 'support'), vote('B', 'support'), vote('C', 'oppose')]
    const floor = [turn('A', 'support'), turn('B', 'support'), turn('C', 'unclear', 'provider rate limited')]

    const result = tally(blind, floor)
    expect(result.counts).toEqual({ support: 2, oppose: 1, abstain: 0, unclear: 0 })
    expect(result.unreadableSeats).toEqual([])
  })

  it('reports an abstention-dominant panel as no decision', () => {
    const blind = [vote('A', 'abstain'), vote('B', 'abstain'), vote('C', 'support')]
    const result = tally(blind, [turn('A', 'abstain'), turn('B', 'abstain'), turn('C', 'support')])

    expect(result.leading).toBe('abstain')
    expect(result.consensus).toBe(0)
  })

  it('records unreadable seats and keeps them out of the decision', () => {
    const blind = [vote('A', 'support'), vote('B', 'unclear'), vote('C', 'support')]
    const result = tally(blind, [turn('A', 'support'), turn('B', 'unclear'), turn('C', 'support')])

    expect(result.leading).toBe('support')
    expect(result.consensus).toBe(1)
    expect(result.unreadableSeats).toEqual(['B'])
  })
})

describe('verdictText', () => {
  it('states the leaning and denies that it is a correct answer', () => {
    const text = verdictText(
      tally(
        [vote('A', 'support'), vote('B', 'oppose'), vote('C', 'oppose')],
        [turn('A', 'support'), turn('B', 'oppose'), turn('C', 'oppose')],
      ),
      'en',
    )

    expect(text).toContain('leaned against')
    expect(text).toContain('33%')
    expect(text).toMatch(/not a verified correct answer/i)
  })

  it('warns in Turkish when a member ignored the requested shape', () => {
    const text = verdictText(
      tally(
        [vote('A', 'support'), vote('B', 'unclear'), vote('C', 'support')],
        [turn('A', 'support'), turn('B', 'unclear'), turn('C', 'support')],
      ),
      'tr',
    )

    expect(text).toContain('biçime uymadı')
    expect(text).toMatch(/doğrulanmış bir doğru cevap değildir/i)
  })
})

describe('runDeliberation', () => {
  it('never leaks a model name into a prompt, so brands cannot anchor a seat', async () => {
    const panel = buildPanel(
      [member('nvidia/nemotron-3-ultra-550b-a55b'), member('google/gemma-4-31b-it'), member('qwen/qwen3.8-27b')],
      3,
    )
    const slugs = panel.map((seat) => seat.member.slug)
    const providers = panel.map((seat) => seat.member.provider)

    const seen: { model: string; content: string }[] = []
    const result = await runDeliberation(
      panel,
      { proposition: 'Should the free tier be treated as a research instrument?' },
      'en',
      {
        key: 'test',
        call: async ({ model, messages }) => {
          seen.push({ model, content: messages.map((message) => message.content).join('\n') })
          return { text: '{"position":"support","confidence":70}', meanLogprob: null, midStreamError: null }
        },
      },
    )

    expect(result.requestsSpent).toBe(6)
    expect(seen).toHaveLength(6)
    for (const entry of seen) {
      for (const slug of slugs) {
        expect(entry.content).not.toContain(slug)
      }
      for (const provider of providers) {
        expect(entry.content).not.toContain(provider)
      }
    }
  })

  it('sends an identical blind prompt to every seat, then a floor prompt that names the other labels', async () => {
    const panel = buildPanel([member('a/one'), member('b/two'), member('c/three')], 3)
    const prompts: { model: string; content: string }[] = []

    await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async ({ model, messages }) => {
        prompts.push({ model, content: messages[1].content })
        return { text: '{"position":"abstain"}', meanLogprob: null, midStreamError: null }
      },
    })

    const blind = prompts.slice(0, 3).map((entry) => entry.content)
    expect(new Set(blind).size).toBe(1)

    // Each seat is called twice: once blind, once on the floor. The floor call for
    // seat A is the second one recorded for that model.
    const floorA = prompts.filter((entry) => entry.model === 'a/one:free')[1].content
    expect(floorA).toContain('- B:')
    expect(floorA).toContain('- C:')
    expect(floorA).not.toContain('- A:')
  })

  it('surfaces a mid-stream failure as a seat error rather than a truncated position', async () => {
    const panel = buildPanel([member('a/one'), member('b/two')], 2)

    const result = await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async () => ({
        text: '{"position":"sup',
        meanLogprob: null,
        midStreamError: 'Rate limit exceeded',
      }),
    })

    expect(result.blind.every((entry) => entry.position === 'unclear')).toBe(true)
    expect(result.blind.every((entry) => entry.error === 'Rate limit exceeded')).toBe(true)
  })

  it('marks a seat as changed when the floor round moves it', async () => {
    const panel = buildPanel([member('a/one'), member('b/two')], 2)
    let call = 0

    const result = await runDeliberation(panel, { proposition: 'P?' }, 'en', {
      key: 'test',
      call: async () => {
        call += 1
        const position = call <= 2 ? 'support' : 'oppose'
        return { text: `{"position":"${position}"}`, meanLogprob: null, midStreamError: null }
      },
    })

    expect(result.floor.every((entry) => entry.changed)).toBe(true)
    expect(result.floor.every((entry) => entry.firstRoundPosition === 'support')).toBe(true)
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
      call: async ({ model, logprobs, json }) => {
        asked[model] = logprobs
        if (model.startsWith('b/')) expect(json).toBe(false)
        return { text: '{"position":"support"}', meanLogprob: null, midStreamError: null }
      },
    })

    expect(asked['a/measured:free']).toBe(true)
    expect(asked['b/plain:free']).toBe(false)
  })
})
