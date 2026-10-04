import { describe, expect, it } from 'vitest'
import { curateRoster } from '../src/core/roster'
import { fetchCatalog } from '../src/core/openrouter'

/**
 * Live smoke test against OpenRouter's public catalogue.
 *
 * The free roster rotates, so the stubbed acceptance suite cannot catch a shape change
 * upstream. This is opt-in and never runs in CI: `AGR_LIVE=1 npm test` hits the real
 * endpoint, which is public and spends no quota.
 */
const live = process.env.AGR_LIVE === '1'
const describeLive = live ? describe : describe.skip

describeLive('live free roster', () => {
  it('seats the real catalogue and excludes non-deliberating models with a reason', async () => {
    const roster = curateRoster(await fetchCatalog(), new Date().toISOString().slice(0, 10))

    // A rotation can only shrink or grow this list, never empty it.
    expect(roster.members.length).toBeGreaterThan(0)
    expect(roster.members.length + roster.excluded.length).toBeGreaterThan(0)

    for (const member of roster.members) {
      expect(member.id).toMatch(/:free$/)
      expect(member.slug.length).toBeGreaterThan(0)
      expect(member.contextLength).toBeGreaterThan(0)
    }

    // Nothing that cannot return text may ever be seated.
    expect(roster.members.map((member) => member.id)).not.toContain('nvidia/nemotron-3.5-content-safety:free')

    // Every excluded entry must carry a reason in both languages.
    for (const entry of roster.excluded) {
      expect(entry.reason.en.length).toBeGreaterThan(20)
      expect(entry.reason.tr?.length ?? 0).toBeGreaterThan(20)
    }

    // Only a minority advertises structured output. If that ever becomes a majority the
    // interface copy about prose answers is wrong and has to be rewritten.
    const shaped = roster.members.filter(
      (member) => member.supports.structuredOutputs || member.supports.responseFormat,
    )
    expect(shaped.length).toBeLessThan(roster.members.length)

    console.log(
      `live roster: ${roster.members.length} seated, ${shaped.length} can emit JSON, ${roster.excluded.length} excluded`,
    )
  })
})
