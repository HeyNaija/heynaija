import { expect, test } from '@playwright/test'
import { MARK } from '../lib/env.ts'
import { signUpOverHttp } from '../lib/members.ts'

// The games homepage for a member on the Games list (docs/adr/0018). Needs the API
// started with Games on for this handle, so CI (where it is off) skips it:
//
//   GAMES_ENABLED=true GAMES_MEMBERS=e2e_game_player pnpm dev:api
//   E2E_GAMES=1 pnpm e2e games
//
// The allow-list takes exact handles, hence the fixed one below.
test.skip(!process.env.E2E_GAMES, 'needs the API with GAMES_* set; see the comment at the top of this file')

const PLAYER = `${MARK.handlePrefix}game_player`

test('an allow-listed member finds Games in the sidebar, with both games coming soon and no invented numbers', async ({ page }) => {
  await signUpOverHttp(page, PLAYER)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Games', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/games')

  await expect(page.getByRole('heading', { level: 1, name: 'Games' })).toBeVisible()
  const cards = page.getByRole('list').filter({ has: page.getByRole('heading', { name: 'Chess' }) }).getByRole('listitem')
  await expect(cards).toHaveCount(2)
  for (const name of ['Chess', 'Keno']) {
    const card = cards.filter({ has: page.getByRole('heading', { name }) })
    await expect(card.getByText('Coming soon')).toBeVisible()
    await expect(card.getByRole('link', { name: `Play ${name}` })).toHaveCount(0)
  }
  for (const empty of ['No Game Score yet', 'No standings yet', 'No competitions yet', 'No game posts yet']) {
    await expect(page.getByText(empty)).toBeVisible()
  }
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

  // Mobile first: nothing scrolls sideways on a 320px phone.
  await page.setViewportSize({ width: 320, height: 640 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
})
