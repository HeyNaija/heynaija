import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// The games homepage for a member the `games` flag is on for (docs/adr/0028). The
// flag is on in development, as in CI; games-dark.spec.ts covers it switched off.

test('a member finds Games in the sidebar: a grid of games, each with its own leaderboard, competitions and posts', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'game_player')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Games', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/games')

  await expect(page.getByRole('heading', { level: 1, name: 'Games' })).toBeVisible()
  const cards = page.getByRole('list').filter({ has: page.getByRole('heading', { name: 'Chess' }) }).getByRole('listitem')
  await expect(cards).toHaveCount(2)
  const chess = cards.filter({ has: page.getByRole('heading', { name: 'Chess' }) })
  await expect(chess.getByText('Beta')).toBeVisible()
  await expect(chess.getByRole('link', { name: 'Play Chess' })).toHaveAttribute('href', '/games/chess')
  const keno = cards.filter({ has: page.getByRole('heading', { name: 'Keno' }) })
  await expect(keno.getByText('Beta')).toBeVisible()
  await expect(keno.getByRole('link', { name: 'Play Keno' })).toHaveAttribute('href', '/games/keno')
  // A new member has no score.
  await expect(page.getByText('No Game Score yet')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

  // Each game's page has its own tabs. The standings, competitions and posts are real, so other tests may have filled them.
  await chess.getByRole('link', { name: 'Play Chess' }).click()
  await page.waitForURL((url) => url.pathname === '/games/chess')
  const tabs = page.getByRole('navigation', { name: 'Chess' })
  await expect(tabs.getByRole('link', { name: 'Play' })).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: 'Leaderboard' }).click()
  await expect(page.getByRole('heading', { name: /^Chess · / })).toBeVisible()
  await tabs.getByRole('link', { name: 'Competitions' }).click()
  await expect(page.getByRole('link', { name: 'All competitions' })).toBeVisible()
  await tabs.getByRole('link', { name: 'Posts' }).click()
  await expect(page.getByRole('heading', { name: 'Chess posts' })).toBeVisible()
  await page.goto('/games/keno?tab=leaderboard')
  await expect(page.getByRole('heading', { name: /^Keno · / })).toBeVisible()

  // Mobile first: nothing scrolls sideways on a 320px phone.
  await page.setViewportSize({ width: 320, height: 640 })
  for (const path of ['/games', '/games/chess', '/games/keno?tab=competitions']) {
    await page.goto(path)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(0)
  }
  await context.close()
})
