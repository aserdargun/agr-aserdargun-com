import { expect, test } from '@playwright/test'

/**
 * The OpenRouter endpoints are stubbed so acceptance never spends real quota and never
 * fails because a free model rotated overnight. The stub mirrors the real shapes:
 * a public catalogue, a quota counter that moves, and a streamed answer that carries a
 * mid-stream error exactly the way OpenRouter reports one.
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
      id: 'nvidia/nemotron-3.5-content-safety:free',
      name: 'Content Safety',
      context_length: 128000,
      supported_parameters: ['max_tokens'],
      architecture: { output_modalities: ['text'] },
      top_provider: { max_completion_tokens: 8192, is_moderated: false },
    },
  ],
}

const streamAnswer = (text: string): string =>
  text
    .split('')
    .map((character) => `data: ${JSON.stringify({ choices: [{ delta: { content: character }, finish_reason: null }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n'

test.beforeEach(async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/models', (route) =>
    route.fulfill({ json: catalogue }),
  )
  await page.route('https://openrouter.ai/api/v1/key', (route) =>
    route.fulfill({ json: { data: { free_model_daily_requests: { used: 8, limit: 50, remaining: 42 } } } }),
  )
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { messages: { content: string }[] }
    const onFloor = body.messages.some((message) => message.content.includes('first-round positions'))
    const answer = onFloor
      ? '{"position":"oppose","reason":"I now think the premise is unproven.","confidence":45}'
      : '{"position":"support","reason":"The proposition is testable.","confidence":70}'
    await route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: streamAnswer(answer),
    })
  })
})

test('seats only models that can hold a position, and says why the rest are off', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'This week’s roster' })).toBeVisible()
  await expect(page.getByText('nemotron-3-super-120b-a12b')).toBeVisible()
  await expect(page.getByText('Left off the panel')).toBeVisible()
  await expect(page.getByText('content-safety classifier', { exact: false })).toBeVisible()
})

test('reads the visitor’s own quota and states what a session costs', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Your OpenRouter key').fill('sk-or-v1-test')
  await page.getByRole('button', { name: 'Save and check quota' }).click()

  await expect(page.getByText('42')).toBeVisible()
  await expect(page.getByText('requests left')).toBeVisible()
  await expect(page.getByText('This run costs')).toBeVisible()
})

test('runs both rounds and reports the count without calling it correct', async ({ page }) => {
  await page.goto('/?seats=2')

  await page.getByLabel('Your OpenRouter key').fill('sk-or-v1-test')
  await page.getByRole('button', { name: 'Save and check quota' }).click()
  await page.getByLabel('Proposition').fill('The free tier is a research instrument.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  await expect(page.getByRole('heading', { name: 'The count' })).toBeVisible({ timeout: 30000 })
  // Both seats change position on the floor, so the leading count is Against.
  await expect(page.getByText('Against').first()).toBeVisible()
  await expect(page.getByText(/not a verified correct answer/i)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dissent, kept visible' })).toBeVisible()
})

test('marks a prose answer as non-compliant instead of hiding it', async ({ page }) => {
  await page.route('https://openrouter.ai/api/v1/chat/completions', (route) =>
    route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: streamAnswer('Position: abstain. I cannot judge this without more context.'),
    }),
  )

  await page.goto('/?seats=2')
  await page.getByLabel('Your OpenRouter key').fill('sk-or-v1-test')
  await page.getByRole('button', { name: 'Save and check quota' }).click()
  await page.getByLabel('Proposition').fill('Anything.')
  await page.getByRole('button', { name: 'Convene the panel' }).click()

  await expect(page.getByText('answered in prose').first()).toBeVisible({ timeout: 30000 })
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
