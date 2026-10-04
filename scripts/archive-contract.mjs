/**
 * Archive contract for Agora verdict records.
 *
 * Plain JS on purpose: this module is imported both by the browser bundle (to validate
 * before an export is offered) and by the Node build script, and the repository already
 * keeps its other cross-boundary contracts as plain `.mjs` (see `release-contract.mjs`).
 *
 * The central rule is that a submitted record is never trusted. The count is re-derived
 * from the stored positions, and the arithmetic and the quota proof are re-checked. A
 * record that fails is not archived, whatever it claims.
 */

export const ARCHIVE_SCHEMA_VERSION = '0.1'

export const POSITIONS = ['support', 'oppose', 'abstain', 'unclear']

export const CONFIDENCE_BASES = ['measured', 'self-reported', 'absent']

const LOCALES = ['en', 'tr']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const isIsoDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))

/** Seat labels are single letters; a record must not invent a wider seat space. */
const SEAT = /^[A-J]$/

/**
 * Re-derive the count from the stored rounds.
 *
 * This mirrors `tally()` in `src/core/engine.ts`. `tests/archive-contract.test.ts`
 * cross-checks the two over shared fixtures, so the duplication cannot drift silently.
 */
export function recount(record) {
  const counts = { support: 0, oppose: 0, abstain: 0, unclear: 0 }
  const effective = new Map()

  for (const vote of record.blind ?? []) {
    if (isObject(vote) && typeof vote.seat === 'string') effective.set(vote.seat, vote.position)
  }
  for (const round of [record.floor, record.convergence]) {
    for (const turn of round ?? []) {
      if (!isObject(turn) || typeof turn.seat !== 'string') continue
      if (typeof turn.error === 'string' && turn.error.length > 0) continue
      effective.set(turn.seat, turn.position)
    }
  }

  for (const position of effective.values()) {
    if (Object.hasOwn(counts, position)) counts[position] += 1
  }

  const decided = counts.support + counts.oppose
  const leading = decided === 0 ? 'abstain' : counts.abstain > decided ? 'abstain' : counts.support >= counts.oppose ? 'support' : 'oppose'
  const consensus = decided === 0 || leading === 'abstain' ? 0 : counts[leading] / decided

  const dissentingSeats = [...effective.entries()].filter(([, position]) => position !== leading).map(([seat]) => seat).sort()
  const unreadableSeats = [...effective.entries()].filter(([, position]) => position === 'unclear').map(([seat]) => seat).sort()

  return { counts, leading, consensus, dissentShare: leading === 'abstain' ? 0 : 1 - consensus, dissentingSeats, unreadableSeats }
}

/**
 * Validate one archive record.
 *
 * Returns every problem found rather than the first, so a rejected export can explain
 * itself. `existingIds` catches a duplicate id when adding to an archive.
 */
export function validateArchiveRecord(record, options = {}) {
  const { existingIds = [] } = options
  const errors = []
  const fail = (path, message) => errors.push(`${path}: ${message}`)

  if (!isObject(record)) return ['record: not an object']
  if (record.schemaVersion !== ARCHIVE_SCHEMA_VERSION) {
    fail('schemaVersion', `expected ${ARCHIVE_SCHEMA_VERSION}, got ${JSON.stringify(record.schemaVersion)}`)
  }
  if (typeof record.id !== 'string' || record.id.length < 4) fail('id', 'missing or too short')
  else if (existingIds.includes(record.id)) fail('id', 'already present in the archive')

  if (typeof record.motion !== 'string' || record.motion.trim().length < 8) {
    fail('motion', 'a proposition of at least 8 characters is required')
  }
  if (record.motion && record.motion.length > 600) fail('motion', 'longer than 600 characters')
  if (!LOCALES.includes(record.locale)) fail('locale', `must be one of ${LOCALES.join(', ')}`)
  if (!isIsoDate(record.startedAt)) fail('startedAt', 'not a valid timestamp')
  if (!isIsoDate(record.finishedAt)) fail('finishedAt', 'not a valid timestamp')

  if (!Array.isArray(record.panel) || record.panel.length < 2) fail('panel', 'at least two seats are required')
  if (!Array.isArray(record.panel) || record.panel.length > 10) fail('panel', 'more than ten seats is not a panel Agora runs')

  const seats = new Set()
  for (const [index, seat] of (record.panel ?? []).entries()) {
    if (!isObject(seat)) {
      fail(`panel[${index}]`, 'not an object')
      continue
    }
    if (!SEAT.test(seat.label ?? '')) fail(`panel[${index}].label`, 'must be a single seat letter A-J')
    if (seats.has(seat.label)) fail(`panel[${index}].label`, `duplicate seat ${seat.label}`)
    seats.add(seat.label)
    if (typeof seat.modelId !== 'string' || !seat.modelId.endsWith(':free')) {
      fail(`panel[${index}].modelId`, 'must be a `:free` variant id')
    }
  }

  for (const round of ['blind', 'floor', 'convergence']) {
    const entries = record[round]
    if (!Array.isArray(entries)) {
      fail(round, 'missing')
      continue
    }
    if (round === 'convergence') {
      if (entries.length > (record.panel?.length ?? 0)) fail(round, 'has more entries than the panel has seats')
    } else if (entries.length !== (record.panel?.length ?? 0)) {
      fail(round, `has ${entries.length} entries for ${record.panel?.length ?? 0} seats`)
    }
    for (const [index, entry] of entries.entries()) {
      if (!isObject(entry)) {
        fail(`${round}[${index}]`, 'not an object')
        continue
      }
      if (!seats.has(entry.seat)) fail(`${round}[${index}].seat`, 'not a seat in the panel')
      if (!POSITIONS.includes(entry.position)) fail(`${round}[${index}].position`, 'not a known position')
      if (!CONFIDENCE_BASES.includes(entry.confidenceBasis)) {
        fail(`${round}[${index}].confidenceBasis`, 'not a known confidence basis')
      }
      if (entry.confidence !== null && (!Number.isInteger(entry.confidence) || entry.confidence < 0 || entry.confidence > 100)) {
        fail(`${round}[${index}].confidence`, 'must be null or an integer 0-100')
      }
    }
  }

  // The declared cost must match the arithmetic Agora actually uses: two requests a seat,
  // plus one more for each seat the final round invited back, plus the agenda round when
  // the panel chose its own topic.
  const seatsCount = record.panel?.length ?? 0
  const invited = Array.isArray(record.convergence) ? record.convergence.length : 0
  const agendaCost = record.agenda?.mode === 'panel' ? seatsCount : 0
  const expectedCost = seatsCount * 2 + invited + agendaCost
  if (record.requestsSpent !== expectedCost) {
    fail(
      'requestsSpent',
      `expected ${expectedCost} for ${seatsCount} seats, ${invited} invited back and a ${record.agenda?.mode ?? 'unknown'} topic, got ${record.requestsSpent}`,
    )
  }

  // The final round may only invite seats that dissented, and it must state its own
  // threshold so "the panel agreed" is never a claim without a declared bar.
  if (!isObject(record.trajectory)) {
    fail('trajectory', 'missing')
  } else {
    if (typeof record.trajectory.threshold !== 'number' || record.trajectory.threshold <= 0 || record.trajectory.threshold > 1) {
      fail('trajectory.threshold', 'must be a share between 0 and 1')
    }
    if (!Array.isArray(record.trajectory.snapshots) || record.trajectory.snapshots.length < 2) {
      fail('trajectory.snapshots', 'a discussion is only traceable with at least two rounds recorded')
    }
    const invitedSeats = new Set((record.convergence ?? []).map((turn) => turn?.seat))
    for (const seat of record.trajectory.invited ?? []) {
      if (!invitedSeats.has(seat)) fail('trajectory.invited', `${seat} is listed as invited but has no final-round entry`)
    }
  }

  // A record that claims a confidence basis must show the token evidence for it, and a
  // record that claims a measurement cannot be a member without logprobs.
  for (const entry of record.floor ?? []) {
    if (!isObject(entry) || entry.confidenceBasis !== 'measured') continue
    if (typeof entry.meanLogprob !== 'number' || !Number.isFinite(entry.meanLogprob)) {
      fail(`floor[${entry.seat}].meanLogprob`, 'a measured confidence must carry the log-probability it came from')
    }
  }

  if (!isObject(record.quota) || !isObject(record.quota.before) || !isObject(record.quota.after)) {
    fail('quota', 'before and after snapshots are both required')
  } else {
    const { before, after } = record.quota
    for (const [side, snapshot] of Object.entries({ before, after })) {
      for (const field of ['used', 'limit', 'remaining']) {
        if (!Number.isInteger(snapshot[field]) || snapshot[field] < 0) {
          fail(`quota.${side}.${field}`, 'must be a non-negative integer')
        }
      }
      if (snapshot.used + snapshot.remaining !== snapshot.limit) {
        fail(`quota.${side}`, `used ${snapshot.used} + remaining ${snapshot.remaining} does not match limit ${snapshot.limit}`)
      }
    }

    // The self-proof: a verdict is archivable only if the counter moved by at least the
    // session's declared cost. This is what makes the timeline self-policing — publishing
    // costs real free-model quota, so an invented record cannot be published for free.
    const spent = after.used - before.used
    if (spent < record.requestsSpent) {
      fail(
        'quota',
        `the daily counter moved by ${spent} but the session claims ${record.requestsSpent} requests; the record does not prove its own cost`,
      )
    }
  }

  // Never accept a stored count: re-derive it and require the claim to match.
  if (!isObject(record.tally)) {
    fail('tally', 'missing')
  } else {
    const derived = recount(record)
    if (record.tally.leading !== derived.leading) {
      fail('tally.leading', `stored ${record.tally.leading} but the positions give ${derived.leading}`)
    }
    for (const position of POSITIONS) {
      if (record.tally.counts?.[position] !== derived.counts[position]) {
        fail(`tally.counts.${position}`, `stored ${record.tally.counts?.[position]} but the positions give ${derived.counts[position]}`)
      }
    }
    if (Math.abs((record.tally.consensus ?? -1) - derived.consensus) > 1e-9) {
      fail('tally.consensus', `stored ${record.tally.consensus} but the positions give ${derived.consensus}`)
    }
  }

  return errors
}
