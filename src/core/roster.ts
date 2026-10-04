import type { ExcludedEntry, Locale, Roster, RosterEntry } from './types'
import { t } from './types'

/**
 * Free models that must not be seated, with the reason stated in both languages.
 *
 * There is no generic filter that catches these. `nvidia/nemotron-3.5-content-safety:free`
 * reports `output_modalities: ["text"]` and a normal completion-token ceiling, so it
 * passes every structural check a chat model passes. It is identified by purpose, not
 * by shape, so the exclusion is an explicit id list that has to be re-reviewed whenever
 * the free catalogue rotates.
 */
const EXCLUSIONS: Record<string, ExcludedEntry['reason']> = {
  'nvidia/nemotron-3.5-content-safety:free': {
    en: 'A content-safety classifier, not a deliberating chat model. It cannot hold or defend a position, so seating it would put a non-answer into the tally.',
    tr: 'Bir içerik güvenlik sınıflandırıcısı, görüş alan bir sohbet modeli değil. Konum edinemez veya savunamaz; sandalyeye oturtmak sayıma cevapsız bir giriş koyar.',
  },
}

interface CatalogModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  supported_parameters?: unknown
  architecture?: { output_modalities?: unknown }
  top_provider?: { context_length?: unknown; max_completion_tokens?: unknown; is_moderated?: unknown }
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const hasParam = (model: CatalogModel, param: string): boolean =>
  asStringList(model.supported_parameters).includes(param)

/**
 * Turn a raw `/api/v1/models` payload into a seated panel.
 *
 * Seating requires a free variant, a text output modality, and no recorded exclusion.
 * Everything else is reported as excluded with its reason so the interface can show
 * why a free model is not on the panel.
 */
export const curateRoster = (payload: unknown, observedAt: string): Roster => {
  const models = Array.isArray((payload as { data?: unknown })?.data)
    ? ((payload as { data: unknown[] }).data as CatalogModel[])
    : []

  const members: RosterEntry[] = []
  const excluded: ExcludedEntry[] = []

  for (const model of models) {
    const id = asString(model.id)
    if (!id.endsWith(':free')) continue

    const reason = EXCLUSIONS[id]
    if (reason) {
      excluded.push({ id, reason })
      continue
    }

    const outputs = asStringList(model.architecture?.output_modalities)
    if (!outputs.includes('text')) {
      excluded.push({
        id,
        reason: {
          en: `Published output modalities are ${outputs.length ? outputs.join(', ') : 'none'}, so it cannot return a written position.`,
          tr: `Yayımlanan çıktı modaliteleri ${outputs.length ? outputs.join(', ') : 'yok'}; yazılı bir konum döndüremez.`,
        },
      })
      continue
    }

    const slug = id.replace(/:free$/, '')
    members.push({
      id,
      slug,
      provider: slug.includes('/') ? slug.split('/')[0] : slug,
      contextLength: asNumber(model.context_length, 0),
      maxCompletionTokens:
        typeof model.top_provider?.max_completion_tokens === 'number'
          ? model.top_provider.max_completion_tokens
          : null,
      isModerated: model.top_provider?.is_moderated === true,
      supports: {
        structuredOutputs: hasParam(model, 'structured_outputs'),
        responseFormat: hasParam(model, 'response_format'),
        logprobs: hasParam(model, 'logprobs'),
        tools: hasParam(model, 'tools'),
      },
    })
  }

  members.sort((a, b) => a.slug.localeCompare(b.slug))
  excluded.sort((a, b) => a.id.localeCompare(b.id))

  return { members, excluded, observedAt }
}

/**
 * Choose which members are seated.
 *
 * Selection used to be the first N entries in catalogue order, which is alphabetical and
 * therefore arbitrary: Agora was reliably seating the smallest available models because
 * their slugs happened to sort first. The rule below is declared rather than tuned, and
 * is shown in the interface so the panel is never an accident.
 *
 * A member that can return the requested shape is preferred, because a model that answers
 * in prose has to be read by guesswork. After that a larger context window is preferred,
 * since the floor round has to hold the whole exchange. Ties fall back to the slug so the
 * same roster always seats the same panel.
 */
export const selectPanelMembers = (members: RosterEntry[], seatCount: number): RosterEntry[] =>
  [...members]
    .sort((a, b) => {
      const shape = Number(b.supports.responseFormat || b.supports.structuredOutputs) - Number(a.supports.responseFormat || a.supports.structuredOutputs)
      if (shape !== 0) return shape
      if (b.contextLength !== a.contextLength) return b.contextLength - a.contextLength
      return a.slug.localeCompare(b.slug)
    })
    .slice(0, seatCount)

export const selectionRule = {
  en: 'Seats are filled by a declared rule: members that can return the requested JSON shape first, then the larger context window, then the slug. The catalogue order is alphabetical and is not used to choose.',
  tr: 'Koltuklar ilan edilmiş bir kuralla doldurulur: istenen JSON biçimini döndürebilen üyeler önce, sonra daha geniş bağlam penceresi, sonra slug. Katalog sırası alfabetiktir ve seçimde kullanılmaz.',
}

export const exclusionReason = (excluded: ExcludedEntry[], id: string, locale: Locale): string =>
  t(excluded.find((entry) => entry.id === id)?.reason, locale)
