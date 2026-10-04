import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface TabDef<T extends string = string> {
  id: T
  label: string
  /** A figure shown beside the name, set in mono by the stylesheet. */
  badge?: string | number | null
  /** Whether the section is the one a running session is writing into. */
  live?: boolean
}

/**
 * The whole navigation: five sections, one visible at a time.
 *
 * This is the ARIA tabs pattern rather than a row of buttons that toggles `display`,
 * because the app has one job that runs in the background — a session in progress — and a
 * visitor switching sections must be able to come back to the section that is moving
 * without losing their place. `aria-selected` plus roving tabindex is what tells a screen
 * reader which panel the arrow keys are moving inside.
 */
export function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  label,
  trailing,
}: {
  tabs: TabDef<T>[]
  active: T
  onChange: (next: T) => void
  label: string
  /** A control that belongs in the bar but is not a section, such as the quota chip. */
  trailing?: ReactNode
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  // Focus follows the selection only when the selection moved by keyboard. A click already
  // focuses its own button, and on first paint nothing should steal focus from the page.
  const byKeyboard = useRef(false)

  useEffect(() => {
    if (!byKeyboard.current) return
    byKeyboard.current = false
    buttons.current[tabs.findIndex((tab) => tab.id === active)]?.focus()
  }, [active, tabs])

  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active)
    const last = tabs.length - 1
    let next: number
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else return
    event.preventDefault()
    byKeyboard.current = true
    onChange(tabs[next].id)
  }

  return (
    <div className="ag-tabbar">
      <div className="ag-tablist" role="tablist" aria-label={label} onKeyDown={move}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              buttons.current[index] = node
            }}
            type="button"
            role="tab"
            id={`ag-tab-${tab.id}`}
            aria-controls={`ag-panel-${tab.id}`}
            aria-selected={tab.id === active}
            tabIndex={tab.id === active ? 0 : -1}
            className="ag-tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.live ? <span className="ag-live" aria-hidden="true" /> : null}
            <span className="ag-tab-name">{tab.label}</span>
            {tab.badge ? <span className="ag-count">{tab.badge}</span> : null}
          </button>
        ))}
      </div>
      {trailing}
    </div>
  )
}

/**
 * One section's body.
 *
 * Inactive panels stay mounted and are hidden rather than unmounted, so a session that is
 * running keeps accumulating its rounds while the visitor reads the archive. `hidden`
 * removes them from the accessibility tree and from sequential focus, which is what
 * `aria-labelledby` alone would not do.
 */
export function TabPanel({
  id,
  active,
  children,
}: {
  id: string
  active: boolean
  children: ReactNode
}) {
  return (
    <div role="tabpanel" id={`ag-panel-${id}`} aria-labelledby={`ag-tab-${id}`} hidden={!active} className="ag-tabpanel">
      {children}
    </div>
  )
}
