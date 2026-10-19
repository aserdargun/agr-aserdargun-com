import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The browser calls OpenRouter directly, so the Content-Security-Policy is the
 * only thing standing between a misconfigured build and a panel that cannot
 * talk to anyone. That coupling is declared in AGENTS.md — removing the
 * OpenRouter origin "breaks every call in production while leaving the build
 * green" — and nothing in the suite enforced it: the whole gate (unit tests,
 * bundle, `verify:artifact`) passed with the origin deleted from `connect-src`,
 * because no test ever read the CSP.
 *
 * The origins are read out of the transport rather than written here, so this
 * test follows a change of provider instead of going stale beside it.
 */

const transport = readFileSync(new URL('../src/core/openrouter.ts', import.meta.url), 'utf8')
const config = JSON.parse(
  readFileSync(new URL('../public/staticwebapp.config.json', import.meta.url), 'utf8'),
)

/**
 * Origins the transport actually calls. Only the request base counts: the file
 * also carries `HTTP-Referer`, which names this site's own origin and is a
 * header value rather than a connection target.
 */
function transportOrigins(source: string): string[] {
  const base = source.match(/const BASE = '(https:\/\/[a-z0-9.-]+)/)
  if (!base) throw new Error('Could not read the request base from src/core/openrouter.ts')
  return [...new Set([base[1]])]
}

const csp: string = config.globalHeaders?.['Content-Security-Policy'] ?? ''
const directive = (name: string) =>
  csp.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `))

describe('Content-Security-Policy against the transport it has to permit', () => {
  it('permits every origin the transport calls', () => {
    const origins = transportOrigins(transport)
    expect(origins.length).toBeGreaterThan(0)
    for (const origin of origins) {
      expect(
        directive('connect-src'),
        `${origin} is called by src/core/openrouter.ts but is not in connect-src: every production request would be blocked`,
      ).toContain(origin)
    }
  })

  it('names OpenRouter in connect-src, so the panel is not sealed off from its only provider', () => {
    expect(directive('connect-src')).toContain('https://openrouter.ai')
  })

  it('keeps /api same-origin rather than widening connect-src to reach blob storage', () => {
    // The browser holds no storage credential; the archive is reached through
    // /api on this same app. A blob origin here would be a regression.
    const connectSrc = directive('connect-src') ?? ''
    expect(connectSrc).toContain("'self'")
    expect(connectSrc).not.toMatch(/blob\.core\.windows\.net/)
  })

  it('excludes /api from the SPA fallback so the archive endpoint is never rewritten to the shell', () => {
    expect(config.navigationFallback.exclude).toContain('/api/*')
  })
})