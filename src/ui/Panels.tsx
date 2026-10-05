import { useState } from 'react'
import manifest from '../../lab.manifest.json'
import { EvidenceDetails } from '@aserdargun/lab-ui'
import {
  estimateRequests,
  type Convergence,
  type FloorTurn,
  type Locale,
  type PanelSeat,
  type Position,
  type Proposal,
  type Quota,
  type Roster,
  type RoundKind,
  type SessionRecord,
  type Vote,
} from '../core/types'
import type { Cluster } from '../core/engine'
import type { StoreState } from '../core/cloud-archive'
import { copy, text } from './copy'
import type { Theme } from './theme'
import { selectionRule } from '../core/roster'

const percent = (value: number): string => `${Math.round(value * 100)}%`
const positionClass = (position: Position): string => `ag-pos ag-pos-${position}`

/** What a running session has already produced, used to show progress without guessing. */
export type LiveStage = 'agenda' | 'blind' | 'floor' | 'convergence'

export interface LiveAnswer {
  stage: LiveStage
  seat: string
  /** The request ended, but not with a readable position. */
  failed: boolean
}

export interface LiveProgress {
  stage: LiveStage | null
  /** Seat labels whose request has been dispatched, in the current stage. */
  called: string[]
  /** Every request that came back, with the stage it belonged to. */
  answers: LiveAnswer[]
}

export function LocaleToggle({ locale, onChange }: { locale: Locale; onChange: (next: Locale) => void }) {
  return (
    <div className="ag-locale" role="group" aria-label="Language">
      {(['en', 'tr'] as Locale[]).map((value) => (
        <button key={value} type="button" onClick={() => onChange(value)} aria-pressed={locale === value}>
          {value === 'en' ? 'English' : 'Türkçe'}
        </button>
      ))}
    </div>
  )
}

export function ThemeToggle({
  theme,
  locale,
  onChange,
}: {
  theme: Theme
  locale: Locale
  onChange: (next: Theme) => void
}) {
  const toDark = theme !== 'dark'
  return (
    <button
      type="button"
      className="ag-theme"
      onClick={() => onChange(toDark ? 'dark' : 'light')}
      aria-label={text(toDark ? copy.themeToDark : copy.themeToLight, locale)}
    >
      {text(toDark ? copy.themeDark : copy.themeLight, locale)}
    </button>
  )
}

/**
 * The key, and only the key.
 *
 * A saved key collapses to one line, because a password field is not what a visitor came
 * back for: the setup tab is where the proposition and the seat count live. The field is
 * never destroyed by saving it, so a visitor who mistypes can correct it without reloading.
 */
export function KeyGate({
  locale,
  value,
  onChange,
  onSave,
  onForget,
  checking,
  error,
  saved,
}: {
  locale: Locale
  value: string
  onChange: (next: string) => void
  onSave: () => void
  onForget: () => void
  checking: boolean
  error: string | null
  saved: boolean
}) {
  const [open, setOpen] = useState(!saved)

  if (saved && !open) {
    return (
      <section className="ag-card ag-keyline">
        <p className="ag-muted">{text(copy.keySaved, locale)}</p>
        <div className="ag-row">
          <button type="button" className="ag-ghost" onClick={() => setOpen(true)}>
            {text(copy.keyChange, locale)}
          </button>
          <button type="button" className="ag-ghost" onClick={onForget}>
            {text(copy.keyForget, locale)}
          </button>
        </div>
        {error ? (
          <p className="ag-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section className="ag-card">
      <h2>{text(copy.keyHeading, locale)}</h2>
      <p className="ag-muted">{text(copy.keyWhy, locale)}</p>
      <div className="ag-row">
        <input
          type="password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={text(copy.keyPlaceholder, locale)}
          autoComplete="off"
          spellCheck={false}
          aria-label={text(copy.keyHeading, locale)}
        />
        <button type="button" onClick={onSave} disabled={checking || value.trim().length === 0}>
          {checking ? '…' : text(copy.keySave, locale)}
        </button>
        {value.length > 0 ? (
          <button type="button" className="ag-ghost" onClick={onForget} disabled={value.length === 0}>
            {text(copy.keyForget, locale)}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="ag-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The daily free quota, as a chip in the tab bar.
 *
 * It used to be a card of its own, which meant a visitor who was reading a session had to
 * come back to the setup to find out whether another one was affordable. Budget is not a
 * result and not a step, so it lives in the chrome and stays visible from every section.
 */
export function QuotaChip({ locale, quota }: { locale: Locale; quota: Quota | null }) {
  const used = quota ? Math.min(quota.used, quota.limit) : 0
  const ratio = quota && quota.limit > 0 ? used / quota.limit : 0

  return (
    <p className="ag-quota-chip">
      <span className="ag-eyebrow">{text(copy.quotaHeading, locale)}</span>
      {!quota ? (
        <span className="ag-muted">{text(copy.quotaChipUnknown, locale)}</span>
      ) : (
        <>
          <span className="ag-quota">
            <strong>{quota.remaining}</strong> {text(copy.quotaLeftToday, locale)}
          </span>
          <span className="ag-meter" role="img" aria-label={`${Math.round(ratio * 100)}%`}>
            <span style={{ width: `${Math.max(2, ratio * 100)}%` }} />
          </span>
        </>
      )}
    </p>
  )
}

export function RosterPanel({ locale, roster }: { locale: Locale; roster: Roster | null }) {
  if (!roster) {
    return (
      <section className="ag-card">
        <h2>{text(copy.rosterHeading, locale)}</h2>
        <p className="ag-muted">…</p>
      </section>
    )
  }

  const shaped = roster.members.filter((member) => member.supports.responseFormat || member.supports.structuredOutputs)

  return (
    <section className="ag-card">
      <h2>
        {text(copy.rosterHeading, locale)} <span className="ag-count">{roster.members.length}</span>
      </h2>
      <p className="ag-muted">{text(copy.rosterNote, locale)}</p>
      {roster.members.length === 0 ? <p className="ag-muted">{text(copy.rosterEmpty, locale)}</p> : null}
      <ul className="ag-roster">
        {roster.members.map((member) => (
          <li key={member.id}>
            <span className="ag-slug">{member.slug}</span>
            <span className="ag-tags">
              {member.supports.logprobs ? <em className="ag-tag">{text(copy.capability, locale)}</em> : null}
              {member.supports.responseFormat || member.supports.structuredOutputs ? (
                <em className="ag-tag ag-tag-json">JSON</em>
              ) : null}
              <em className="ag-tag ag-tag-dim">{(member.contextLength / 1000).toFixed(0)}k</em>
            </span>
          </li>
        ))}
      </ul>
      <p className="ag-muted">
        {shaped.length}/{roster.members.length} — {text(copy.structuredOnly, locale)}
      </p>
      <p className="ag-muted ag-small">{selectionRule[locale]}</p>

      {roster.excluded.length > 0 ? (
        <>
          <h3>{text(copy.rosterExcluded, locale)}</h3>
          <ul className="ag-excluded">
            {roster.excluded.map((entry) => (
              <li key={entry.id}>
                <span className="ag-slug">{entry.id}</span>
                <span className="ag-muted">{entry.reason[locale] ?? entry.reason.en}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

/**
 * The setup: what to argue about, and how many models argue it.
 *
 * Seat count moved from a number field to a row of choices, because the number is not the
 * only thing being chosen — each choice carries the requests it will spend, and the free
 * tier is the reason the panel is small. A spinner hid both of those behind a value.
 */
export function TopicPicker({
  locale,
  mode,
  proposition,
  context,
  seatCount,
  seatChoices,
  panel,
  running,
  onMode,
  onProposition,
  onContext,
  onSeats,
  onRun,
}: {
  locale: Locale
  mode: 'given' | 'panel'
  proposition: string
  context: string
  seatCount: number
  seatChoices: number[]
  panel: PanelSeat[]
  running: boolean
  onMode: (next: 'given' | 'panel') => void
  onProposition: (next: string) => void
  onContext: (next: string) => void
  onSeats: (next: number) => void
  onRun: () => void
}) {
  const cost = estimateRequests(seatCount, { agenda: mode === 'panel' })
  const ready = mode === 'panel' || proposition.trim().length > 0

  return (
    <section className="ag-card">
      <h2>{text(copy.topicHeading, locale)}</h2>
      <div className="ag-row ag-tabs" role="group" aria-label={text(copy.topicHeading, locale)}>
        <button type="button" aria-pressed={mode === 'given'} onClick={() => onMode('given')}>
          {text(copy.topicGiven, locale)}
        </button>
        <button type="button" aria-pressed={mode === 'panel'} onClick={() => onMode('panel')}>
          {text(copy.topicPanel, locale)}
        </button>
      </div>

      {mode === 'panel' ? (
        <p className="ag-muted">{text(copy.topicPanelNote, locale)}</p>
      ) : (
        <>
          <label>
            {text(copy.propositionLabel, locale)}
            <textarea
              value={proposition}
              onChange={(event) => onProposition(event.target.value)}
              placeholder={text(copy.propositionPlaceholder, locale)}
              rows={2}
            />
          </label>
          <label>
            {text(copy.contextLabel, locale)}
            <input value={context} onChange={(event) => onContext(event.target.value)} />
          </label>
        </>
      )}

      <h3>{text(copy.seatsQuestion, locale)}</h3>
      <div className="ag-seatpick" role="group" aria-label={text(copy.seatsQuestion, locale)}>
        {seatChoices.map((choice) => {
          const price = estimateRequests(choice, { agenda: mode === 'panel' })
          return (
            <button
              key={choice}
              type="button"
              className="ag-seatchoice"
              aria-pressed={seatCount === choice}
              onClick={() => onSeats(choice)}
            >
              <strong>{choice}</strong>
              <em>
                {price.min}–{price.max}
              </em>
            </button>
          )
        })}
        <span className="ag-muted ag-small ag-seatpick-note">{text(copy.seatsPerChoice, locale)}</span>
      </div>

      {panel.length > 0 ? (
        <div className="ag-seated">
          <p className="ag-muted ag-small">{text(copy.seatedFor, locale)}</p>
          <ul className="ag-seated-list">
            {panel.map((seat) => (
              <li key={seat.label}>
                <span className="ag-seat-label">{seat.label}</span>
                <span className="ag-slug">{seat.member.slug}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="ag-row ag-runrow">
        <span className="ag-muted">
          {text(copy.willCost, locale)}{' '}
          <strong>
            {cost.min}–{cost.max}
          </strong>{' '}
          {text(copy.requests, locale)}
        </span>
        <button type="button" onClick={onRun} disabled={running || !ready}>
          {running ? text(copy.running, locale) : text(copy.run, locale)}
        </button>
      </div>
      <p className="ag-muted ag-small">{text(copy.runCostNote, locale)}</p>
    </section>
  )
}

/**
 * The panel, mid-sentence.
 *
 * A five-seat session spends ten to fifteen requests over roughly a minute, and until now
 * the screen said only "in session". Every entry here is a request that was actually
 * dispatched or actually answered, so the wait shows the panel working rather than a timer
 * that guesses at it.
 */
export function RunProgress({
  locale,
  progress,
  panel,
  written,
  onRead,
}: {
  locale: Locale
  progress: LiveProgress
  panel: PanelSeat[]
  /** Rounds the engine has already counted, which the transcript tab is showing. */
  written: number
  onRead: () => void
}) {
  if (!progress.stage) return null
  const stage = progress.stage
  const done = (seat: string) => progress.answers.find((answer) => answer.stage === stage && answer.seat === seat)
  const answered = seatsFor(progress, panel).filter((seat) => done(seat.label)).length
  const backs = stage === 'convergence'
  // The final round is only spent on the seats that held out, so a seat nobody called back
  // is not waiting on anything and must not be shown as if it were.
  const seats = seatsFor(progress, panel)

  return (
    <section className="ag-card ag-live-card">
      <h2>
        {text(copy.progressHeading, locale)} <span className="ag-live" aria-hidden="true" />
      </h2>
      <p className="ag-muted">
        {stage === 'agenda' ? text(copy.roundAgenda, locale) : roundHeading(stage, locale)}
        {backs ? ` · ${text(copy.backAgain, locale)}` : ''}
      </p>
      <p className="ag-quota">
        <strong>
          {answered}/{seats.length}
        </strong>{' '}
        {text(copy.answeredCount, locale)}
      </p>
      <ul className="ag-ticker">
        {seats.map((seat) => {
          const answer = done(seat.label)
          const state = answer ? (answer.failed ? 'ag-tick-failed' : 'ag-ticked') : 'ag-tick-waiting'
          return (
            <li key={seat.label} className={state}>
              <span className="ag-seat-label">{seat.label}</span>
              <span className="ag-muted ag-small">
                {answer
                  ? answer.failed
                    ? text(copy.progressFailed, locale)
                    : text(copy.answeredCount, locale)
                  : text(copy.pending, locale)}
              </span>
            </li>
          )
        })}
      </ul>
      {written > 0 ? (
        <div className="ag-row ag-readlink">
          <button type="button" className="ag-ghost" onClick={onRead}>
            {text(copy.readAsWritten, locale)}
          </button>
        </div>
      ) : null}
    </section>
  )
}

/** The seats this stage is actually waiting on. */
const seatsFor = (progress: LiveProgress, panel: PanelSeat[]): PanelSeat[] =>
  progress.stage === 'convergence' && progress.called.length > 0
    ? panel.filter((seat) => progress.called.includes(seat.label))
    : panel

/** The last session, reduced to the line a returning visitor needs to find it. */
export function SessionStrip({
  locale,
  record,
  onOpenOutcome,
  onReadTranscript,
}: {
  locale: Locale
  record: SessionRecord
  onOpenOutcome: () => void
  onReadTranscript: () => void
}) {
  const { tally } = record.verdict
  return (
    <section className="ag-card ag-strip">
      <p className="ag-eyebrow">{text(copy.lastSession, locale)}</p>
      <p className="ag-strip-motion">{record.motion}</p>
      <p className="ag-muted">
        <span className={positionClass(tally.leading)}>{text(copy.positionLabel[tally.leading], locale)}</span> ·{' '}
        {text(copy.agreement, locale)} <strong>{percent(tally.consensus)}</strong> · {record.requestsSpent}{' '}
        {text(copy.requests, locale)}
      </p>
      <div className="ag-row">
        <button type="button" onClick={onOpenOutcome}>
          {text(copy.openOutcome, locale)}
        </button>
        <button type="button" className="ag-ghost" onClick={onReadTranscript}>
          {text(copy.readTranscript, locale)}
        </button>
      </div>
    </section>
  )
}

/** An empty section says what will fill it, rather than showing a blank page. */
export function EmptyState({ note }: { note: string }) {
  return (
    <section className="ag-card ag-empty">
      <p className="ag-muted">{note}</p>
    </section>
  )
}

/** Round 0 output: what the panel wanted to argue about. */
export function AgendaPanel({
  locale,
  proposals,
  clusters,
  pick,
  onPick,
}: {
  locale: Locale
  proposals: Proposal[]
  clusters: Cluster[]
  pick: string | null
  onPick: (proposition: string) => void
}) {
  if (proposals.length === 0) return null
  const sizeOf = (proposition: string) => clusters.find((cluster) => cluster.proposition === proposition)?.seats.length ?? 1
  const isPick = (proposition: string) => clusters[0]?.proposition === proposition

  return (
    <section className="ag-card">
      <h2>{text(copy.agendaHeading, locale)}</h2>
      <p className="ag-muted">{text(copy.agendaNote, locale)}</p>
      <ul className="ag-agenda">
        {proposals.map((proposal) => (
          <li key={proposal.seat} className={pick === proposal.proposition ? 'ag-picked' : undefined}>
            <div>
              <span className="ag-seat-label">{proposal.seat}</span>
              <p className="ag-claim">{proposal.proposition}</p>
              {proposal.reason ? <p className="ag-muted">{proposal.reason}</p> : null}
              <p className="ag-muted ag-small">
                {sizeOf(proposal.proposition)} {text(copy.agendaCluster, locale)}
                {isPick(proposal.proposition) ? ` · ${text(copy.agendaChosenBy, locale)}` : ''}
                {!proposal.formatCompliant ? ` · ${text(copy.nonCompliant, locale)}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => onPick(proposal.proposition)}>
              {text(copy.debateThis, locale)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function TurnCard({
  locale,
  seat,
  entry,
  showChanged,
  modelId,
}: {
  locale: Locale
  seat: string
  entry: Vote | FloorTurn
  showChanged: boolean
  modelId: string | null
}) {
  const basis =
    entry.confidenceBasis === 'measured'
      ? text(copy.measured, locale)
      : entry.confidenceBasis === 'self-reported'
        ? text(copy.selfReported, locale)
        : text(copy.noConfidence, locale)
  const changed = 'changed' in entry ? entry.changed : false

  return (
    <article className="ag-turn" id={`turn-${seat}`}>
      <header>
        <span className="ag-seat-label">
          {text(copy.seat, locale)} {seat}
          {modelId ? <em className="ag-model">{modelId.replace(':free', '')}</em> : null}
        </span>
        <span className={positionClass(entry.position)}>{text(copy.positionLabel[entry.position], locale)}</span>
      </header>
      {entry.reason ? <p className="ag-said">{entry.reason}</p> : null}
      <footer>
        {entry.addressed.length > 0 ? (
          <span className="ag-addresses">
            {text(copy.answersTo, locale)}{' '}
            {entry.addressed.map((label) => (
              <a key={label} href={`#turn-${label}`}>
                {label}
              </a>
            ))}
          </span>
        ) : (
          <span className="ag-muted ag-small">{text(copy.answeredNobody, locale)}</span>
        )}
        {entry.confidence !== null ? (
          <span className="ag-confidence">
            {entry.confidence}% <em>{basis}</em>
          </span>
        ) : null}
        {showChanged ? (
          <span className={changed ? 'ag-moved' : 'ag-held'}>{changed ? text(copy.changed, locale) : text(copy.stayed, locale)}</span>
        ) : null}
        {!entry.formatCompliant ? <span className="ag-warn">{text(copy.nonCompliant, locale)}</span> : null}
        {entry.error ? (
          <span className="ag-error-inline">
            {text(copy.unreadable, locale)}: {entry.error}
          </span>
        ) : null}
      </footer>
    </article>
  )
}

const roundHeading = (kind: RoundKind, locale: Locale): string => {
  if (kind === 'blind') return text(copy.roundBlind, locale)
  if (kind === 'floor') return text(copy.roundFloor, locale)
  if (kind === 'convergence') return text(copy.roundConvergence, locale)
  return text(copy.roundAgenda, locale)
}

/**
 * The discussion itself, round by round.
 *
 * A model name appears here but never in a prompt, so a reader can attribute a position
 * to a model while the model could not attribute anyone else's argument to a brand.
 */
export function Discussion({
  locale,
  panel,
  blind,
  floor,
  convergence,
  active,
}: {
  locale: Locale
  panel: PanelSeat[]
  blind: Vote[]
  floor: FloorTurn[]
  convergence: FloorTurn[]
  active: string | null
}) {
  if (blind.length === 0) return null
  const modelOf = (seat: string) => panel.find((entry) => entry.label === seat)?.member.id ?? null

  const rounds: { kind: RoundKind; entries: (Vote | FloorTurn)[]; showChanged: boolean }[] = [
    { kind: 'blind', entries: blind, showChanged: false },
    { kind: 'floor', entries: floor, showChanged: true },
  ]
  if (convergence.length > 0) rounds.push({ kind: 'convergence', entries: convergence, showChanged: true })

  return (
    <section className="ag-card">
      {rounds.length > 1 ? (
        <nav className="ag-roundnav" aria-label={text(copy.roundsNavLabel, locale)}>
          {rounds.map(({ kind }, index) => (
            <a key={kind} href={`#round-${kind}`}>
              <span className="ag-muted">{index + 1}</span> {roundHeading(kind, locale).split('·')[0].trim()}
            </a>
          ))}
        </nav>
      ) : null}
      {rounds.map(({ kind, entries, showChanged }) => (
        <div key={kind} className="ag-round" id={`round-${kind}`}>
          <h2>
            {roundHeading(kind, locale)}
            {active === kind ? <span className="ag-live" /> : null}
          </h2>
          <div className="ag-turns">
            {entries.map((entry) => (
              <TurnCard
                key={`${kind}-${entry.seat}`}
                locale={locale}
                seat={entry.seat}
                entry={entry}
                showChanged={showChanged}
                modelId={modelOf(entry.seat)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

/** Whether the panel converged, on a bar it declares rather than one that suits the result. */
export function ConvergenceCard({ locale, trajectory }: { locale: Locale; trajectory: Convergence | null }) {
  if (!trajectory || trajectory.snapshots.length === 0) return null
  const last = trajectory.snapshots[trajectory.snapshots.length - 1]
  const undecided = last.leading === 'abstain'

  return (
    <section className="ag-card ag-convergence">
      <h2>{text(copy.convergenceHeading, locale)}</h2>
      <p className={trajectory.reached ? 'ag-yes' : 'ag-no'}>
        {undecided
          ? text(copy.convergenceUndecided, locale)
          : trajectory.reached
            ? text(copy.convergenceReached, locale)
            : text(copy.convergenceNotReached, locale)}
      </p>

      <ol className="ag-trajectory">
        {trajectory.snapshots.map((snapshot) => (
          <li key={snapshot.kind}>
            <span className="ag-muted">{roundHeading(snapshot.kind, locale).split('·')[0].trim()}</span>
            <span className="ag-bar">
              <span style={{ width: `${Math.max(2, snapshot.agreement * 100)}%` }} />
            </span>
            <strong>{percent(snapshot.agreement)}</strong>
          </li>
        ))}
        <li className="ag-threshold" aria-label={text(copy.convergenceBar, locale)}>
          <span className="ag-muted">{text(copy.convergenceBar, locale)}</span>
          <span className="ag-bar">
            <span style={{ width: `${trajectory.threshold * 100}%` }} />
          </span>
          <strong>{percent(trajectory.threshold)}</strong>
        </li>
      </ol>

      {trajectory.invited.length === 0 ? (
        <p className="ag-muted">{text(copy.convergenceNone, locale)}</p>
      ) : (
        <>
          {trajectory.moved.length > 0 ? (
            <p>
              <strong>{text(copy.convergenceMoved, locale)}: </strong>
              {trajectory.moved
                .map((entry) => `${entry.seat} ${text(copy.positionLabel[entry.from], locale)} → ${text(copy.positionLabel[entry.to], locale)}`)
                .join(' · ')}
            </p>
          ) : null}
          {trajectory.held.length > 0 ? (
            <p>
              <strong>{text(copy.convergenceHeld, locale)}: </strong>
              {trajectory.held.join(', ')}
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}

/**
 * The outcome: what was asked, who sat, what the count came to, in prose.
 *
 * The prose summary comes before the bars, because a visitor who came here to learn the
 * result should not have to read a stacked bar chart to find it. The bars are the evidence
 * for the sentence, not the other way round. The summary is generated from the stored count
 * by `verdictText`, so no panelist writes the paragraph that reports their own vote.
 */
export function OutcomeCard({ locale, record }: { locale: Locale; record: SessionRecord | null }) {
  if (!record) return null
  const { tally } = record.verdict
  const seatCount = Math.max(1, record.panel.length)

  return (
    <section className="ag-card ag-verdict">
      <p className="ag-eyebrow">{text(copy.outcomeEyebrow, locale)}</p>
      <h2 className="ag-motion">{record.motion}</h2>
      <p className="ag-muted ag-small">
        {text(copy.outcomeModels, locale)}:{' '}
        <span className="ag-history-seats">
          {record.panel.map((seat) => `${seat.label} ${seat.member.slug.replace(':free', '')}`).join(' · ')}
        </span>
      </p>

      {record.verdict.synthesis ? (
        <>
          <h3>{text(copy.summaryHeading, locale)}</h3>
          <p className="ag-summary">{record.verdict.synthesis}</p>
        </>
      ) : null}

      <h3>{text(copy.verdictHeading, locale)}</h3>
      <ul className="ag-tally">
        {(['support', 'oppose', 'abstain', 'unclear'] as Position[]).map((position) => (
          <li key={position}>
            <span className={positionClass(position)}>{text(copy.positionLabel[position], locale)}</span>
            <span className="ag-bar">
              <span style={{ width: `${(tally.counts[position] / seatCount) * 100}%` }} />
            </span>
            <strong>{tally.counts[position]}</strong>
          </li>
        ))}
      </ul>
      <p>
        {text(copy.agreement, locale)}: <strong>{percent(tally.consensus)}</strong> ·{' '}
        {text(copy.dissentShare, locale)}: <strong>{percent(tally.dissentShare)}</strong>
      </p>
      <h3>{text(copy.dissentHeading, locale)}</h3>
      {tally.dissentingSeats.length === 0 ? (
        <p className="ag-muted">{text(copy.noDissent, locale)}</p>
      ) : (
        <ul className="ag-dissent">
          {[...record.floor, ...record.convergence]
            .filter((turn) => tally.dissentingSeats.includes(turn.seat))
            .map((turn) => (
              <li key={turn.seat}>
                <strong>{turn.seat}</strong> — {turn.reason || (locale === 'tr' ? 'gerekçe yok' : 'no reason given')}
              </li>
            ))}
        </ul>
      )}
      <p className="ag-muted ag-small">{text(copy.tallyNote, locale)}</p>
    </section>
  )
}

export function ExportCard({
  locale,
  onExport,
  onStore,
  store,
  problems,
}: {
  locale: Locale
  onExport: () => void
  onStore: () => void
  store: StoreState
  problems: string[]
}) {
  const filing = store.phase === 'storing'
  return (
    <section className="ag-card">
      <h2>{text(copy.exportHeading, locale)}</h2>
      <p className="ag-muted">{text(copy.exportNote, locale)}</p>
      {problems.length > 0 ? (
        <>
          <p className="ag-error">{text(copy.exportRefused, locale)}</p>
          <ul className="ag-dissent">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="ag-row">
            <button type="button" onClick={onExport}>
              {text(copy.exportButton, locale)}
            </button>
            <button type="button" className="ag-ghost" onClick={onStore} disabled={filing}>
              {text(filing ? copy.storing : copy.storeButton, locale)}
            </button>
          </div>
          <p className="ag-muted">{text(copy.storeNote, locale)}</p>
        </>
      )}
      {store.phase === 'stored' ? <p className="ag-muted">{text(copy.stored, locale)}</p> : null}
      {store.phase === 'unreachable' ? <p className="ag-warn">{text(copy.storeUnreachable, locale)}</p> : null}
      {store.phase === 'refused' ? (
        <>
          <p className="ag-error">{text(copy.storeRefused, locale)}</p>
          <ul className="ag-dissent">
            {store.errors.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

export function SessionList({
  locale,
  sessions,
  onReask,
  onRead,
  onClear,
}: {
  locale: Locale
  sessions: SessionRecord[]
  onReask: (motion: string) => void
  onRead: (session: SessionRecord) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section className="ag-card">
      <h2>
        {text(copy.mySessions, locale)} <span className="ag-count">{sessions.length}</span>
      </h2>
      {sessions.length === 0 ? (
        <p className="ag-muted">{text(copy.mySessionsEmpty, locale)}</p>
      ) : (
        <>
          <ol className="ag-archive">
            {sessions.map((session) => (
              <li key={session.id}>
                <button type="button" className="ag-ghost" onClick={() => setOpen(open === session.id ? null : session.id)}>
                  <span className="ag-when">{session.finishedAt.slice(0, 10)}</span>
                  <span className="ag-what">{session.motion}</span>
                  <span className="ag-muted">
                    {text(copy.positionLabel[session.verdict.tally.leading], locale)} ·{' '}
                    {percent(session.verdict.tally.consensus)}
                  </span>
                </button>
                {open === session.id ? (
                  <div className="ag-archive-body">
                    <p className="ag-muted">
                      {session.panel.length} {locale === 'tr' ? 'koltuk' : 'seats'} · {session.requestsSpent}{' '}
                      {text(copy.requests, locale)} ·{' '}
                      {session.quota.after
                        ? `${session.quota.after.remaining} ${locale === 'tr' ? 'kaldı' : 'left'}`
                        : '—'}
                    </p>
                    <div className="ag-row">
                      <button type="button" onClick={() => onRead(session)}>
                        {text(copy.openOutcome, locale)}
                      </button>
                      <button type="button" className="ag-ghost" onClick={() => onReask(session.motion)}>
                        {text(copy.reask, locale)}
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <button type="button" className="ag-ghost" onClick={onClear}>
            {text(copy.clearArchive, locale)}
          </button>
        </>
      )}
    </section>
  )
}

export function Evidence({ locale }: { locale: Locale }) {
  return (
    <section className="ag-card">
      <EvidenceDetails records={manifest.evidence as never} assumptions={manifest.assumptions as never} locale={locale} />
    </section>
  )
}
