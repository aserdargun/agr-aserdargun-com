#!/usr/bin/env node
/**
 * Agora archive tool.
 *
 * The central archive is a directory of verdict records committed to the repository.
 * That is a deliberate choice over a public write endpoint: the timeline is then
 * reviewed, versioned and reverted like any other evidence in this portfolio, and
 * nothing has to be trusted because it arrived anonymously.
 *
 *   node scripts/archive.mjs add <file.json>   validate a record and file it
 *   node scripts/archive.mjs verify            validate every record
 *   node scripts/archive.mjs build             validate and emit dist/timeline.json
 */
import { readdir, readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { toTimelineRow, validateArchiveRecord } from './archive-contract.mjs'

const ARCHIVE_DIR = 'archive'
const SHARED = join('src', 'data', 'timeline.json')
const OUT = join('src', 'data', 'timeline.generated.json')

const listRecords = async () => {
  let names = []
  try {
    names = await readdir(ARCHIVE_DIR)
  } catch {
    return []
  }
  return names.filter((name) => name.endsWith('.json')).sort()
}

const readRecord = async (name) => JSON.parse(await readFile(join(ARCHIVE_DIR, name), 'utf8'))

const readAll = async () => {
  const names = await listRecords()
  return Promise.all(names.map(async (name) => ({ name, record: await readRecord(name) })))
}

const report = (label, errors) => {
  if (errors.length === 0) {
    console.log(`${label}: ok`)
    return true
  }
  console.error(`${label}: ${errors.length} problem(s)`)
  for (const error of errors) console.error(`  - ${error}`)
  return false
}

const mode = process.argv[2]

if (mode === 'add') {
  const source = process.argv[3]
  if (!source) {
    console.error('Usage: node scripts/archive.mjs add <file.json>')
    process.exit(2)
  }

  const candidate = JSON.parse(await readFile(source, 'utf8'))
  const existing = await readAll()
  const errors = validateArchiveRecord(candidate, { existingIds: existing.map(({ record }) => record?.id) })
  if (!report(`archive add ${basename(source)}`, errors)) process.exit(1)

  const id = String(candidate.id).replace(/[^A-Za-z0-9._-]/g, '-')
  const target = join(ARCHIVE_DIR, `${id}.json`)
  await mkdir(ARCHIVE_DIR, { recursive: true })
  await copyFile(source, target)
  console.log(`filed as archive/${id}.json`)
  console.log('Commit it. `npm run archive:verify` runs in CI before the timeline is published.')
} else if (mode === 'verify') {
  const entries = await readAll()
  if (entries.length === 0) {
    console.log('archive: empty (no verdict records filed yet)')
  } else {
    const seen = new Set()
    let failed = false
    for (const { name, record } of entries) {
      const errors = validateArchiveRecord(record, { existingIds: [...seen] })
      if (!report(name, errors)) failed = true
      if (typeof record?.id === 'string') seen.add(record.id)
    }
    if (failed) process.exit(1)
    console.log(`archive: ${entries.length} record(s) valid`)
  }
} else if (mode === 'build') {
  const entries = await readAll()
  const seen = new Set()
  const invalid = []

  for (const { name, record } of entries) {
    const errors = validateArchiveRecord(record, { existingIds: [...seen] })
    if (errors.length > 0) invalid.push({ name, errors })
    if (typeof record?.id === 'string') seen.add(record.id)
  }

  // A bad record must not silently vanish from the timeline, and it must not ship either.
  if (invalid.length > 0) {
    for (const { name, errors } of invalid) {
      console.error(`archive/${name}:`)
      for (const error of errors) console.error(`  - ${error}`)
    }
    process.exit(1)
  }

  const fromArchive = entries.map(({ record }) => toTimelineRow(record))

  // The visitor's own sessions are appended at build time from a file that is not
  // committed, so a private run never lands in the shared timeline by accident.
  let fromLocal = []
  try {
    const local = JSON.parse(await readFile(SHARED, 'utf8'))
    if (Array.isArray(local?.records)) fromLocal = local.records
  } catch {
    // No local file yet; the shared timeline is simply the archive alone.
  }

  const ids = new Set(fromArchive.map((entry) => entry.id))
  const merged = [...fromArchive, ...fromLocal.filter((entry) => !ids.has(entry?.id))]
  merged.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))

  await writeFile(
    OUT,
    JSON.stringify({ schemaVersion: '0.1', generatedAt: new Date().toISOString(), records: merged }, null, 2) + '\n',
  )
  console.log(`timeline: ${fromArchive.length} from the archive, ${fromLocal.length} local, ${merged.length} total -> ${OUT}`)
} else {
  console.error('Usage: node scripts/archive.mjs <add|verify|build>')
  process.exit(2)
}
