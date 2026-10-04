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

/**
 * Open a section.
 *
 * The app is tabbed, and a session opens on its own outcome when it finishes. A test that
 * wants the transcript has to ask for it, the same way a visitor would.
 */
const useTab = async (page: import('@playwright/test').Page, name: string) => {
  await page.getByRole('tab', { name }).click()
}

test.beforeEach(async ({ page }) => {
  await stubOpenRouter(page)
})

test('seats only models that can hold a position, and says why the rest are off', async ({ page }) => {
  await page.goto('/')
  await useTab(page, 'Roster')

  await expect(page.getByRole('heading', { name: 'This week’s roster' })).toBeVisible()
  // Scoped to the roster: a seated model is also named in the setup, before any run.
  await expect(page.locator('.ag-roster').getByText('nemotron-3-super-120b-a12b')).toBeVisible()
  await expect(page.getByText('Left off the panel')).toBeVisible()
  await expect(page.getByText('content-safety classifier', { exact: false })).toBeVisible()
})

test('shows which models the chosen seat count will call, before anything is spent', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)

  // The roster and the seat count are the same decision, so the seated panel is shown with
  // the setup rather than only after a session has already been paid for.
  const seated = page.locator('.ag-seated-list li')
  await expect(seated).toHaveCount(3)
  await expect(seated.first()).toContainText('nemotron-3-super-120b-a12b')
  await expect(page.getByRole('tab', { name: 'Outcome' })).toHaveAttribute('aria-selected', 'false')
})

test('quotes a cost range instead of a single number, because the final round is conditional', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)

  await expect(page.locator('.ag-quota-chip').getByText('42')).toBeVisible()
  await expect(page.getByText('requests left')).toBeVisible()
  // Scoped to the run row: the seat choices each carry their own cost, and 6–9 appears in
  // both places once three seats are selected.
  const run = page.locator('.ag-runrow')
  await expect(run.getByText('This run costs')).toBeVisible()
  await expect(run.getByText('6–9')).toBeVisible()
})

test('runs three rounds and shows who answered whom', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('Static types are worth their cost in a small codebase.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()
  await useTab(page, 'Transcript')

  await expect(page.getByRole('heading', { name: 'First round · every seat answers alone' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('heading', { name: 'Second round · seats answer each other' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Final round · the dissenters answer once more' })).toBeVisible()

  // Seat C named Seat A, and the link points at that seat's turn.
  const link = page.locator('a[href="#turn-A"]').first()
  await expect(link).toHaveText('A')
})

test('opens the outcome when the session ends, and keeps the argument one click away', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('Static types are worth their cost in a small codebase.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  // The count is what the session was run for, so the finished session lands on it rather
  // than leaving a visitor to hunt for it below a full transcript.
  await expect(page.getByRole('tab', { name: 'Outcome' })).toHaveAttribute('aria-selected', 'true', { timeout: 30000 })
  await expect(page.getByRole('heading', { name: 'The outcome, in one paragraph' })).toBeVisible()
  // Scoped to the summary: the archive restates the same sentence for every filed session.
  await expect(page.locator('.ag-summary').getByText('The panel leaned toward supporting the proposition')).toBeVisible()

  await useTab(page, 'Transcript')
  await expect(page.getByRole('heading', { name: 'Second round · seats answer each other' })).toBeVisible()
})

test('reports convergence on a declared bar, and names the seat that held', async ({ page }) => {
  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('Static types are worth their cost in a small codebase.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()
  await useTab(page, 'Outcome')

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
  await useTab(page, 'Transcript')

  await expect(page.getByRole('heading', { name: 'The panel proposes' })).toBeVisible({ timeout: 30000 })
  // Scope to the agenda card: once the session runs, the chosen proposition also appears
  // in the archive and the session list, so an unscoped locator would be ambiguous.
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
  await useTab(page, 'Transcript')

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
  await useTab(page, 'Outcome')

  await expect(page.getByRole('heading', { name: 'Archive this session' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByText('does not prove its own cost')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download the record' })).toHaveCount(0)
})

test('files a session that proved its cost, and keeps it on screen when the archive is away', async ({ page }) => {
  // Every other stub leaves the daily counter where it was, so no session can prove what
  // it cost and the archive card refuses them all. Here it moves, which is the one thing a
  // record needs in order to be archivable.
  let calls = 0
  await page.route('https://openrouter.ai/api/v1/key', (route) => {
    calls += 1
    const used = calls === 1 ? 8 : 20
    return route.fulfill({ json: { data: { free_model_daily_requests: { used, limit: 50, remaining: 50 - used } } } })
  })

  await page.goto('/?seats=3')
  await openWithKey(page)
  await page.getByLabel('Proposition').fill('The shared record should outlive the browser that made it.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()
  await useTab(page, 'Outcome')

  const card = page.locator('.ag-card').filter({ hasText: 'Archive this session' })
  const file = card.getByRole('button', { name: 'File it in the shared archive' })
  await expect(card.getByRole('button', { name: 'Download the record' })).toBeVisible({ timeout: 30000 })
  await expect(file).toBeVisible()

  // The shared record is read from the archive rather than baked in, and a static preview
  // has no /api route. That is stated instead of being shown as an empty history.
  await useTab(page, 'Archive')
  await expect(page.getByText('The shared archive could not be read')).toBeVisible()

  // Filing goes through the site's own /api route, so on a static host it is unreachable.
  // The session is already saved and already on screen: the archive is an addition, never
  // a gate, and the failure is reported as a state rather than thrown.
  await useTab(page, 'Outcome')
  await file.click()
  await expect(card.getByText('The archive could not be reached')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The count' })).toBeVisible()
})

test('switches to Turkish and keeps the honesty statement', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Türkçe' }).click()
  await useTab(page, 'Kadro')

  await expect(page.getByRole('heading', { name: 'Bu haftanın kadrosu' })).toBeVisible()
  await expect(page.getByText('Panelin dışında')).toBeVisible()
})

test('works on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await useTab(page, 'Roster')

  await expect(page.getByRole('heading', { name: 'This week’s roster' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Türkçe' })).toBeVisible()
})
