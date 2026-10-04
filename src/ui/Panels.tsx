import { useState } from 'react'
import manifest from '../../lab.manifest.json'
import { EvidenceDetails } from '@aserdargun/lab-ui'
import { estimateRequests, type Locale, type Position, type Quota, type Roster, type SessionRecord, type Vote } from '../core/types'
import type { FloorTurn } from '../core/types'
import { copy, text } from './copy'

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

export function PropositionForm({
  locale,
  proposition,
  context,
  seatCount,
  available,
  running,
  onProposition,
  onContext,
  onSeats,
  onRun,
}: {
  locale: Locale
  proposition: string
  context: string
  seatCount: number
  available: number
  running: boolean
  onProposition: (next: string) => void
  onContext: (next: string) => void
  onSeats: (next: number) => void
  onRun: () => void
}) {
  const cost = estimateRequests(seatCount)

  return (
    <section className="ag-card">
      <h2>{text(copy.formHeading, locale)}</h2>
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
      <div className="ag-row">
        <label className="ag-inline">
          {text(copy.seatsLabel, locale)}
          <input
            type="number"
            min={2}
            max={Math.max(2, available)}
            value={seatCount}
            onChange={(event) => onSeats(Number(event.target.value))}
          />
        </label>
        <span className="ag-muted">
          {text(copy.willCost, locale)} <strong>{cost}</strong> {text(copy.requests, locale)}
        </span>
        <button type="button" onClick={onRun} disabled={running || proposition.trim().length === 0}>
          {running ? text(copy.running, locale) : text(copy.run, locale)}
        </button>
      </div>
    </section>
  )
}

const positionClass = (position: Position): string => `ag-pos ag-pos-${position}`

function SeatCard({
  locale,
  seat,
  blind,
  floor,
}: {
  locale: Locale
  seat: string
  blind: Vote | undefined
  floor: FloorTurn | undefined
}) {
  const final = floor ?? blind
  if (!final) return null

  const basisLabel =
    final.confidenceBasis === 'measured'
      ? text(copy.measured, locale)
      : final.confidenceBasis === 'self-reported'
        ? text(copy.selfReported, locale)
        : text(copy.noConfidence, locale)

  return (
    <article className="ag-seat">
      <header>
        <span className="ag-seat-label">{text(copy.seat, locale)} {seat}</span>
        <span className={positionClass(final.position)}>{text(copy.positionLabel[final.position], locale)}</span>
      </header>
      {final.reason ? <p>{final.reason}</p> : null}
      <footer>
        {final.confidence !== null ? (
          <span className="ag-confidence">
            {final.confidence}% <em>{basisLabel}</em>
          </span>
        ) : null}
        {!final.formatCompliant ? <span className="ag-warn">{text(copy.nonCompliant, locale)}</span> : null}
        {floor ? (
          <span className={floor.changed ? 'ag-moved' : 'ag-held'}>
            {floor.changed ? text(copy.changed, locale) : text(copy.stayed, locale)}
          </span>
        ) : null}
        {final.error ? <span className="ag-error-inline">{text(copy.unreadable, locale)}: {final.error}</span> : null}
      </footer>
    </article>
  )
}

export function SessionView({
  locale,
  phase,
  blind,
  floor,
  seats,
}: {
  locale: Locale
  phase: 'idle' | 'blind' | 'floor' | 'verdict' | 'done' | 'failed'
  blind: Vote[]
  floor: FloorTurn[]
  seats: string[]
}) {
  if (phase === 'idle' || blind.length === 0) return null

  return (
    <section className="ag-card">
      <h2>{phase === 'blind' ? text(copy.phaseBlind, locale) : text(copy.phaseFloor, locale)}</h2>
      <div className="ag-seats">
        {seats.map((seat) => (
          <SeatCard key={seat} locale={locale} seat={seat} blind={blind.find((v) => v.seat === seat)} floor={floor.find((v) => v.seat === seat)} />
        ))}
      </div>
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
        {text(copy.agreement, locale)}: <strong>{Math.round(tally.consensus * 100)}%</strong> ·{' '}
        {text(copy.dissentShare, locale)}: <strong>{Math.round(tally.dissentShare * 100)}%</strong>
      </p>
      <h3>{text(copy.dissentHeading, locale)}</h3>
      {tally.dissentingSeats.length === 0 ? (
        <p className="ag-muted">{text(copy.noDissent, locale)}</p>
      ) : (
        <ul className="ag-dissent">
          {tally.dissentingSeats.map((seat) => {
            const turn = record.floor.find((entry) => entry.seat === seat)
            return (
              <li key={seat}>
                <strong>{seat}</strong> — {turn?.reason || (locale === 'tr' ? 'gerekçe yok' : 'no reason given')}
              </li>
            )
          })}
        </ul>
      )}
      <p className="ag-muted">{text(copy.tallyNote, locale)}</p>
    </section>
  )
}

export function ArchiveList({
  locale,
  sessions,
  onReask,
  onClear,
}: {
  locale: Locale
  sessions: SessionRecord[]
  onReask: (proposition: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section className="ag-card">
      <h2>{text(copy.archiveHeading, locale)}</h2>
      {sessions.length === 0 ? (
        <p className="ag-muted">{text(copy.archiveEmpty, locale)}</p>
      ) : (
        <>
          <ol className="ag-archive">
            {sessions.map((session) => (
              <li key={session.id}>
                <button type="button" className="ag-ghost" onClick={() => setOpen(open === session.id ? null : session.id)}>
                  <span className="ag-when">{session.finishedAt.slice(0, 10)}</span>
                  <span className="ag-what">{session.motion}</span>
                  <span className="ag-muted">
                    {session.verdict.tally.leading} · {Math.round(session.verdict.tally.consensus * 100)}%
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
                    <ul>
                      {session.floor.map((turn) => (
                        <li key={turn.seat}>
                          <strong>{turn.seat}</strong> {turn.position} — {turn.reason}
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => onReask(session.motion)}>
                      {text(copy.reask, locale)}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          <p className="ag-muted">{text(copy.archiveStored, locale)}</p>
          <button type="button" className="ag-ghost" onClick={onClear}>
            {text(copy.clearArchive, locale)}
          </button>
        </>
      )}
    </section>
  )
}

/** The evidence ledger renders straight from the manifest so it cannot drift from it. */
export function Evidence({ locale }: { locale: Locale }) {
  return (
    <section className="ag-card">
      <EvidenceDetails
        records={manifest.evidence as never}
        assumptions={manifest.assumptions as never}
        locale={locale}
      />
    </section>
  )
}
