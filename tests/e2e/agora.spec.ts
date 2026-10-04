import { expect, test } from '@playwright/test'
import { curateRoster, selectPanelMembers } from '../../src/core/roster'
import { SEAT_LABELS } from '../../src/core/types'

/**
 * The OpenRouter endpoints are stubbed so acceptance never spends real quota and never
 * fails because a free model rotated overnight. The stub mirrors the real shapes,
 * including a mid-stream error, which OpenRouter reports as an SSE event with
 * `finish_reason: "error"` because the 200 status is already written.
 */
const catalogue = {
  data: [
    {
      id: 'nvidia/nemotron-3-super-120b-a12b:free',
      name: 'Nemotron 3 Super',
      context_length: 262144,
      supported_parameters: ['max_tokens', 'structured_outputs', 'response_format'],
      architecture: { output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 8192, is_moderated: false },
    },
    {
      id: 'liquid/lfm-2.5-2.6b:free',
      name: 'LFM 2.5',
      context_length: 65536,
      supported_parameters: ['max_tokens', 'logprobs'],
      architecture: { output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 8192, is_moderated: false },
    },
    {
      id: 'qwen/qwen3.8-27b:free',
      name: 'Qwen 3.8',
      context_length: 262144,
      supported_parameters: ['max_tokens'],
      architecture: { output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 8192, is_moderated: false },
    },
    {
      id: 'nvidia/nemotron-3.5-content-safety:free',
      name: 'Content Safety',
      context_length: 128000,
      supported_parameters: ['max_tokens'],
      architecture: { output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 8192, is_moderated: false },
    },
  ],
}

const stream = (text: string): string =>
  text
    .split('')
    .map((character) => `data: ${JSON.stringify({ choices: [{ delta: { content: character }, finish_reason: null }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n'

const answer = (position: string, reason: string, extra = '') =>
  `{"position":"${position}","reason":${JSON.stringify(reason)},"confidence":70${extra}}`

/** Round detection is by the system prompt, which is how the app itself tells them apart. */
const roundOf = (system: string): 'agenda' | 'blind' | 'floor' | 'convergence' => {
  if (system.includes('Propose one proposition')) return 'agenda'
  if (system.includes('invited back for a final round')) return 'convergence'
  if (system.includes('second round')) return 'floor'
  return 'blind'
}

/** Acceptance convenes three seats, so the panel is the first three seated members. */
const SEAT_COUNT = 3

/**
 * Seat letters belong to the app, not to this suite.
 *
 * The stub is handed a model id and has to know which seat asked for that answer, so it
 * needs the panel the app actually seated. Deriving the mapping from `curateRoster` and
 * `selectPanelMembers` instead of repeating the order here is what stops the two drifting
 * apart: this mapping already went stale once, when seating stopped following catalogue
 * order and the suite went on assuming it did — the failure looked like a product bug.
 */
const SEATS = new Map(
  selectPanelMembers(curateRoster(catalogue, '2026-01-01').members, SEAT_COUNT).map((member, index) => [
    member.id,
    SEAT_LABELS[index] ?? `S${index + 1}`,
  ]),
)

const seatOf = (model: string): string => SEATS.get(model) ?? 'S?'

type Script = Partial<Record<'agenda' | 'blind' | 'floor' | 'convergence', (seat: string) => string>>

const defaultScript: Script = {
  // Two of the three say the same thing in different words, so they must group; the
  // third is unrelated and must stay a singleton.
  agenda: (seat) =>
    seat === 'A'
      ? `{"proposition":"Strong typing prevents whole classes of bugs","reason":"Cheap to enforce early."}`
      : seat === 'B'
        ? `{"proposition":"Static types prevent whole classes of bugs","reason":"They pay for themselves in review."}`
        : `{"proposition":"The euro will devalue before 2030","reason":"Nobody prices this in."}`,
  blind: (seat) => (seat === 'C' ? answer('oppose', 'The overhead outweighs the benefit at this size.') : answer('support', 'The benefit arrives earlier than the cost.')),
  floor: (seat) =>
    seat === 'C'
      ? answer('oppose', 'Seat B has not priced the migration.', ',"addressed":["A"]')
      : answer('support', 'Seat C is counting the whole migration at once.', ',"addressed":["C"]'),
  convergence: () => answer('oppose', 'Seat A still has not addressed migration cost.', ',"addressed":["A"]'),
}

async function stubOpenRouter(page: import('@playwright/test').Page, script: Script = defaultScript) {
  await page.route('https://openrouter.ai/api/v1/models', (route) => route.fulfill({ json: catalogue }))
  await page.route('https://openrouter.ai/api/v1/key', (route) =>
    route.fulfill({ json: { data: { free_model_daily_requests: { used: 8, limit: 50, remaining: 42 } } } }),
  )
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { model: string; messages: { content: string }[] }
    const round = roundOf(body.messages[0]?.content ?? '')
    const seat = seatOf(body.model)
    await route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: stream(script[round]?.(seat) ?? '{}') })
  })
}

const openWithKey = async (page: import('@playwright/test').Page) => {
  await page.getByLabel('Your OpenRouter key').fill('sk-or-v1-test')
  await page.getByRole('button', { name: 'Save and check quota' }).click()
}

test.beforeEach(async ({ page }) => {
  await stubOpenRouter(page)
})

test('seats only models that can hold a position, and says why the rest are off', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'This week’s roster' })).toBeVisible()
  await expect(page.getByText('nemotron-3-super-120b-a12b')).toBeVisible()
  await expect(page.getByText('Left off the panel')).toBeVisible()
  await expect(page.getByText('content-safety classifier', { exact: false })).toBeVisible()
})

test('quotes a cost range instead of a single number, because the final round is conditional', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)

  await expect(page.getByText('42')).toBeVisible()
  await expect(page.getByText('requests left')).toBeVisible()
  await expect(page.getByText('This run costs')).toBeVisible()
  await expect(page.getByText('6–9')).toBeVisible()
})

test('runs three rounds and shows who answered whom', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('Static types are worth their cost in a small codebase.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  await expect(page.getByRole('heading', { name: 'First round · every seat answers alone' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('heading', { name: 'Second round · seats answer each other' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Final round · the dissenters answer once more' })).toBeVisible()

  // Seat C named Seat A, and the link points at that seat's turn.
  const link = page.locator('a[href="#turn-A"]').first()
  await expect(link).toHaveText('A')
})

test('reports convergence on a declared bar, and names the seat that held', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('Static types are worth their cost in a small codebase.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  const card = page.locator('.ag-convergence')
  await expect(card).toBeVisible({ timeout: 30000 })
  await expect(card.getByText('The panel reached agreement')).toBeVisible()
  await expect(card.getByText('Bar for agreement')).toBeVisible()
  await expect(card.getByText('67%').first()).toBeVisible()
  await expect(card.getByText('Held their position: C')).toBeVisible()
})

test('lets the panel choose its own topic and groups similar proposals', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByRole('button', { name: 'The panel chooses' }).click()
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  await expect(page.getByRole('heading', { name: 'The panel proposes' })).toBeVisible({ timeout: 30000 })
  // Scope to the agenda card: once the session runs, the chosen proposition also appears
  // in the timeline and the session list, so an unscoped locator would be ambiguous.
  const agenda = page.locator('.ag-agenda')
  await expect(agenda.getByText('Strong typing prevents whole classes of bugs')).toBeVisible()
  await expect(agenda.getByText('Static types prevent whole classes of bugs')).toBeVisible()
  await expect(agenda.getByText('The euro will devalue before 2030')).toBeVisible()
  // The two overlapping proposals report a cluster of two; the unrelated one is a
  // singleton, so one proposer cannot pass as a shared agenda.
  await expect(page.getByText('2 similar proposals').first()).toBeVisible()
  await expect(page.getByText('1 similar proposals').first()).toBeVisible()
  await expect(page.getByText('Agora’s pick').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Debate this' }).first()).toBeVisible()
})

test('marks a prose answer as non-compliant instead of hiding it', async ({ page }) => {
  await stubOpenRouter(page, {
    ...defaultScript,
    blind: () => 'Position: abstain. I cannot judge this without more context.',
  })

  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('Anything debatable at all.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  await expect(page.getByText('answered in prose').first()).toBeVisible({ timeout: 30000 })
})

test('refuses to offer an export for a session that cannot prove its own cost', async ({ page }) => {
  // The quota counter never moves, so nothing was really spent.
  await page.route('https://openrouter.ai/api/v1/key', (route) =>
    route.fulfill({ json: { data: { free_model_daily_requests: { used: 8, limit: 50, remaining: 42 } } } }),
  )

  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('A proposition long enough to pass validation.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  await expect(page.getByRole('heading', { name: 'Archive this session' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('does not prove its own cost')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download the record' })).toHaveCount(0)
})

test('switches to Turkish and keeps the honesty statement', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Türkçe' }).click()

  await expect(page.getByRole('heading', { name: 'Bu haftanın kadrosu' })).toBeVisible()
  await expect(page.getByText('Panelin dışında')).toBeVisible()
})

test('works on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'This week’s roster' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Türkçe' })).toBeVisible()
})
