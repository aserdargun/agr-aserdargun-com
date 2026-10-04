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
import { copy, text } from './copy'
import type { Theme } from './theme'
import { selectionRule } from '../core/roster'

const percent = (value: number): string => `${Math.round(value * 100)}%`
const positionClass = (position: Position): string => `ag-pos ag-pos-${position}`

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

export function KeyGate({
  locale,
  value,
  onChange,
  onSave,
  onForget,
  checking,
  error,
}: {
  locale: Locale
  value: string
  onChange: (next: string) => void
  onSave: () => void
  onForget: () => void
  checking: boolean
  error: string | null
}) {
  return (
    <section className="ag-card" id="panel">
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
        <button type="button" className="ag-ghost" onClick={onForget} disabled={value.length === 0}>
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

export function QuotaMeter({ locale, quota }: { locale: Locale; quota: Quota | null }) {
  const used = quota ? Math.min(quota.used, quota.limit) : 0
  const ratio = quota && quota.limit > 0 ? used / quota.limit : 0

  return (
    <section className="ag-card">
      <h2>{text(copy.quotaHeading, locale)}</h2>
      {!quota ? (
        <p className="ag-muted">{text(copy.quotaUnknown, locale)}</p>
      ) : (
        <>
          <p className="ag-quota">
            <strong>{quota.remaining}</strong> {locale === 'tr' ? 'istek kaldı' : 'requests left'}
            <span className="ag-muted">
              {' '}
              ({used}/{quota.limit})
            </span>
          </p>
          <div className="ag-meter" role="img" aria-label={`${Math.round(ratio * 100)}%`}>
            <span style={{ width: `${Math.max(2, ratio * 100)}%` }} />
          </div>
        </>
      )}
      <p className="ag-muted">{text(copy.quotaNote, locale)}</p>
    </section>
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

export function TopicPicker({
  locale,
  mode,
  proposition,
  context,
  seatCount,
  available,
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
  available: number
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

      <div className="ag-row">
        <label className="ag-inline">
          {text(copy.seatsLabel, locale)}
          <input
            type="number"
            min={2}
            max={Math.max(2, available)}
            value={seatCount}
            onChange={(event) => onSeats(Number(event.target.value))}
            aria-label={text(copy.seatsLabel, locale)}
          />
        </label>
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
      {rounds.map(({ kind, entries, showChanged }) => (
        <div key={kind} className="ag-round">
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

export function VerdictCard({ locale, record }: { locale: Locale; record: SessionRecord | null }) {
  if (!record) return null
  const { tally } = record.verdict
  const seatCount = Math.max(1, record.panel.length)

  return (
    <section className="ag-card ag-verdict">
      <h2>{text(copy.verdictHeading, locale)}</h2>
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
      <p className="ag-muted">{text(copy.tallyNote, locale)}</p>
      {record.verdict.synthesis ? <p className="ag-summary">{record.verdict.synthesis}</p> : null}
    </section>
  )
}

export function ExportCard({
  locale,
  onExport,
  problems,
}: {
  locale: Locale
  onExport: () => void
  problems: string[]
}) {
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
        <button type="button" onClick={onExport}>
          {text(copy.exportButton, locale)}
        </button>
      )}
    </section>
  )
}

export function SessionList({
  locale,
  sessions,
  onReask,
  onClear,
}: {
  locale: Locale
  sessions: SessionRecord[]
  onReask: (motion: string) => void
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
                    <button type="button" onClick={() => onReask(session.motion)}>
                      {text(copy.reask, locale)}
                    </button>
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
