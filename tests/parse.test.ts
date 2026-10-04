import { describe, expect, it } from 'vitest'
import {
  confidenceFromLogprobs,
  extractJson,
  normalizePosition,
  positionFromProse,
  readVote,
} from '../src/core/parse'

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"position":"support"}')).toEqual({ position: 'support' })
  })

  it('parses an object wrapped in a markdown fence', () => {
    expect(extractJson('```json\n{"position":"oppose"}\n```')).toEqual({ position: 'oppose' })
  })

  it('recovers an object buried in prose', () => {
    const text = 'Sure. Here is my answer:\n{"position":"abstain","confidence":40}\nHope that helps.'
    expect(extractJson(text)).toEqual({ position: 'abstain', confidence: 40 })
  })

  it('ignores braces that sit inside quoted strings', () => {
    const text = 'The idea is "{not a brace}" and my answer is {"position":"support","reason":"a {b} c"}'
    expect(extractJson(text)).toMatchObject({ position: 'support', reason: 'a {b} c' })
  })

  it('returns null when there is nothing to parse', () => {
    expect(extractJson('I would rather not say.')).toBeNull()
    expect(extractJson('{"position":')).toBeNull()
    expect(extractJson('[1,2,3]')).toBeNull()
  })
})

describe('normalizePosition', () => {
  it('maps the four canonical values', () => {
    expect(normalizePosition('support')).toBe('support')
    expect(normalizePosition('OPPOSE')).toBe('oppose')
    expect(normalizePosition(' Abstain. ')).toBe('abstain')
  })

  it('maps the synonyms free models actually emit', () => {
    expect(normalizePosition('yes')).toBe('support')
    expect(normalizePosition('Evet')).toBe('support')
    expect(normalizePosition('destek')).toBe('support')
    expect(normalizePosition('no')).toBe('oppose')
    expect(normalizePosition('karşıyım')).toBe('unclear')
    expect(normalizePosition('çekimser')).toBe('abstain')
  })

  it('falls back to unclear rather than guessing', () => {
    expect(normalizePosition('maybe')).toBe('unclear')
    expect(normalizePosition(42)).toBe('unclear')
    expect(normalizePosition(undefined)).toBe('unclear')
  })
})

describe('positionFromProse', () => {
  it('reads a labelled position out of a sentence', () => {
    expect(positionFromProse('Position: oppose, because the premise is wrong.')).toBe('oppose')
    expect(positionFromProse('Karar: destek')).toBe('support')
  })

  it('reads a leading stance word', () => {
    expect(positionFromProse('Support. The second clause is untested.')).toBe('support')
  })

  it('returns unclear when the answer carries no stance', () => {
    expect(positionFromProse('It depends on several factors.')).toBe('unclear')
  })
})

describe('confidenceFromLogprobs', () => {
  it('maps a log-probability to a percentage', () => {
    expect(confidenceFromLogprobs(0)).toBe(100)
    expect(confidenceFromLogprobs(Math.log(0.75))).toBe(75)
    expect(confidenceFromLogprobs(-20)).toBeCloseTo(0, 1)
  })

  it('returns null when no log-probability was reported', () => {
    expect(confidenceFromLogprobs(null)).toBeNull()
    expect(confidenceFromLogprobs(Number.NaN)).toBeNull()
  })
})

describe('readVote', () => {
  it('reads a compliant answer and keeps the model’s stated confidence as self-reported', () => {
    const vote = readVote('{"position":"support","reason":"Because A holds.","confidence":80}')
    expect(vote).toMatchObject({
      position: 'support',
      reason: 'Because A holds.',
      confidence: 80,
      confidenceBasis: 'self-reported',
      formatCompliant: true,
    })
  })

  it('prefers a measured log-probability over the stated number and labels it measured', () => {
    const vote = readVote('{"position":"oppose","confidence":20}', { measuredLogprob: Math.log(0.9) })
    expect(vote.confidence).toBe(90)
    expect(vote.confidenceBasis).toBe('measured')
  })

  it('marks a prose answer as non-compliant but still recovers the position', () => {
    const vote = readVote('Position: abstain. I cannot judge this without more context.')
    expect(vote.formatCompliant).toBe(false)
    expect(vote.position).toBe('abstain')
    expect(vote.confidenceBasis).toBe('absent')
    expect(vote.reason).toContain('more context')
  })

  it('keeps an unanswerable answer as unclear rather than inventing one', () => {
    const vote = readVote('I am not able to help with that.')
    expect(vote.position).toBe('unclear')
    expect(vote.formatCompliant).toBe(false)
  })

  it('clamps an out-of-range confidence', () => {
    expect(readVote('{"position":"support","confidence":1400}').confidence).toBe(100)
    expect(readVote('{"position":"support","confidence":-30}').confidence).toBe(0)
  })
})
