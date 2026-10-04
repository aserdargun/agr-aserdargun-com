import { describe, expect, it } from 'vitest'
import { curateRoster } from '../src/core/roster'

const member = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  context_length: 262144,
  supported_parameters: ['max_tokens', 'tools'],
  architecture: { output_modalities: ['text'] },
  top_provider: { max_completion_tokens: 8192, is_moderated: false },
  ...extra,
})

describe('curateRoster', () => {
  it('seats free chat models and strips the variant suffix from the display slug', () => {
    const roster = curateRoster({ data: [member('nvidia/nemotron-3-super-120b-a12b:free')] }, '2026-10-04')

    expect(roster.members).toHaveLength(1)
    expect(roster.members[0].slug).toBe('nvidia/nemotron-3-super-120b-a12b')
    expect(roster.members[0].id).toBe('nvidia/nemotron-3-super-120b-a12b:free')
    expect(roster.members[0].provider).toBe('nvidia')
  })

  it('ignores paid variants', () => {
    const roster = curateRoster({ data: [member('qwen/qwen3.8-27b')] }, '2026-10-04')
    expect(roster.members).toHaveLength(0)
  })

  it('keeps the content-safety classifier off the panel even though it passes every structural check', () => {
    // This model reports text output and a normal completion ceiling, so only the
    // explicit exclusion list can catch it.
    const safety = member('nvidia/nemotron-3.5-content-safety:free', {
      architecture: { output_modalities: ['text'] },
    })
    const roster = curateRoster({ data: [safety] }, '2026-10-04')

    expect(roster.members).toHaveLength(0)
    expect(roster.excluded).toHaveLength(1)
    expect(roster.excluded[0].id).toBe('nvidia/nemotron-3.5-content-safety:free')
    expect(roster.excluded[0].reason.en).toMatch(/content-safety classifier/i)
    expect(roster.excluded[0].reason.tr).toBeTruthy()
  })

  it('excludes a model that cannot return text and states the modalities', () => {
    const roster = curateRoster(
      { data: [member('someone/imagen:free', { architecture: { output_modalities: ['image'] } })] },
      '2026-10-04',
    )
    expect(roster.members).toHaveLength(0)
    expect(roster.excluded[0].reason.en).toContain('image')
  })

  it('reads capability flags from supported_parameters', () => {
    const roster = curateRoster(
      {
        data: [
          member('a/strict:free', { supported_parameters: ['structured_outputs', 'response_format', 'logprobs'] }),
          member('b/loose:free', { supported_parameters: [] }),
        ],
      },
      '2026-10-04',
    )

    // Members are sorted by slug, so `a/strict` is seated first.
    const [strict, loose] = roster.members
    expect(strict.slug).toBe('a/strict')
    expect(strict.supports).toEqual({
      structuredOutputs: true,
      responseFormat: true,
      logprobs: true,
      tools: false,
    })
    expect(loose.slug).toBe('b/loose')
    expect(loose.supports.structuredOutputs).toBe(false)
  })

  it('survives a malformed payload without throwing', () => {
    expect(curateRoster(null, '2026-10-04')).toEqual({ members: [], excluded: [], observedAt: '2026-10-04' })
    expect(curateRoster({ data: 'nope' }, '2026-10-04').members).toEqual([])
  })
})
