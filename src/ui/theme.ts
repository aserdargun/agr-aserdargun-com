export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'ag:theme'
const THEMES: readonly string[] = ['light', 'dark']

/** The colour the browser chrome carries, so the address bar matches the page. */
const CHROME: Record<Theme, string> = { light: '#f4f2e9', dark: '#121310' }

const isTheme = (value: string | null): value is Theme => value !== null && THEMES.includes(value)

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * What the visitor chose, or null when they never touched the toggle and the
 * operating system still decides. Null is a real state rather than a fallback:
 * it is what lets the page keep following the system after a first visit, and it is
 * why the stylesheet carries its own `prefers-color-scheme` block instead of
 * depending on this module having run.
 */
export const loadTheme = (): Theme | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isTheme(raw) ? raw : null
  } catch {
    return null
  }
}

export const resolveTheme = (choice: Theme | null): Theme => choice ?? (prefersDark() ? 'dark' : 'light')

/**
 * Pin the theme, or hand the decision back to the system when `choice` is null.
 * Removing the attribute rather than writing "light" is deliberate: writing a
 * concrete value would freeze a visitor who had never chosen anything.
 */
export const applyTheme = (choice: Theme | null): void => {
  const root = document.documentElement
  if (choice) root.dataset.theme = choice
  else delete root.dataset.theme

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', CHROME[resolveTheme(choice)])
}

export const storeTheme = (theme: Theme): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // A refused write costs the visitor a preference, not the session.
  }
}
