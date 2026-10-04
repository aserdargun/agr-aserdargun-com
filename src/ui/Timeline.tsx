import { groupByMotion, type TimelineRecord } from '../core/archive-schema'
import type { Locale, Tally } from '../core/types'
import { verdictText } from '../core/engine'
import { copy, text } from './copy'

const percent = (value: number): string => `${Math.round(value * 100)}%`

const tallyOf = (record: TimelineRecord): Tally => ({
  counts: record.counts,
  weights: record.counts,
  consensus: record.consensus,
  dissentShare: record.dissentShare,
  leading: record.leading,
  dissentingSeats: record.dissent.map((entry) => entry.seat),
  unreadableSeats: record.unreadable,
})

/**
 * The shared record: every proposition the panel has settled, and every time it was
 * settled again by a different roster.
 *
 * The comparison across rosters is the point. A count that held for four weeks and a
 * count that moved are different facts about the free tier, and neither is a fact about
 * the proposition being true.
 */
export function Timeline({ locale, records, onDebate }: { locale: Locale; records: TimelineRecord[]; onDebate: (motion: string) => void }) {
  if (records.length === 0) {
    return (
      <section className="ag-card">
        <h2>{text(copy.timelineHeading, locale)}</h2>
        <p className="ag-muted">{text(copy.timelineEmpty, locale)}</p>
      </section>
    )
  }

  const groups = groupByMotion(records)
  const repeated = groups.filter((group) => group.records.length > 1).length

  return (
    <section className="ag-card">
      <h2>
        {text(copy.timelineHeading, locale)} <span className="ag-count">{records.length}</span>
      </h2>
      <p className="ag-muted">{text(copy.timelineNote, locale)}</p>
      {repeated > 0 ? (
        <p className="ag-muted">
          {locale === 'tr'
            ? `${repeated} öneri birden fazla kadroyla yanıtlandı.`
            : `${repeated} proposition${repeated === 1 ? '' : 's'} answered by more than one roster.`}
        </p>
      ) : null}

      {groups.map((group) => (
        <article key={group.motion} className="ag-group">
          <header>
            <h3>{group.motion}</h3>
            <button type="button" className="ag-ghost" onClick={() => onDebate(group.motion)}>
              {text(copy.reask, locale)}
            </button>
          </header>
          <ol className="ag-history">
            {group.records.map((record) => {
              const moved = record.agreementPath.final - record.agreementPath.blind
              return (
                <li key={record.id}>
                  <div className="ag-history-head">
                    <span className="ag-when">{record.finishedAt.slice(0, 10)}</span>
                    <span className="ag-history-seats">{record.panel.map((seat) => seat.modelId.replace(':free', '')).join(' · ')}</span>
                  </div>
                  <p className="ag-summary-line">
                    {text(copy.positionLabel[record.leading], locale)} · {percent(record.consensus)} ·{' '}
                    {record.requestsSpent} {text(copy.requests, locale)}
                    {record.topicSource === 'panel' ? (locale === 'tr' ? ' · panelin konusu' : ' · the panel’s own topic') : ''}
                    {record.unreadable.length > 0
                      ? ` · ${locale === 'tr' ? 'okunamadı' : 'unreadable'}: ${record.unreadable.join(', ')}`
                      : ''}
                  </p>
                  {group.records.length > 1 ? (
                    <p className="ag-muted">
                      {locale === 'tr'
                        ? `Bu öneri ${group.records.length} kez yanıtlandı; görüşme içi uzlaşı ${group.records
                            .map((entry) => percent(entry.agreementPath.final))
                            .join(' → ')}.`
                        : `Answered ${group.records.length} times; in-session agreement ran ${group.records
                            .map((entry) => percent(entry.agreementPath.final))
                            .join(' → ')}.`}
                    </p>
                  ) : null}
                  {Math.abs(moved) > 0.001 ? (
                    <p className="ag-muted">
                      {locale === 'tr'
                        ? `Görüşme başında ${percent(record.agreementPath.blind)}, sonda ${percent(record.agreementPath.final)}.`
                        : `It started at ${percent(record.agreementPath.blind)} in the first round and ended at ${percent(record.agreementPath.final)}.`}
                    </p>
                  ) : null}
                  {record.dissent.length > 0 ? (
                    <ul className="ag-dissent">
                      {record.dissent.map((entry) => (
                        <li key={entry.seat}>
                          <strong>{entry.seat}</strong> {text(copy.positionLabel[entry.position], locale)} — {entry.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="ag-muted ag-verdict-prose">{verdictText(tallyOf(record), locale)}</p>
                </li>
              )
            })}
          </ol>
        </article>
      ))}
    </section>
  )
}
