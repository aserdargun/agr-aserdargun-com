/**
 * The Agora archive endpoint.
 *
 * Two jobs, both of them on the way to storage rather than on the way out of it:
 *
 *   POST /api/archive  — take one finished session, hold it to the archive contract, and
 *                        only then write it. Nothing that arrives anonymously is stored
 *                        before the same rule the browser and the filing tool use has
 *                        checked it, and the browser never holds a write credential.
 *   GET  /api/archive  — hand back the shared feed, re-checking every row on the way out.
 *
 * What is stored
 *   records/<id>.json  the record itself, exactly as the contract accepted it
 *   index.json         an append-only log of timeline rows, one JSON object per line
 *
 * Why the index is an append log: the free tier allows 10,000 writes a month, and a
 * read-modify-write of a single index would spend a read on every session. Appending
 * costs one write, and a reader pays one read for the whole feed. The consequence is
 * declared rather than hidden: the index is a log, so a repeated id appears twice and the
 * reader keeps the last one.
 *
 * Why a narrow credential and not an account key: managed functions on Static Web Apps have
 * no managed identity (see the SWA API documentation), so the endpoint authenticates with a
 * token held as an app setting on the Static Web App. The token is a service SAS scoped to
 * this one container and signed for `r`, `a`, `c` and `l` only — it can create and append,
 * and it can never overwrite or delete a stored record. The token never reaches the bundle,
 * the container has no anonymous access, and the permission set matches what the reader
 * checks anyway: a row that does not add up is refused on the way out.
 */
const { app } = require('@azure/functions')
const { AnonymousCredential, BlobServiceClient, ContainerClient } = require('@azure/storage-blob')

const CONTAINER = 'sessions'
const RECORD_PREFIX = 'records/'
const INDEX_BLOB = 'index.json'

/** A record is a few kilobytes of prose. Anything larger is not a session. */
const MAX_BODY_BYTES = 256 * 1024
/** Rows handed to the reader. The feed is a history, not an archive browser. */
const MAX_ROWS = 200

let contractPromise
/** The contract is the same file the browser and the filing tool use, copied by scripts/sync-api-contract.mjs. */
const contract = () => (contractPromise ??= import('../lib/archive-contract.mjs'))

let containerPromise
const configured = () => Boolean(process.env.AZURE_STORAGE_TARGET)

/**
 * The container client, built from the token's own URL.
 *
 * A service SAS is signed for one container and names it, so the URL already says which
 * container it is. Building an account client from that URL and then asking it for a
 * container appends the name a second time and every request comes back 400 — which is
 * why the SAS is used as-is with an anonymous credential, as the SDK documents.
 */
const container = () => {
  const target = process.env.AZURE_STORAGE_TARGET
  if (!target) throw new Error('AZURE_STORAGE_TARGET is not set on this Static Web App')
  containerPromise ??= target.startsWith('https')
    ? new ContainerClient(target, new AnonymousCredential())
    : BlobServiceClient.fromConnectionString(target).getContainerClient(CONTAINER)
  return containerPromise
}

let indexReady
const index = async () => {
  const blob = (await container()).getAppendBlobClient(INDEX_BLOB)
  indexReady ??= blob.createIfNotExists()
  await indexReady
  return blob
}

const json = (status, body) => ({ status, jsonBody: body })

/** The requested page size, from a query that may be absent, relative, or nonsense. */
const limitOf = (request) => {
  const asked = Number(new URL(request.url, 'https://archive.invalid').searchParams.get('limit') ?? MAX_ROWS)
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_ROWS) : MAX_ROWS
}

/** Blob names carry the id, so a record can only be stored under a name that says which record it is. */
const blobName = (id) => {
  const name = String(id).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120)
  return name.length >= 4 && !name.startsWith('.') ? name : null
}

const readBody = async (request) => {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) throw new Error('body too large')
  const buffer = Buffer.from(await request.arrayBuffer())
  if (buffer.byteLength > MAX_BODY_BYTES) throw new Error('body too large')
  return buffer
}

const file = async (request) => {
  const { toTimelineRow, validateArchiveRecord, validateTimelineRecord } = await contract()

  const body = await readBody(request)
  let record
  try {
    record = JSON.parse(body.toString('utf8'))
  } catch {
    return json(400, { errors: ['body: not valid JSON'] })
  }

  const errors = validateArchiveRecord(record)
  if (errors.length > 0) return json(400, { errors })

  const name = blobName(record.id)
  if (!name) return json(400, { errors: ['id: not usable as a blob name'] })

  // The row is derived from the rounds, never from the stored tally, and it is checked by
  // the same rule before it is appended. A feed row that could not survive a reader's
  // check has no business being in the feed.
  const row = toTimelineRow(record)
  const rowErrors = validateTimelineRecord(row)
  if (rowErrors.length > 0) {
    console.error('archive: derived row failed its own check', rowErrors.join('; '))
    return json(500, { errors: ['the derived timeline row failed its own check'] })
  }

  const blobs = await container()
  const storedAt = new Date().toISOString()
  try {
    // `ifNoneMatch: '*'` makes a repeated id an answer rather than an overwrite, which is
    // the same append-only promise the credential itself makes.
    // The byte length is passed explicitly: the SDK reads a second argument as the content
    // length, and getting that wrong fails the request rather than the argument.
    await blobs
      .getBlockBlobClient(`${RECORD_PREFIX}${name}.json`)
      .upload(body, body.byteLength, { blobHTTPHeaders: { blobContentType: 'application/json' }, conditions: { ifNoneMatch: '*' } })
  } catch (error) {
    if (error?.statusCode !== 409) throw error
    return json(200, { id: record.id, storedAt, alreadyStored: true })
  }
  const line = Buffer.from(`${JSON.stringify(row)}\n`, 'utf8')
  await (await index()).appendBlock(line, line.byteLength)

  return json(201, { id: record.id, storedAt })
}

const read = async (request) => {
  const { validateTimelineRecord } = await contract()
  const limit = limitOf(request)
  const readAt = new Date().toISOString()

  if (!configured()) return json(503, { readAt, errors: ['the archive has no storage credential on this Static Web App'] })

  const blob = (await container()).getAppendBlobClient(INDEX_BLOB)
  if (!(await blob.exists())) return json(200, { schemaVersion: '0.1', readAt, count: 0, refused: 0, unreadable: 0, records: [] })

  const text = (await blob.downloadToBuffer()).toString('utf8')

  const kept = new Map()
  let refused = 0
  let unreadable = 0
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      // A torn line is a fact about the log, not about a record: count it and move on.
      unreadable += 1
      continue
    }
    if (validateTimelineRecord(row).length > 0) {
      refused += 1
      continue
    }
    // The log is append-only, so a repeated id is resolved by the last one written.
    kept.set(row.id, row)
  }

  const records = [...kept.values()].sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, limit)
  return json(200, { schemaVersion: '0.1', readAt, count: records.length, refused, unreadable, records })
}

app.http('archive', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'archive',
  handler: async (request, context) => {
    try {
      if (request.method === 'POST') return await file(request)
      if (request.method === 'GET') return await read(request)
      return json(405, { errors: ['method: only GET and POST are served here'] })
    } catch (error) {
      // The reason is logged where an operator will see it and the client is told what
      // kind of failure it was. A bare 500 with no body is a failure nobody can act on.
      context.error(`archive ${request.method}: ${error?.message ?? error}`)
      context.log(`archive ${request.method} failed`, error)
      const unconfigured = !configured()
      return json(unconfigured ? 503 : 502, {
        errors: unconfigured
          ? ['the archive has no storage credential on this Static Web App']
          : ['the archive could not reach its storage'],
      })
    }
  },
})
