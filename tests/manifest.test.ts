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
    const assumption = manifest.assumptions.find((entry) => entry.id === 'no-synthesis-call')
    expect(assumption?.description.en).toMatch(/instead of asking a model/i)
  })
})
