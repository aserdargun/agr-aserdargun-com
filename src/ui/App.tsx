import { useCallback, useEffect, useState } from 'react'
import { ArchiveList, Evidence, KeyGate, LocaleToggle, PropositionForm, QuotaMeter, RosterPanel, SessionView, VerdictCard } from './Panels'
import { copy, text } from './copy'
import { buildPanel, runDeliberation, tally, verdictText } from '../core/engine'
import { curateRoster } from '../core/roster'
import { AgoraApiError, fetchCatalog, fetchQuota, streamChat } from '../core/openrouter'
import { clearSessions, forgetKey, loadKey, loadSessions, localeFromSearch, saveSession, storeKey } from '../core/archive'
import { estimateRequests, type Locale, type Quota, type Roster, type SessionRecord } from '../core/types'
import type { FloorTurn, Vote } from '../core/types'

type Phase = 'idle' | 'blind' | 'floor' | 'done'

const DEFAULT_SEATS = 5

/** The manifest advertises `?seats=3|5|7` routes, so those links have to mean something. */
const seatsFromSearch = (search: string): number => {
  const raw = Number(new URLSearchParams(search).get('seats'))
  return Number.isInteger(raw) && raw >= 2 && raw <= 9 ? raw : DEFAULT_SEATS
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => localeFromSearch(window.location.search))
  const [key, setKey] = useState<string>(() => loadKey())
  const [quota, setQuota] = useState<Quota | null>(null)
  const [checking, setChecking] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [roster, setRoster] = useState<Roster | null>(null)

  const [proposition, setProposition] = useState('')
  const [context, setContext] = useState('')
  const [seatCount, setSeatCount] = useState(() => seatsFromSearch(window.location.search))

  const [phase, setPhase] = useState<Phase>('idle')
  const [blind, setBlind] = useState<Vote[]>([])
  const [floor, setFloor] = useState<FloorTurn[]>([])
  const [record, setRecord] = useState<SessionRecord | null>(null)
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions())

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    const controller = new AbortController()
    fetchCatalog(controller.signal)
      .then((payload) => setRoster(curateRoster(payload, new Date().toISOString().slice(0, 10))))
      .catch(() => setRoster(null))
    return () => controller.abort()
  }, [])

  const checkKey = useCallback(async () => {
    const candidate = key.trim()
    if (!candidate) return
    setChecking(true)
    setKeyError(null)
    storeKey(candidate)
    try {
      setQuota(await fetchQuota(candidate))
    } catch (error) {
      setQuota(null)
      setKeyError(
        error instanceof AgoraApiError
          ? text(copy.keyInvalid, locale)
          : error instanceof Error
            ? error.message
            : String(error),
      )
    } finally {
      setChecking(false)
    }
  }, [key, locale])

  const run = useCallback(async () => {
    if (!roster || !key.trim()) return
    const panel = buildPanel(roster.members, seatCount)
    if (panel.length < 2) return

    setPhase('blind')
    setBlind([])
    setFloor([])
    setRecord(null)

    const startedAt = new Date().toISOString()
    const before = quota

    try {
      const result = await runDeliberation(panel, { proposition: proposition.trim(), context }, locale, {
        key: key.trim(),
        call: ({ model, messages, logprobs, json, signal }) =>
          streamChat(key.trim(), model, messages, { signal, logprobs, json }),
        onProgress: (next) => setPhase(next),
      })

      const result2 = tally(result.blind, result.floor)
      const after = await fetchQuota(key.trim()).catch(() => null)

      const session: SessionRecord = {
        id: `${startedAt}-${panel.length}`,
        motion: proposition.trim(),
        locale,
        startedAt,
        finishedAt: new Date().toISOString(),
        panel,
        blind: result.blind,
        floor: result.floor,
        verdict: {
          tally: result2,
          synthesis: null,
          synthesisSeat: null,
          synthesisFormatCompliant: true,
        },
        quota: { before, after },
        requestsSpent: estimateRequests(panel.length),
      }

      const withText: SessionRecord = {
        ...session,
        verdict: { ...session.verdict, synthesis: verdictText(result2, locale) },
      }

      setBlind(result.blind)
      setFloor(result.floor)
      setQuota(after)
      setRecord(withText)
      setSessions(saveSession(withText))
      setPhase('done')
    } catch (error) {
      setPhase('idle')
      setKeyError(error instanceof Error ? error.message : String(error))
    }
  }, [context, key, locale, proposition, quota, roster, seatCount])

  return (
    <main className="ag">
      <header className="ag-head">
        <div>
          <h1>{text(copy.title, locale)}</h1>
          <p className="ag-muted">{text(copy.tagline, locale)}</p>
        </div>
        <LocaleToggle locale={locale} onChange={setLocale} />
      </header>

      <KeyGate
        locale={locale}
        value={key}
        onChange={setKey}
        onSave={() => void checkKey()}
        onForget={() => {
          forgetKey()
          setKey('')
          setQuota(null)
        }}
        checking={checking}
        error={keyError}
      />

      <QuotaMeter locale={locale} quota={quota} />
      <RosterPanel locale={locale} roster={roster} />

      <PropositionForm
        locale={locale}
        proposition={proposition}
        context={context}
        seatCount={seatCount}
        available={roster?.members.length ?? DEFAULT_SEATS}
        running={phase === 'blind' || phase === 'floor'}
        onProposition={setProposition}
        onContext={setContext}
        onSeats={setSeatCount}
        onRun={() => void run()}
      />

      <SessionView
        locale={locale}
        phase={phase}
        blind={blind}
        floor={floor}
        seats={record?.panel.map((seat) => seat.label) ?? blind.map((vote) => vote.seat)}
      />

      <VerdictCard locale={locale} record={record} />
      {record?.verdict.synthesis ? <p className="ag-summary">{record.verdict.synthesis}</p> : null}

      <ArchiveList
        locale={locale}
        sessions={sessions}
        onReask={(value) => setProposition(value)}
        onClear={() => {
          clearSessions()
          setSessions([])
        }}
      />

      <Evidence locale={locale} />

      <footer className="ag-foot">{text(copy.footer, locale)}</footer>
    </main>
  )
}
