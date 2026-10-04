import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { validateReleaseManifest } from './release-contract.mjs'

const [address, expectedCommit] = process.argv.slice(2)
if (!address || !/^[a-f0-9]{40}$/.test(expectedCommit || '')) {
  throw new Error('Usage: node scripts/verify-live.mjs https://production-host FULL_COMMIT_SHA')
}
const origin = new URL(address)
if (origin.protocol !== 'https:') throw new Error('Production verification requires HTTPS')
async function get(path) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(30000), cache: 'no-store' })
  if (response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`)
  return response
}
const response = await get('/release.json')
if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Incorrect release MIME type')
const manifest = await response.json()
validateReleaseManifest(manifest)
if (manifest.application !== 'AGR' || manifest.commit !== expectedCommit) throw new Error('Live commit does not match intended release')
const types = {
  '.html': ['text/html'], '.js': ['application/javascript', 'text/javascript'],
  '.css': ['text/css'], '.svg': ['image/svg+xml'], '.woff': ['font/woff', 'application/font-woff'],
  '.woff2': ['font/woff2'], '.png': ['image/png'], '.json': ['application/json'],
}
let verified = 0
for (const asset of manifest.assets) {
  // Azure consumes this configuration rather than serving it as a public asset.
  if (asset.path === 'staticwebapp.config.json') continue
  if (!/^(assets\/[^/]+|index\.html|favicon\.svg|favicon-(32|192)\.png|apple-touch-icon\.png|lab\.manifest\.json)$/.test(asset.path)) throw new Error(`Unexpected asset path: ${asset.path}`)
  const result = await get('/' + asset.path)
  const mime = result.headers.get('content-type')?.split(';')[0]
  if (!types[extname(asset.path)]?.includes(mime)) throw new Error(`Incorrect MIME for ${asset.path}: ${mime}`)
  const bytes = Buffer.from(await result.arrayBuffer())
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Live hash mismatch: ${asset.path}`)
  }
  verified++
}
console.log(JSON.stringify({ url: origin.origin, commit: manifest.commit, builtAt: manifest.builtAt, verifiedAssets: verified, status: 'passed' }, null, 2))
