import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AgendaPanel,
  ConvergenceCard,
  Discussion,
  EmptyState,
  Evidence,
  ExportCard,
  KeyGate,
  LocaleToggle,
  OutcomeCard,
  QuotaChip,
  RosterPanel,
  RunProgress,
  SessionList,
  SessionStrip,
  ThemeToggle,
  TopicPicker,
  type LiveProgress,
  type LiveStage,
} from './Panels'
import { TabBar, TabPanel, type TabDef } from './Tabs'
import { Timeline } from './Timeline'
import { copy, text } from './copy'
import { applyTheme, loadTheme, resolveTheme, storeTheme, type Theme } from './theme'
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
import { fetchSharedTimeline, storeRecord, type StoreState } from '../core/cloud-archive'
import shared from '../data/timeline.generated.json'
import type { FloorTurn, Locale, Proposal, Quota, Roster, RoundKind, SessionRecord, Vote } from '../core/types'

type Phase = 'idle' | 'agenda' | 'blind' | 'floor' | 'convergence' | 'done'

/**
 * The five sections, in the order a session is used.
 *
 * `panel` is where a visitor starts and where the run is watched, `outcome` is what the
 * whole thing is for, `transcript` is the evidence behind it, and the last two are the
 * record and the roster. A single scrolling page put the count, the roster and the shared
 * history in one queue, so the one thing a visitor came to read was somewhere in the middle.
 */
type Tab = 'panel' | 'outcome' | 'transcript' | 'archive' | 'roster'

const DEFAULT_SEATS = 5
const SEAT_CHOICES = [3, 5, 7]

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
  const [themeChoice, setThemeChoice] = useState<Theme | null>(() => loadTheme())
  const theme = resolveTheme(themeChoice)

  const [tab, setTab] = useState<Tab>('panel')
  const [mode, setMode] = useState<'given' | 'panel'>('given')
  const [proposition, setProposition] = useState('')
  const [context, setContext] = useState('')
  const [seatCount, setSeatCount] = useState(() => seatsFromSearch(window.location.search))

  const [phase, setPhase] = useState<Phase>('idle')
  const [activeRound, setActiveRound] = useState<RoundKind | 'agenda' | null>(null)
  const [progress, setProgress] = useState<LiveProgress>({ stage: null, called: [], answers: [] })
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const [blind, setBlind] = useState<Vote[]>([])
  const [floor, setFloor] = useState<FloorTurn[]>([])
  const [convergence, setConvergence] = useState<FloorTurn[]>([])
  const [panel, setPanel] = useState<SessionRecord['panel']>([])
  const [record, setRecord] = useState<SessionRecord | null>(null)
  /** A past session pulled out of this browser's own list, shown in place of the last one. */
  const [viewing, setViewing] = useState<SessionRecord | null>(null)
  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions())
  const [store, setStore] = useState<StoreState>({ phase: 'idle' })
  const [feed, setFeed] = useState<{ records: TimelineRecord[]; refused: number } | null>(null)
  const [feedState, setFeedState] = useState<'loading' | 'live' | 'unreadable'>('loading')

  /**
   * Which round the engine is currently in, for progress reporting only.
   *
   * `deps.onProgress` fires once per dispatched request, but `deps.call` is the only place
   * that knows which model actually answered. Reading the stage from a ref here lets the
   * interface say "two of five answered" from facts it already has, without the engine
   * knowing that a progress bar exists.
   */
  const stage = useRef<LiveStage | null>(null)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // The shared record is read from the archive rather than baked into the bundle, so it is
  // as current as the last session anyone filed. An unreachable archive leaves it null and
  // the timeline falls back to what this browser already holds.
  const readFeed = useCallback((signal?: AbortSignal) => {
    void fetchSharedTimeline(signal).then((result) => {
      // An abandoned read is not a failed one, and a failed one empties the feed rather
      // than leaving rows of unknown age on screen: a shared record that cannot be dated
      // is not shown as if it were current.
      if (signal?.aborted) return
      if (result.ok) {
        setFeed({ records: result.records, refused: result.refused })
        setFeedState('live')
      } else {
        setFeed(null)
        setFeedState('unreadable')
      }
    })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    readFeed(controller.signal)
    return () => controller.abort()
  }, [readFeed])

  useEffect(() => {
    applyTheme(themeChoice)
  }, [themeChoice])

  useEffect(() => {
    const controller = new AbortController()
    fetchCatalog(controller.signal)
      .then((payload) => setRoster(curateRoster(payload, new Date().toISOString().slice(0, 10))))
      .catch(() => setRoster(null))
    return () => controller.abort()
  }, [])

  // A `?seats=` link can ask for more models than this week's catalogue can seat. The link
  // is honoured as far as the roster allows rather than silently running a smaller panel.
  useEffect(() => {
    const available = roster?.members.length ?? 0
    if (available >= 2 && seatCount > available) setSeatCount(available)
  }, [roster, seatCount])

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
    setViewing(null)
    setStore({ phase: 'idle' })
    setProposals([])
    setClusters([])
    setPicked(null)
    setPanel(seats)
    setProgress({ stage: mode === 'panel' ? 'agenda' : 'blind', called: [], answers: [] })
    setTab('panel')

    const startedAt = new Date().toISOString()
    const before = quota
    const labels = seats.map((seat) => seat.label)
    stage.current = mode === 'panel' ? 'agenda' : 'blind'

    const callDeps = {
      key: key.trim(),
      call: async ({
        model,
        messages,
        logprobs,
        json,
        signal,
      }: {
        model: string
        messages: { role: 'system' | 'user'; content: string }[]
        logprobs: boolean
        json: boolean
        signal: AbortSignal
      }) => {
        let failed = false
        try {
          return await streamChat(key.trim(), model, messages, { signal, logprobs, json })
        } catch (error) {
          failed = true
          throw error
        } finally {
          const seat = seats.find((entry) => entry.member.id === model)?.label
          const current = stage.current
          if (seat && current) {
            setProgress((prev) => ({ ...prev, answers: [...prev.answers, { stage: current, seat, failed }] }))
          }
        }
      },
      onProgress: (round: RoundKind, seat: string) => {
        // The agenda round reports itself as a blind round with the seat marker `agenda`,
        // because it runs before the discussion does. Taken at face value the interface
        // would call the topic round the first round.
        const next: LiveStage = seat === 'agenda' ? 'agenda' : round
        stage.current = next
        setActiveRound(next)
        setPhase(next === 'convergence' ? 'convergence' : next)
        setProgress((prev) => {
          const called = next === 'blind' || next === 'agenda' ? labels : [seat]
          return {
            stage: next,
            called: prev.stage === next ? [...new Set([...prev.called, ...called])] : called,
            answers: prev.answers,
          }
        })
      },
      // Each round lands as soon as it is counted, so the transcript is written while the
      // panel is still arguing instead of appearing all at once at the end. The engine
      // hands over the same entries the tally was built from; nothing is re-parsed here.
      onRound: (kind: RoundKind, entries: (Vote | FloorTurn)[]) => {
        if (kind === 'blind') setBlind(entries as Vote[])
        else if (kind === 'floor') setFloor(entries as FloorTurn[])
        else setConvergence(entries as FloorTurn[])
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
          setProgress({ stage: null, called: [], answers: [] })
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
      stage.current = null
      // The count is the reason the session was run, so a finished session opens on it.
      setTab('outcome')
    } catch (error) {
      setPhase('idle')
      setActiveRound(null)
      stage.current = null
      setKeyError(error instanceof Error ? error.message : String(error))
    }
  }, [context, key, locale, mode, picked, proposition, quota, roster, seatCount])

  const exportRecord = useCallback(() => {
    if (!record) return
    const candidate = toArchiveRecord(record)
    if (!candidate) return
    download(`agora-${candidate.id}.json`, candidate)
  }, [record])

  /**
   * Hand the finished session to the shared archive.
   *
   * The session is already on screen and already saved in this browser, so this can only
   * add a copy; a refusal or a failure changes the state of the button and nothing else.
   */
  const fileRecord = useCallback(() => {
    if (!record) return
    const candidate = toArchiveRecord(record)
    if (!candidate) {
      setStore({ phase: 'refused', errors: [text(copy.exportNoQuota, locale)] })
      return
    }
    setStore({ phase: 'storing' })
    void storeRecord(candidate).then((result) => {
      if (result.ok) {
        setStore({ phase: 'stored', id: result.id })
        readFeed()
        return
      }
      setStore(result.reason === 'refused' ? { phase: 'refused', errors: result.errors } : { phase: 'unreachable' })
    })
  }, [locale, readFeed, record])

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
    const ids = new Set<string>()
    return [...base, ...(feed?.records ?? []), ...localTimeline]
      .filter((row) => {
        if (!row || ids.has(row.id)) return false
        ids.add(row.id)
        return true
      })
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
  }, [feed, localTimeline])

  /** Who would sit if the panel were convened now, before any requests are spent. */
  const seated = useMemo(() => (roster ? buildPanel(roster.members, seatCount) : []), [roster, seatCount])
  const available = roster?.members.length ?? DEFAULT_SEATS
  const seatChoices = useMemo(() => {
    const asked = [...SEAT_CHOICES, seatCount].filter((n) => n >= 2 && n <= Math.max(2, available))
    return [...new Set(asked)].sort((a, b) => a - b)
  }, [available, seatCount])

  const running = phase === 'agenda' || phase === 'blind' || phase === 'floor' || phase === 'convergence'
  const shown = viewing ?? record
  const rounds = blind.length > 0 ? 2 + (convergence.length > 0 ? 1 : 0) : 0

  const tabs: TabDef<Tab>[] = [
    { id: 'panel', label: text(copy.tabPanel, locale), live: running },
    {
      id: 'outcome',
      label: text(copy.tabOutcome, locale),
      badge: record ? (record.verdict.tally.leading === 'abstain' ? '—' : `${Math.round(record.verdict.tally.consensus * 100)}%`) : null,
    },
    { id: 'transcript', label: text(copy.tabTranscript, locale), badge: rounds > 0 ? String(rounds) : null },
    { id: 'archive', label: text(copy.tabArchive, locale), badge: sharedTimeline.length > 0 ? String(sharedTimeline.length) : null },
    { id: 'roster', label: text(copy.tabRoster, locale), badge: roster?.members.length ?? null },
  ]

  const home = `https://aserdargun.com/${locale === 'tr' ? 'tr/' : ''}`

  return (
    <main className="ag">
      <a className="ag-skip" href="#panel">
        {text(copy.skipToPanel, locale)}
      </a>
      <header className="ag-head">
        <div>
          <span className="ag-eyebrow">{text(copy.familyMark, locale)}</span>
          <h1>{text(copy.title, locale)}</h1>
          <p className="ag-muted">{text(copy.tagline, locale)}</p>
        </div>
        <div className="ag-head-tools">
          <LocaleToggle locale={locale} onChange={setLocale} />
          <ThemeToggle
            theme={theme}
            locale={locale}
            onChange={(next) => {
              storeTheme(next)
              setThemeChoice(next)
            }}
          />
        </div>
      </header>

      <TabBar
        tabs={tabs}
        active={tab}
        onChange={setTab}
        label={text(copy.tablistLabel, locale)}
        trailing={<QuotaChip locale={locale} quota={quota} />}
      />

      <TabPanel id="panel" active={tab === 'panel'}>
        <div className="ag-stack" id="panel">
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
            saved={Boolean(key.trim()) && quota !== null}
          />

          <TopicPicker
            locale={locale}
            mode={mode}
            proposition={proposition}
            context={context}
            seatCount={seatCount}
            seatChoices={seatChoices}
            panel={seated}
            running={running}
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

          {running ? (
            <RunProgress
              locale={locale}
              progress={progress}
              panel={panel}
              written={rounds}
              onRead={() => setTab('transcript')}
            />
          ) : null}

          {record ? (
            <SessionStrip
              locale={locale}
              record={record}
              onOpenOutcome={() => setTab('outcome')}
              onReadTranscript={() => setTab('transcript')}
            />
          ) : null}
        </div>
      </TabPanel>

      <TabPanel id="outcome" active={tab === 'outcome'}>
        <div className="ag-stack">
          {viewing ? (
            <p className="ag-notice">
              <span className="ag-muted ag-small">
                {text(copy.showingPast, locale)} <span className="ag-when">{viewing.finishedAt.slice(0, 10)}</span>
              </span>
              <button type="button" className="ag-ghost" onClick={() => setViewing(null)}>
                {text(copy.backToLatest, locale)}
              </button>
            </p>
          ) : null}
          {shown ? (
            <>
              <OutcomeCard locale={locale} record={shown} />
              <ConvergenceCard locale={locale} trajectory={shown.trajectory} />
              {record ? (
                <ExportCard
                  locale={locale}
                  onExport={exportRecord}
                  onStore={fileRecord}
                  store={store}
                  problems={archiveProblems}
                />
              ) : null}
            </>
          ) : (
            <EmptyState note={text(copy.tabOutcomeHint, locale)} />
          )}
        </div>
      </TabPanel>

      <TabPanel id="transcript" active={tab === 'transcript'}>
        <div className="ag-stack">
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

          {blind.length > 0 ? (
            <Discussion
              locale={locale}
              panel={panel}
              blind={blind}
              floor={floor}
              convergence={convergence}
              active={activeRound}
            />
          ) : (
            <EmptyState note={text(copy.tabTranscriptHint, locale)} />
          )}
        </div>
      </TabPanel>

      <TabPanel id="archive" active={tab === 'archive'}>
        <div className="ag-stack">
          <Timeline
            locale={locale}
            records={sharedTimeline}
            feedState={feedState}
            refused={feed?.refused ?? 0}
            onDebate={(motion) => {
              setMode('given')
              setProposition(motion)
              setTab('panel')
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />

          <SessionList
            locale={locale}
            sessions={sessions}
            onReask={(motion) => {
              setMode('given')
              setProposition(motion)
              setTab('panel')
            }}
            onRead={(session) => {
              setViewing(session)
              setTab('outcome')
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            onClear={() => {
              clearSessions()
              setSessions([])
            }}
          />
        </div>
      </TabPanel>

      <TabPanel id="roster" active={tab === 'roster'}>
        <div className="ag-stack">
          <RosterPanel locale={locale} roster={roster} />
          <Evidence locale={locale} />
        </div>
      </TabPanel>

      <footer className="ag-foot">
        <p>{text(copy.footer, locale)}</p>
        <nav className="ag-foot-links" aria-label={text(copy.portfolioNav, locale)}>
          <a href={home} target="_blank" rel="noreferrer">
            {text(copy.backToPortfolio, locale)}
          </a>
          <a href={`${home}applications/`} target="_blank" rel="noreferrer">
            {text(copy.backToApplications, locale)}
          </a>
        </nav>
      </footer>
    </main>
  )
}
