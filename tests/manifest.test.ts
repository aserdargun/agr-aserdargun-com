import { describe, expect, it } from 'vitest'
import { validateManifest } from '@aserdargun/lab-core'
import manifest from '../lab.manifest.json'

describe('lab.manifest.json', () => {
  it('validates against the shared lab contract', () => {
    const result = validateManifest(manifest)
    if (!result.ok) throw new Error(result.errors.join('\n'))
    expect(result.value.code).toBe('agr')
  })

  it('publishes the address the app is deployed to', () => {
    expect(manifest.canonicalUrl).toBe('https://agr.aserdargun.com/')
  })

  it('allows only evidence kinds Agora can actually stand behind', () => {
    // A model position is a transcript entry, not evidence, so "sourced" and
    // "calculated" cover the roster and the count; nothing claims a model is right.
    expect(manifest.evidencePolicy.allowedKinds).not.toContain('verified')
    expect(manifest.evidencePolicy.allowedKinds).toContain('sourced')
    expect(manifest.evidencePolicy.allowedKinds).toContain('calculated')
  })

  it('states in both languages that agreement is not correctness', () => {
    expect(manifest.evidencePolicy.summary.en).toMatch(/never as correctness/i)
    expect(manifest.evidencePolicy.summary.tr).toMatch(/doğruluk olarak değil/i)
  })

  it('records that no panelist authors the verdict', () => {
    const assumption = manifest.assumptions.find((entry) => entry.id === 'no-model-writes-the-verdict')
    expect(assumption?.description.en).toMatch(/instead of asking a model/i)
  })

  it('separates agreement from accuracy, and names the threshold as declared rather than chosen', () => {
    const assumption = manifest.assumptions.find((entry) => entry.id === 'agreement-is-not-accuracy')
    expect(assumption?.description.en).toMatch(/agreement path/i)
    expect(assumption?.description.en).toMatch(/declared constant/i)
  })

  it('admits the agenda clustering is a heuristic and not a panel consensus', () => {
    const assumption = manifest.assumptions.find((entry) => entry.id === 'lexical-clustering')
    expect(assumption?.description.en).toMatch(/heuristic/i)
    expect(assumption?.description.en).toMatch(/cannot pass as a shared agenda/i)
  })

  it('states that an unreadable address is a gap in the record, not evidence of indifference', () => {
    const assumption = manifest.assumptions.find((entry) => entry.id === 'addressing-is-not-guaranteed')
    expect(assumption?.description.en).toMatch(/gap in the record/i)
  })

  it('offers both ways of choosing a topic as experiments', () => {
    const routes = manifest.experiments.map((entry) => entry.route)
    expect(routes.some((route) => route.includes('topic=panel'))).toBe(true)
    expect(routes.some((route) => route.includes('seats=3'))).toBe(true)
  })
})
