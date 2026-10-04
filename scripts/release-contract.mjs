/** Shared validation before trusting local files or fetching a production asset. */
export function validateReleaseManifest(manifest) {
  if (!manifest || manifest.application !== 'AGR' ||
      !/^[a-f0-9]{40}$/.test(manifest.commit ?? '') ||
      typeof manifest.builtAt !== 'string' || !Number.isFinite(Date.parse(manifest.builtAt)))
    throw new Error('Missing or invalid AGR release metadata')
  if (!Array.isArray(manifest.assets) || !manifest.assets.length)
    throw new Error('Release asset list is empty or missing')
  const paths = new Set()
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.path !== 'string' ||
        !/^[a-zA-Z0-9_./-]+$/.test(asset.path) ||
        asset.path.split('/').some(part => !part || part === '.' || part === '..') ||
        asset.path === 'release.json' || paths.has(asset.path) ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256 ?? ''))
      throw new Error('Invalid or duplicate release asset')
    paths.add(asset.path)
  }
  for (const required of ['index.html', 'favicon.svg', 'staticwebapp.config.json']) {
    if (!paths.has(required)) throw new Error(`Missing required artifact: ${required}`)
  }
}
