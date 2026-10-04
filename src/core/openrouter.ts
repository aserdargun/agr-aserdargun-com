import type { Quota } from './types'

const BASE = 'https://openrouter.ai/api/v1'

const REFERER = 'https://agr.aserdargun.com/'
const TITLE = 'Agora'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
  /** Request token log-probabilities. Only honoured by members that advertise logprobs. */
  logprobs?: boolean
  /** Ask the provider for a JSON object. Only honoured by members that advertise it. */
  json?: boolean
}

export interface StreamResult {
  text: string
  /** Mean token log-probability across the answer, or null when unavailable. */
  meanLogprob: number | null
  /** Set when the provider failed after the response had already started. */
  midStreamError: string | null
}

export class AgoraApiError extends Error {
  readonly status: number
  readonly retryAfter: number | null

  constructor(status: number, message: string, retryAfter: number | null = null) {
    super(message)
    this.name = 'AgoraApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

const headers = (key?: string): Record<string, string> => {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': REFERER,
    'X-OpenRouter-Title': TITLE,
  }
  if (key) base.Authorization = `Bearer ${key}`
  return base
}

const retryAfterOf = (response: Response): number | null => {
  const raw = response.headers.get('Retry-After')
  if (!raw) return null
  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds : null
}

const messageOf = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload: unknown = await response.json()
    const error = (payload as { error?: { message?: unknown; metadata?: { remedy_hint?: unknown } } })?.error
    const text = typeof error?.message === 'string' ? error.message : null
    const hint = typeof error?.metadata?.remedy_hint === 'string' ? error.metadata.remedy_hint : null
    if (text && hint) return `${text} ${hint}`
    if (text) return text
  } catch {
    // Body was not JSON; fall through to the generic message.
  }
  return fallback
}

/** The free-model catalogue is public: no key, and no quota is spent reading it. */
export const fetchCatalog = async (signal?: AbortSignal): Promise<unknown> => {
  const response = await fetch(`${BASE}/models`, { headers: headers(), signal })
  if (!response.ok) {
    throw new AgoraApiError(response.status, await messageOf(response, 'The model catalogue could not be read.'))
  }
  return response.json()
}

/** The catalogue is external, so a counter is trusted as a number only after checking. */
const toCount = (value: number | string | undefined): number => {
  const numeric = typeof value === 'string' ? Number(value) : (value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

/** Reads the visitor's own free-model quota for the current UTC day. */
export const fetchQuota = async (key: string, signal?: AbortSignal): Promise<Quota> => {
  const response = await fetch(`${BASE}/key`, { headers: headers(key), signal })
  if (!response.ok) {
    throw new AgoraApiError(response.status, await messageOf(response, 'The API key could not be verified.'))
  }
  const payload = (await response.json()) as {
    data?: {
      free_model_daily_requests?: { used?: number | string; limit?: number | string; remaining?: number | string }
    }
  }
  const daily = payload.data?.free_model_daily_requests
  if (!daily) {
    throw new AgoraApiError(200, 'This key reports no free-model daily quota.')
  }
  return {
    used: toCount(daily.used),
    limit: toCount(daily.limit),
    remaining: toCount(daily.remaining),
  }
}

interface StreamChunk {
  choices?: {
    delta?: { content?: string }
    finish_reason?: string | null
    logprobs?: { content?: { logprob?: number }[] } | null
    error?: { message?: string } | null
  }[]
}

const meanOf = (values: number[]): number | null => {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return null
  return finite.reduce((total, value) => total + value, 0) / finite.length
}

/**
 * Stream one answer.
 *
 * OpenRouter sends a mid-stream rate limit as an SSE event with `finish_reason: "error"`
 * because the 200 status has already been written. Treating that as a normal completion
 * would silently store a truncated position, so it is surfaced as `midStreamError`.
 */
export const streamChat = async (
  key: string,
  model: string,
  messages: ChatMessage[],
  options: StreamOptions = {},
): Promise<StreamResult> => {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: options.temperature ?? 0.7,
  }
  if (options.maxTokens) body.max_tokens = options.maxTokens
  if (options.logprobs) body.logprobs = true
  if (options.json) body.response_format = { type: 'json_object' }

  const response = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    throw new AgoraApiError(
      response.status,
      await messageOf(response, 'The panel member could not be reached.'),
      retryAfterOf(response),
    )
  }
  if (!response.body) {
    throw new AgoraApiError(200, 'The response carried no body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let logprobs: number[] = []
  let midStreamError: string | null = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n')
    while (boundary !== -1) {
      const line = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 1)
      boundary = buffer.indexOf('\n')

      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let chunk: StreamChunk
      try {
        chunk = JSON.parse(payload) as StreamChunk
      } catch {
        continue
      }

      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.error?.message) midStreamError = choice.error.message
      if (choice.finish_reason === 'error' && !midStreamError) midStreamError = 'The stream ended with an error.'
      if (typeof choice.delta?.content === 'string') text += choice.delta.content
      for (const entry of choice.logprobs?.content ?? []) {
        if (typeof entry.logprob === 'number') logprobs.push(entry.logprob)
      }
    }
  }

  return { text, meanLogprob: meanOf(logprobs), midStreamError }
}
