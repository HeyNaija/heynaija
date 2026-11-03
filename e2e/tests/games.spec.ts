import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// The games homepage for a member the `games` flag is on for (docs/adr/0018). The
// flag is on in development, as in CI; games-dark.spec.ts covers it switched off.

test('a member finds Games in the sidebar, with both games coming soon and no invented numbers', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'game_player')
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
  await context.close()
})
