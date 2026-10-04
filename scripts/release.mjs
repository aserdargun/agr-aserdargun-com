import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateReleaseManifest } from './release-contract.mjs'

const root = 'dist'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function files(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name
    if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), path + '/'))
    else if (path !== 'release.json') result.push(path)
  }
  return result.sort()
}
const mode = process.argv[2]
if (mode === 'write') {
  await copyFile('lab.manifest.json', join(root, 'lab.manifest.json'))
  let commit = process.env.GITHUB_SHA
  if (!commit) {
    try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
    catch { commit = 'working-tree' }
  }
  if (process.env.CI && !/^[a-f0-9]{40}$/.test(commit)) throw new Error('CI requires a full commit SHA')
  const assets = []
  for (const path of await files(root)) {
    const bytes = await readFile(join(root, path))
    assets.push({ path, bytes: bytes.length, sha256: digest(bytes) })
  }
  await writeFile(join(root, 'release.json'), JSON.stringify({ application: 'AGR', commit, builtAt: new Date().toISOString(), assets }, null, 2) + '\n')
  console.log(`AGR release manifest: ${assets.length} files, ${commit}`)
} else if (mode === 'verify') {
  const manifest = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'))
  validateReleaseManifest(manifest)
  const paths = await files(root)
  if (JSON.stringify(paths) !== JSON.stringify(manifest.assets.map(a => a.path))) throw new Error('Artifact file set mismatch')
  for (const asset of manifest.assets) {
    const bytes = await readFile(join(root, asset.path))
    if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error(`Artifact mismatch: ${asset.path}`)
  }
  const html = await readFile(join(root, 'index.html'), 'utf8')
  for (const [, path] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) {
    if (!paths.includes(path.slice(1))) throw new Error(`Missing HTML asset: ${path}`)
  }
  for (const path of ['index.html', 'favicon.svg', 'staticwebapp.config.json', 'lab.manifest.json']) {
    if (!paths.includes(path)) throw new Error(`Missing required artifact: ${path}`)
  }
  console.log(`Verified ${paths.length} artifact files for ${manifest.commit}`)
} else throw new Error('Use write or verify')
