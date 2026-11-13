import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// Keno, free to play (docs/adr/0028, phase 4). Playing needs nothing special. Seeing
// a draw needs the API drawing often: CI starts it with KENO_DRAW_EVERY_MS=30000 and
// sets E2E_KENO_DRAW_MS to match. Against a dev API drawing every five minutes:
//
//   KENO_DRAW_EVERY_MS=30000 pnpm dev:api
//   E2E_KENO_DRAW_MS=30000 pnpm e2e keno

const drawMs = Number(process.env.E2E_KENO_DRAW_MS ?? 0)

test('a member picks numbers, plays a ticket with a free token, and cannot pick more than 10', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'keno_ada')
  await page.goto('/games')
  await page.getByRole('link', { name: 'Play Keno' }).click()
  await page.waitForURL((url) => url.pathname === '/games/keno')
  await expect(page.getByRole('heading', { name: 'No money, ever' })).toBeVisible()
  await expect(page.getByText('20 of 20 tokens left today')).toBeVisible()
  await expect(page.getByText(/Next draw in \d+:\d\d/)).toBeVisible()

  const picker = page.getByRole('group', { name: 'Pick 1 to 10 numbers' })
  for (const n of [3, 17, 42]) await picker.getByRole('button', { name: String(n), exact: true }).click()
  await expect(picker.getByRole('button', { name: '17', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('3 of 10 picked')).toBeVisible()
  await page.getByRole('button', { name: 'Play 3 numbers · 1 token' }).click()
  await expect(page.getByText(/Ticket played for Round #\d+/)).toBeVisible()
  await expect(page.getByText('19 of 20 tokens left today')).toBeVisible()
  await expect(page.getByText('3 numbers, waiting for the draw')).toBeVisible()

  // Quick pick fills five; ten is the most, and the rest of the keys stop.
  await page.getByRole('button', { name: 'Quick pick' }).click()
  await expect(page.getByText('5 of 10 picked')).toBeVisible()
  await page.getByRole('button', { name: 'Clear' }).click()
  for (let n = 1; n <= 10; n++) await picker.getByRole('button', { name: String(n), exact: true }).click()
  await expect(picker.getByRole('button', { name: '11', exact: true })).toBeDisabled()

  // The fairness page for the round shows its hash, and keeps the seed back until the draw.
  const round = (await page.getByRole('heading', { level: 2, name: /^Round #\d+$/ }).textContent())!.slice(7)
  await page.goto(`/games/keno/rounds/${round}`)
  await expect(page.getByText('The seed is revealed after the draw.')).toBeVisible()

  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/games/keno')
  await expect(page.getByRole('group', { name: 'Pick 1 to 10 numbers' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await context.close()
})

test('the draw comes out, the ticket is scored, and the round checks out as fair', async ({ browser }) => {
  test.skip(!drawMs, 'needs the API drawing often; see the comment at the top of this file')
  test.setTimeout(3 * drawMs + 60_000)
  const { page, context } = await newMember(browser, 'keno_bayo')
  await page.goto('/games/keno')
  const picker = page.getByRole('group', { name: 'Pick 1 to 10 numbers' })
  for (let n = 1; n <= 10; n++) await picker.getByRole('button', { name: String(n), exact: true }).click()
  await page.getByRole('button', { name: 'Play 10 numbers · 1 token' }).click()
  const played = (await page.getByText(/Ticket played for Round #\d+/).textContent())!.match(/#(\d+)/)![1]!

  // The page asks for the draw by itself when the countdown ends.
  await expect(page.getByRole('heading', { name: `Last draw: Round #${played}` })).toBeVisible({ timeout: 2 * drawMs + 20_000 })
  await expect(page.locator('.keno-tickets').getByText(/Matched \d+ of 10: \d+ points?/)).toBeVisible()
  await expect(page.getByRole('list', { name: `The 20 numbers drawn in Round ${played}` }).getByRole('listitem')).toHaveCount(20)

  await page.getByRole('link', { name: 'Check this draw was fair' }).click()
  await page.waitForURL((url) => url.pathname === `/games/keno/rounds/${played}`)
  await page.getByRole('button', { name: 'Check this round' }).click()
  await expect(page.getByText('Matches: the seed gives the published hash')).toBeVisible()

  await page.goto('/games/keno/tickets')
  await expect(page.getByText(/Matched \d+ of 10/)).toBeVisible()
  await page.goto('/games/keno/leaderboard')
  await page.waitForURL((url) => url.pathname === '/games/keno' && url.searchParams.get('tab') === 'leaderboard')
  await expect(page.getByRole('heading', { name: /^Keno · / })).toBeVisible()
  await context.close()
})
