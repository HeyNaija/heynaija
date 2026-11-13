import { expect, type Page, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { newMember } from '../lib/members.ts'

// Games competitions, the Game Score and the scoring explainer (docs/adr/0028, phase 5).
// Seeing a competition finish needs Keno drawing often (see keno.spec.ts): CI starts the
// API with KENO_DRAW_EVERY_MS=30000 and sets E2E_KENO_DRAW_MS to match.

const drawMs = Number(process.env.E2E_KENO_DRAW_MS ?? 0)

/** A datetime-local value in Lagos time (UTC+1), `minutes` from now. */
const lagos = (minutes: number) => new Date(Date.now() + 3_600_000 + minutes * 60_000).toISOString().slice(0, 16)

async function create(page: Page, name: string, endsInMinutes: number) {
  await page.goto('/games/competitions/new')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Entry opens (Lagos time)').fill(lagos(-1))
  await page.getByLabel('Starts (Lagos time)').fill(lagos(-1))
  await page.getByLabel('Entry closes (Lagos time)').fill(lagos(endsInMinutes - 1))
  await page.getByLabel('Ends (Lagos time)').fill(lagos(endsInMinutes))
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.waitForURL(/\/games\/competitions\/[0-9a-f-]{36}$/)
  return page.url()
}

test('a moderator runs a Keno competition; a member enters it; the explainer and leaderboards show the rules', async ({ browser }) => {
  const mod = await newMember(browser, 'comp_mod')
  grantModerator(mod.handle)
  const player = await newMember(browser, 'comp_ada')

  // Only site moderators can make one: to anyone else the page does not exist.
  await player.page.goto('/games/competitions/new')
  await expect(player.page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()

  await mod.page.goto('/mod')
  await expect(mod.page.getByRole('link', { name: 'New competition' })).toBeVisible()
  const url = await create(mod.page, 'E2E Keno Cup', 60 * 24)
  await expect(mod.page.getByRole('heading', { level: 1, name: 'E2E Keno Cup' })).toBeVisible()
  await expect(mod.page.getByText('Live', { exact: true })).toBeVisible()

  await player.page.goto('/games/competitions')
  await player.page.getByRole('link', { name: 'E2E Keno Cup' }).first().click()
  await player.page.waitForURL(url)
  await player.page.getByRole('button', { name: 'Enter' }).click()
  await expect(player.page.getByText('You’re in.')).toBeVisible()
  await expect(player.page.locator('.keno-board-row', { hasText: '(you)' })).toContainText('not played yet')
  await expect(player.page.getByRole('button', { name: 'Cancel competition' })).toHaveCount(0)

  await player.page.goto('/games/scoring')
  await expect(player.page.getByRole('heading', { name: 'Game Score XP' })).toBeVisible()
  await expect(player.page.getByRole('row', { name: /A win, on top/ })).toContainText('+10 XP')
  await player.page.goto('/games/leaderboard?board=keno&period=all')
  await expect(player.page.getByRole('heading', { name: /^Keno · All time/ })).toBeVisible()

  // The moderator calls it off.
  await mod.page.goto(url)
  mod.page.once('dialog', (d) => d.accept())
  await mod.page.getByRole('button', { name: 'Cancel competition' }).click()
  await expect(mod.page.getByText('Cancelled', { exact: true })).toBeVisible()

  await player.page.setViewportSize({ width: 320, height: 640 })
  for (const path of ['/games', '/games/leaderboard', '/games/scoring', url]) {
    await player.page.goto(path)
    expect(await player.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0)
  }
  for (const m of [mod, player]) await m.context.close()
})

test('a competition finishes: places, Game Score XP, and The Arbiter’s result in Game Night', async ({ browser }) => {
  test.skip(!drawMs, 'needs the API drawing Keno often; see the comment at the top of this file')
  test.setTimeout(7 * 60_000)
  const mod = await newMember(browser, 'comp_mod2')
  grantModerator(mod.handle)
  const player = await newMember(browser, 'comp_bayo')
  const url = await create(mod.page, 'E2E Sprint', 3)

  await player.page.goto(url)
  await player.page.getByRole('button', { name: 'Enter' }).click()
  await player.page.goto('/games/keno')
  const picker = player.page.getByRole('group', { name: 'Pick 1 to 10 numbers' })
  for (let n = 1; n <= 10; n++) await picker.getByRole('button', { name: String(n), exact: true }).click()
  await player.page.getByRole('button', { name: 'Play 10 numbers · 1 token' }).click()
  await expect(player.page.getByText(/Ticket played for Round #\d+/)).toBeVisible()

  // Within a minute or so of the end the competition finishes.
  await expect(async () => {
    await player.page.goto(url)
    await expect(player.page.getByRole('heading', { name: 'Final standings' })).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 6 * 60_000, intervals: [10_000] })
  await expect(player.page.locator('.keno-board-row', { hasText: '(you)' }).locator('.keno-rank')).toHaveText('1')

  await player.page.getByRole('link', { name: 'The Arbiter’s result post' }).click()
  await expect(player.page.getByText('E2E Sprint is over. The results:')).toBeVisible()
  await expect(player.page.getByText('Game Night').first()).toBeVisible()

  await player.page.goto('/games')
  await expect(player.page.getByText(/#\d+ this season/)).toBeVisible()
  for (const m of [mod, player]) await m.context.close()
})
