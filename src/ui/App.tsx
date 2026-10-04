import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AgendaPanel,
  ConvergenceCard,
  Discussion,
  Evidence,
  ExportCard,
  KeyGate,
  LocaleToggle,
  QuotaMeter,
  RosterPanel,
  SessionList,
  TopicPicker,
  VerdictCard,
} from './Panels'
import { Timeline } from './Timeline'
import { copy, text } from './copy'
import {
  buildPanel,
  clusterProposals,
  pickByCluster,
  runAgenda,
  runDeliberation,
  verdictText,
} from '../core/engine'
import type { Cluster, Proposition } from '../core/engine'
import { curateRoster } from '../core/roster'
import { AgoraApiError, fetchCatalog, fetchQuota, streamChat } from '../core/openrouter'
import { clearSessions, forgetKey, loadKey, loadSessions, localeFromSearch, saveSession, storeKey } from '../core/archive'
import { toArchiveRecord, toTimelineRecord, validateForArchive, type TimelineRecord } from '../core/archive-schema'
import shared from '../data/timeline.generated.json'
import type { FloorTurn, Locale, Proposal, Quota, Roster, RoundKind, SessionRecord, Vote } from '../core/types'

type Phase = 'idle' | 'agenda' | 'blind' | 'floor' | 'convergence' | 'done'

const DEFAULT_SEATS = 5

/** The manifest advertises `?seats=3|5|7` routes, so those links have to mean something. */
const seatsFromSearch = (search: string): number => {
  const raw = Number(new URLSearchParams(search).get('seats'))
  return Number.isInteger(raw) && raw >= 2 && raw <= 9 ? raw : DEFAULT_SEATS
}

const download = (filename: string, payload: unknown): void => {
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => localeFromSearch(window.location.search))
  const [key, setKey] = useState<string>(() => loadKey())
  const [quota, setQuota] = useState<Quota | null>(null)
  const [checking, setChecking] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [roster, setRoster] = useState<Roster | null>(null)

  const [mode, setMode] = useState<'given' | 'panel'>('given')
  const [proposition, setProposition] = useState('')
  const [context, setContext] = useState('')
  const [seatCount, setSeatCount] = useState(() => seatsFromSearch(window.location.search))

  const [phase, setPhase] = useState<Phase>('idle')
  const [activeRound, setActiveRound] = useState<RoundKind | 'agenda' | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [blind, setBlind] = useState<Vote[]>([])
  const [floor, setFloor] = useState<FloorTurn[]>([])
  const [convergence, setConvergence] = useState<FloorTurn[]>([])
  const [panel, setPanel] = useState<SessionRecord['panel']>([])
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
      setKeyError(error instanceof AgoraApiError ? text(copy.keyInvalid, locale) : error instanceof Error ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }, [key, locale])

  const run = useCallback(async () => {
    if (!roster || !key.trim()) return
    const seats = buildPanel(roster.members, seatCount)
    if (seats.length < 2) return

    setBlind([])
    setFloor([])
    setConvergence([])
    setRecord(null)
    setProposals([])
    setClusters([])
    setPicked(null)
    setPanel(seats)

    const startedAt = new Date().toISOString()
    const before = quota
    setActiveRound('blind')

    const callDeps = {
      key: key.trim(),
      call: ({ model, messages, logprobs, json, signal }: { model: string; messages: { role: 'system' | 'user'; content: string }[]; logprobs: boolean; json: boolean; signal: AbortSignal }) =>
        streamChat(key.trim(), model, messages, { signal, logprobs, json }),
      onProgress: (round: RoundKind) => {
        setActiveRound(round)
        setPhase(round === 'convergence' ? 'convergence' : round)
      },
    }

    try {
      let motion: Proposition
      let chosen: string
      let chosenBy: SessionRecord['agenda']['chosenBy'] = 'given'
      let clusterSize = 0
      let agendaProposals: Proposal[] = []

      if (mode === 'panel') {
        setPhase('agenda')
        setActiveRound('agenda')
        agendaProposals = await runAgenda(seats, locale, callDeps)
        setProposals(agendaProposals)

        const grouped = clusterProposals(agendaProposals)
        setClusters(grouped)
        const winner = pickByCluster(grouped)
        if (!winner) {
          setKeyError(text(copy.agendaEmpty, locale))
          setPhase('idle')
          setActiveRound(null)
          return
        }
        setPicked(winner.proposition)
        chosen = winner.proposition
        chosenBy = 'cluster'
        clusterSize = winner.seats.length
        motion = { proposition: chosen }
      } else {
        chosen = proposition.trim()
        motion = { proposition: chosen, context }
      }

      const result = await runDeliberation(seats, motion, locale, callDeps)
      setBlind(result.blind)
      setFloor(result.floor)
      setConvergence(result.convergence)

      const after = await fetchQuota(key.trim()).catch(() => null)
      const spent = agendaProposals.length ? seats.length + result.requestsSpent : result.requestsSpent

      const session: SessionRecord = {
        id: `${startedAt.replace(/[:.]/g, '-')}-${seats.length}`,
        motion: chosen,
        locale,
        startedAt,
        finishedAt: new Date().toISOString(),
        agenda: {
          mode,
          proposals: agendaProposals,
          chosen,
          chosenBy: mode === 'panel' && picked !== null ? 'user' : chosenBy,
          clusterSize,
        },
        panel: seats,
        blind: result.blind,
        floor: result.floor,
        convergence: result.convergence,
        trajectory: result.trajectory,
        verdict: {
          tally: result.tally,
          synthesis: null,
          synthesisSeat: null,
          synthesisFormatCompliant: true,
        },
        quota: { before, after },
        requestsSpent: spent,
      }

      const finished: SessionRecord = {
        ...session,
        verdict: { ...session.verdict, synthesis: verdictText(result.tally, locale, result.trajectory) },
      }

      setQuota(after)
      setRecord(finished)
      setSessions(saveSession(finished))
      setPhase('done')
      setActiveRound(null)
    } catch (error) {
      setPhase('idle')
      setActiveRound(null)
      setKeyError(error instanceof Error ? error.message : String(error))
    }
  }, [context, key, locale, mode, picked, proposition, quota, roster, seatCount])

  const exportRecord = useCallback(() => {
    if (!record) return
    const candidate = toArchiveRecord(record)
    if (!candidate) return
    download(`agora-${candidate.id}.json`, candidate)
  }, [record])

  const archiveProblems = useMemo(() => {
    if (!record) return []
    const candidate = toArchiveRecord(record)
    return candidate ? validateForArchive(candidate) : [text(copy.exportNoQuota, locale)]
  }, [locale, record])

  const localTimeline = useMemo(
    () => sessions.map(toTimelineRecord).filter((entry): entry is TimelineRecord => entry !== null),
    [sessions],
  )
  const sharedTimeline = useMemo(() => {
    const base = (shared as { records?: TimelineRecord[] }).records ?? []
    const ids = new Set(base.map((entry) => entry?.id))
    return [...base, ...localTimeline.filter((entry) => !ids.has(entry.id))]
  }, [localTimeline])

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

      <TopicPicker
        locale={locale}
        mode={mode}
        proposition={proposition}
        context={context}
        seatCount={seatCount}
        available={roster?.members.length ?? DEFAULT_SEATS}
        running={phase === 'agenda' || phase === 'blind' || phase === 'floor' || phase === 'convergence'}
        onMode={(next) => {
          setMode(next)
          setProposals([])
          setPicked(null)
        }}
        onProposition={setProposition}
        onContext={setContext}
        onSeats={setSeatCount}
        onRun={() => void run()}
      />

      {/* The agenda stays on screen after the session: what the panel proposed, and
          which proposal was actually debated, are part of the record. */}
      {mode === 'panel' && proposals.length > 0 ? (
        <AgendaPanel
          locale={locale}
          proposals={proposals}
          clusters={clusters}
          pick={picked}
          onPick={(value) => {
            setPicked(value)
            setProposition(value)
          }}
        />
      ) : null}

      <Discussion locale={locale} panel={panel} blind={blind} floor={floor} convergence={convergence} active={activeRound} />
      <ConvergenceCard locale={locale} trajectory={record?.trajectory ?? null} />
      <VerdictCard locale={locale} record={record} />

      {record ? <ExportCard locale={locale} onExport={exportRecord} problems={archiveProblems} /> : null}

      <Timeline
        locale={locale}
        records={sharedTimeline}
        onDebate={(motion) => {
          setMode('given')
          setProposition(motion)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      <SessionList
        locale={locale}
        sessions={sessions}
        onReask={(motion) => {
          setMode('given')
          setProposition(motion)
        }}
        onClear={() => {
          clearSessions()
          setSessions([])
        }}
      />

      <RosterPanel locale={locale} roster={roster} />
      <Evidence locale={locale} />

      <footer className="ag-foot">{text(copy.footer, locale)}</footer>
    </main>
  )
}
