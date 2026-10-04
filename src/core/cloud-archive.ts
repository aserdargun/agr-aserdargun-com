import type { ArchiveRecord, TimelineRecord } from './archive-schema'
import { validateTimelineRow } from './archive-schema'

/**
 * The shared archive, reached over the site's own `/api` route.
 *
 * Static Web Apps proxies `/api` to the managed function that validates and files a record,
 * so the browser holds no storage credential and no second origin has to be trusted: the
 * call is same-origin, which the existing `connect-src 'self'` already permits.
 *
 * Nothing here is allowed to interrupt a discussion. A session is on screen and saved in
 * this browser before the store is asked anything, so every failure below is reported as a
 * state rather than thrown, and the visitor keeps the record either way.
 */
const ENDPOINT = '/api/archive'

/** Azure is a long way from a mobile visitor; a slow answer is not an answer. */
const TIMEOUT_MS = 12_000

const MAX_ROWS = 200

export type StoreResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'refused' | 'unreachable'; errors: string[] }

/** What the archive card shows about a filing attempt, in the visitor's language. */
export type StoreState =
  | { phase: 'idle' }
  | { phase: 'storing' }
  | { phase: 'stored'; id: string }
  | { phase: 'refused'; errors: string[] }
  | { phase: 'unreachable' }

export type FeedResult =
  | { ok: true; records: TimelineRecord[]; refused: number; count: number }
  | { ok: false; errors: string[] }

/** A signal that gives up after `TIMEOUT_MS`, while still honouring a caller's own abort. */
const withTimeout = (signal?: AbortSignal): { signal: AbortSignal; done: () => void } => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), TIMEOUT_MS)
  const forward = (): void => controller.abort(signal?.reason)
  if (signal) {
    if (signal.aborted) forward()
    else signal.addEventListener('abort', forward, { once: true })
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forward)
    },
  }
}

const errorsOf = (payload: unknown): string[] => {
  if (payload && typeof payload === 'object' && Array.isArray((payload as { errors?: unknown }).errors)) {
    const errors = (payload as { errors: unknown[] }).errors
    const known = errors.filter((entry): entry is string => typeof entry === 'string')
    if (known.length > 0) return known
  }
  return []
}

/** The id the endpoint echoed back, when it echoed one at all. */
const idOf = (payload: unknown, fallback: string): string =>
  payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string'
    ? (payload as { id: string }).id
    : fallback

/**
 * File one session.
 *
 * The record is validated here first, exactly as the export path does, so an unusable
 * session is never sent and the visitor is told why without a round trip. The server then
 * checks it again: nothing that arrives anonymously is stored on this browser's word.
 */
export const storeRecord = async (record: ArchiveRecord, signal?: AbortSignal): Promise<StoreResult> => {
  const { signal: bounded, done } = withTimeout(signal)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
      signal: bounded,
    })
    const payload: unknown = await response.json().catch(() => null)
    // A 200 that is not the endpoint's own answer is not a filing. A static host rewrites
    // unknown paths to the app shell and answers 200 with HTML, and treating that as a
    // stored record would claim an archive copy that does not exist.
    const answered = payload !== null && typeof payload === 'object'
    if (response.ok && answered) return { ok: true, id: idOf(payload, record.id) }
    if (response.ok || !answered) return { ok: false, reason: 'unreachable', errors: [] }
    return { ok: false, reason: 'refused', errors: errorsOf(payload) }
  } catch {
    return { ok: false, reason: 'unreachable', errors: [] }
  } finally {
    done()
  }
}

/**
 * Read the shared feed.
 *
 * Every row is checked again in this browser before it is shown. The server has already
 * refused the rows that fail, so a refusal here means the two disagree about the same row,
 * and the smaller feed is the honest one.
 */
export const fetchSharedTimeline = async (signal?: AbortSignal): Promise<FeedResult> => {
  const { signal: bounded, done } = withTimeout(signal)
  try {
    const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' }, signal: bounded })
    if (!response.ok) return { ok: false, errors: [`the archive answered ${response.status}`] }
    const payload: unknown = await response.json().catch(() => null)
    const rows = payload && typeof payload === 'object' ? (payload as { records?: unknown }).records : null
    if (!Array.isArray(rows)) return { ok: false, errors: ['the archive sent a feed with no records list'] }

    const records: TimelineRecord[] = []
    let refused = 0
    for (const row of rows.slice(0, MAX_ROWS)) {
      if (validateTimelineRow(row).length > 0) {
        refused += 1
        continue
      }
      records.push(row as TimelineRecord)
    }
    return { ok: true, records, refused, count: records.length }
  } catch {
    return { ok: false, errors: [] }
  } finally {
    done()
  }
}
