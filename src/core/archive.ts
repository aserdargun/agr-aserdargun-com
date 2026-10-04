import type { Locale, SessionRecord } from './types'

const KEY = 'agora.sessions.v1'

const available = (): boolean => typeof window !== 'undefined' && 'localStorage' in window

export const loadSessions = (): SessionRecord[] => {
  if (!available()) return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is SessionRecord => Boolean(entry) && typeof entry === 'object')
  } catch {
    return []
  }
}

export const saveSession = (record: SessionRecord): SessionRecord[] => {
  const next = [record, ...loadSessions()].slice(0, 50)
  if (available()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // A full or blocked storage must not lose the session already on screen.
    }
  }
  return next
}

export const clearSessions = (): void => {
  if (available()) window.localStorage.removeItem(KEY)
}

const API_KEY_STORE = 'agora.key.v1'

/**
 * The key is kept in local storage so a refresh does not force a retype. It is sent to
 * openrouter.ai and nowhere else: there is no Agora server, so there is nowhere else it
 * could go. This is stated in the interface rather than assumed.
 */
export const loadKey = (): string => (available() ? (window.localStorage.getItem(API_KEY_STORE) ?? '') : '')
export const storeKey = (value: string): void => {
  if (available()) window.localStorage.setItem(API_KEY_STORE, value)
}
export const forgetKey = (): void => {
  if (available()) window.localStorage.removeItem(API_KEY_STORE)
}

export const localeFromSearch = (search: string): Locale => (new URLSearchParams(search).get('lang') === 'tr' ? 'tr' : 'en')
