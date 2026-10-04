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
 * Derive the timeline row from a record's rounds.
 *
 * The row is what the shared feed shows, so it must not carry a second opinion about the
 * verdict: the count is re-derived here from the stored positions and the stored tally is
 * not read. One derivation, used by the filing tool and by the archive endpoint alike.
 *
 * A seat that was invited back and refused to move appears once, not twice. The last
 * answer it gave is the position the count already uses, so the earlier one is a step in
 * the discussion rather than a second vote.
 */
export function toTimelineRow(record) {
  const derived = recount(record)
  const lastAnswer = new Map()
  for (const round of [record?.floor, record?.convergence]) {
    for (const turn of round ?? []) {
      if (isObject(turn) && typeof turn.seat === 'string') lastAnswer.set(turn.seat, turn)
    }
  }

  const snapshots = record?.trajectory?.snapshots ?? []
  const counts = {}
  for (const position of POSITIONS) counts[position] = derived.counts[position]

  return {
    id: record?.id,
    startedAt: record?.startedAt,
    finishedAt: record?.finishedAt,
    motion: record?.motion,
    topicSource: record?.agenda?.mode === 'panel' ? 'panel' : 'given',
    panel: (record?.panel ?? []).map((seat) => ({ label: seat?.label, modelId: seat?.modelId })),
    counts,
    leading: derived.leading,
    consensus: derived.consensus,
    dissentShare: derived.dissentShare,
    dissent: derived.dissentingSeats
      .map((seat) => {
        const turn = lastAnswer.get(seat)
        return turn ? { seat, position: turn.position, reason: turn.reason } : null
      })
      .filter((entry) => entry !== null),
    unreadable: derived.unreadableSeats,
    requestsSpent: record?.requestsSpent,
    /** Seats the final round invited back; the cost cannot be re-derived without it. */
    invited: Array.isArray(record?.convergence) ? record.convergence.length : 0,
    seats: (record?.panel ?? []).map((seat) => seat?.label),
    agreementPath: {
      blind: snapshots[0]?.agreement ?? derived.consensus,
      final: snapshots[snapshots.length - 1]?.agreement ?? derived.consensus,
    },
    quotaAfter: record?.quota?.after,
  }
}

/**
 * Re-derive a timeline row from the count it carries.
 *
 * This mirrors the arithmetic of `recount()` above, one step earlier: a row stores its
 * own counts, so its leading position and its two shares can be recomputed without
 * reading the rounds it came from. A row that disagrees is not shown, which is the same
 * rule the record itself obeys — a stored count is never taken on trust.
 */
export function recountTimelineRow(row) {
  const counts = { support: 0, oppose: 0, abstain: 0, unclear: 0 }
  for (const position of POSITIONS) {
    const value = row?.counts?.[position]
    if (Number.isInteger(value) && value >= 0) counts[position] = value
  }
  const decided = counts.support + counts.oppose
  const leading = decided === 0 ? 'abstain' : counts.abstain > decided ? 'abstain' : counts.support >= counts.oppose ? 'support' : 'oppose'
  const consensus = decided === 0 || leading === 'abstain' ? 0 : counts[leading] / decided
  return { counts, leading, consensus, dissentShare: leading === 'abstain' ? 0 : 1 - consensus, total: Object.values(counts).reduce((sum, value) => sum + value, 0) }
}

const isShare = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

/**
 * Validate one timeline row.
 *
 * Returns every problem found rather than the first, so a reader can say what it refused
 * instead of quietly showing a smaller feed.
 */
export function validateTimelineRecord(row) {
  const errors = []
  const fail = (path, message) => errors.push(`${path}: ${message}`)

  if (!isObject(row)) return ['row: not an object']
  if (typeof row.id !== 'string' || row.id.length < 4) fail('id', 'missing or too short')
  if (typeof row.motion !== 'string' || row.motion.trim().length < 8) fail('motion', 'a proposition of at least 8 characters is required')
  if (!isIsoDate(row.startedAt)) fail('startedAt', 'not a valid timestamp')
  if (!isIsoDate(row.finishedAt)) fail('finishedAt', 'not a valid timestamp')
  if (!['given', 'panel'].includes(row.topicSource)) fail('topicSource', 'must be given or panel')

  if (!Array.isArray(row.panel) || row.panel.length < 2) fail('panel', 'at least two seats are required')
  if (row.panel?.length > 10) fail('panel', 'more than ten seats is not a panel Agora runs')

  const seats = new Set()
  for (const [index, seat] of (row.panel ?? []).entries()) {
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

  if (!isObject(row.counts)) {
    fail('counts', 'missing')
  } else {
    for (const position of POSITIONS) {
      if (!Number.isInteger(row.counts[position]) || row.counts[position] < 0) {
        fail(`counts.${position}`, 'must be a non-negative integer')
      }
    }
  }

  const derived = recountTimelineRow(row)
  if (derived.total > (row.panel?.length ?? 0)) {
    fail('counts', `counts total ${derived.total} for a panel of ${row.panel?.length ?? 0} seats`)
  }

  if (!POSITIONS.includes(row.leading)) fail('leading', 'not a known position')
  else if (row.leading !== derived.leading) fail('leading', `stored ${row.leading} but the counts give ${derived.leading}`)
  if (!isShare(row.consensus)) fail('consensus', 'must be a share between 0 and 1')
  else if (Math.abs(row.consensus - derived.consensus) > 1e-9) {
    fail('consensus', `stored ${row.consensus} but the counts give ${derived.consensus}`)
  }
  if (!isShare(row.dissentShare)) fail('dissentShare', 'must be a share between 0 and 1')
  else if (Math.abs(row.dissentShare - derived.dissentShare) > 1e-9) {
    fail('dissentShare', `stored ${row.dissentShare} but the counts give ${derived.dissentShare}`)
  }

  // The count and the names have to describe the same seats: one row per dissenting seat,
  // and one name per unreadable seat.
  if (!Array.isArray(row.dissent)) fail('dissent', 'missing')
  else {
    for (const [index, entry] of row.dissent.entries()) {
      if (!isObject(entry)) {
        fail(`dissent[${index}]`, 'not an object')
        continue
      }
      if (!seats.has(entry.seat)) fail(`dissent[${index}].seat`, 'is not a seat in the panel')
      if (!POSITIONS.includes(entry.position)) fail(`dissent[${index}].position`, 'is not a known position')
      if (typeof entry.reason !== 'string') fail(`dissent[${index}].reason`, 'must be a string')
    }
    const named = new Set(row.dissent.map((entry) => entry?.seat))
    if (named.size !== row.dissent.length) fail('dissent', 'names the same seat twice')
    const expected = derived.total - (derived.counts[derived.leading] ?? 0)
    if (row.dissent.length !== expected) {
      fail('dissent', `names ${row.dissent.length} seats but the counts put ${expected} seats off the leading position`)
    }
    for (const entry of row.dissent) {
      if (entry?.position === derived.leading) fail(`dissent[${entry.seat}]`, 'is listed as dissenting but holds the leading position')
    }
  }

  if (!Array.isArray(row.unreadable)) fail('unreadable', 'missing')
  else {
    if (row.unreadable.length !== (derived.counts.unclear ?? 0)) {
      fail('unreadable', `names ${row.unreadable.length} seats but the counts put ${derived.counts.unclear ?? 0} unreadable`)
    }
    for (const seat of row.unreadable) if (!seats.has(seat)) fail('unreadable', `${seat} is not a seat in the panel`)
  }

  // A row cannot re-derive its own request count without knowing who came back, so the
  // number of invited seats travels with it and the same cost rule is applied.
  if (!Number.isInteger(row.invited) || row.invited < 0) fail('invited', 'must be a non-negative integer')
  if (Number.isInteger(row.invited) && Number.isInteger(row.requestsSpent)) {
    const agendaCost = row.topicSource === 'panel' ? (row.panel?.length ?? 0) : 0
    const expectedCost = (row.panel?.length ?? 0) * 2 + row.invited + agendaCost
    if (row.requestsSpent !== expectedCost) {
      fail('requestsSpent', `expected ${expectedCost} for ${row.panel?.length ?? 0} seats, ${row.invited} invited back and a ${row.topicSource} topic, got ${row.requestsSpent}`)
    }
  }

  if (!isObject(row.agreementPath) || !isShare(row.agreementPath.blind) || !isShare(row.agreementPath.final)) {
    fail('agreementPath', 'both the first round and the final share must be between 0 and 1')
  }

  if (!isObject(row.quotaAfter)) {
    fail('quotaAfter', 'missing')
  } else {
    for (const field of ['used', 'limit', 'remaining']) {
      if (!Number.isInteger(row.quotaAfter[field]) || row.quotaAfter[field] < 0) {
        fail(`quotaAfter.${field}`, 'must be a non-negative integer')
      }
    }
    if (row.quotaAfter.used + row.quotaAfter.remaining !== row.quotaAfter.limit) {
      fail('quotaAfter', `used ${row.quotaAfter.used} + remaining ${row.quotaAfter.remaining} does not match limit ${row.quotaAfter.limit}`)
    }
  }

  return errors
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
      // The reason is what the shared record shows next to a dissenting seat, so a record
      // that has no reason for an entry would produce a row no reader could accept.
      if (typeof entry.reason !== 'string') fail(`${round}[${index}].reason`, 'must be a string')
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
