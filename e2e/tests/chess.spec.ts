import { expect, type Page, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// Chess on Lichess (docs/adr/0018), against the stand-in in lib/fake-lichess.ts.
// It needs the API started with LICHESS_URL pointing at that stand-in and a
// GAMES_TOKEN_KEY, which CI does; so it runs only with E2E_LICHESS set:
//
//   node --experimental-strip-types e2e/lib/fake-lichess.ts &
//   LICHESS_URL=http://127.0.0.1:8790 pnpm dev:api
//   E2E_LICHESS=1 pnpm e2e chess
test.skip(!process.env.E2E_LICHESS, 'needs the API pointed at the fake Lichess; see the comment at the top of this file')
test.describe.configure({ mode: 'serial' })

/** Connects Lichess from the chess page, saying yes on the stand-in's consent page as `username`. */
async function connect(page: Page, username: string) {
  await page.goto('/games/chess')
  await page.getByRole('button', { name: 'Connect Lichess' }).click()
  await page.getByLabel('Lichess username').fill(username)
  await page.getByRole('button', { name: 'Authorize' }).click()
  await page.waitForURL((url) => url.pathname === '/games/chess')
  await expect(page.getByText('Your Lichess account is connected.')).toBeVisible()
  await expect(page.getByText(`Connected as ${username}`)).toBeVisible()
}

test('two members connect Lichess, one challenges the other, who is notified and accepts', async ({ browser }) => {
  const ada = await newMember(browser, 'chess_ada')
  const bayo = await newMember(browser, 'chess_bayo')

  // Saying no on Lichess connects nothing, and says so.
  await ada.page.goto('/games/chess')
  await ada.page.getByRole('button', { name: 'Connect Lichess' }).click()
  await ada.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(ada.page.getByText('you said no on Lichess')).toBeVisible()

  await connect(ada.page, ada.handle)
  // Ratings are Lichess's numbers, as the stand-in gives them.
  await expect(ada.page.locator('.chess-ratings')).toContainText('Rapid1620')
  await expect(ada.page.locator('.chess-ratings')).toContainText('ClassicalNot played')
  await connect(bayo.page, bayo.handle)

  // The Chess card now says Beta and leads here.
  await ada.page.goto('/games')
  await expect(ada.page.getByRole('listitem').filter({ hasText: 'Chess' }).getByText('Beta')).toBeVisible()

  // Challenge from bayo's profile.
  await ada.page.goto(`/u/${bayo.handle}`)
  await expect(ada.page.getByText(`Lichess ${bayo.handle}`)).toBeVisible()
  await ada.page.getByRole('link', { name: '· Challenge to chess' }).click()
  await expect(ada.page.getByLabel('Who')).toHaveValue(bayo.handle)
  await ada.page.getByLabel('Time').selectOption('10+5')
  await ada.page.getByRole('button', { name: 'Send challenge' }).click()
  await expect(ada.page.getByText(`Challenge sent to @${bayo.handle}`)).toBeVisible()
  await expect(ada.page.getByRole('heading', { name: 'Waiting for an answer' })).toBeVisible()

  // Bayo is told, and the notification leads to the challenge.
  await bayo.page.goto('/notifications')
  const note = bayo.page.getByRole('link').filter({ hasText: 'challenged you to a rated Rapid game (10+5)' })
  await expect(note).toBeVisible()
  await note.click()
  await bayo.page.waitForURL((url) => url.pathname === '/games/chess')
  await bayo.page.getByRole('button', { name: 'Accept' }).click()
  await expect(bayo.page.getByText('Challenge accepted.')).toBeVisible()
  const game = bayo.page.getByRole('link', { name: 'Open on lichess.org' }).first()
  await expect(game).toHaveAttribute('href', /^http:\/\/127\.0\.0\.1:8790\/[0-9a-f]{8}$/)

  // Settled, the notification is gone and nothing is waiting.
  await bayo.page.goto('/notifications')
  await expect(bayo.page.getByText('challenged you to')).toHaveCount(0)
  await ada.page.goto('/games/chess')
  await expect(ada.page.getByRole('heading', { name: 'Waiting for an answer' })).toHaveCount(0)
  await expect(ada.page.getByRole('heading', { name: 'Recent challenges' })).toBeVisible()

  // Disconnecting gives the key back and puts the page back as it was.
  ada.page.once('dialog', (dialog) => dialog.accept())
  await ada.page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(ada.page.getByText('Your Lichess account is disconnected.')).toBeVisible()
  await expect(ada.page.getByRole('button', { name: 'Connect Lichess' })).toBeVisible()

  await ada.context.close()
  await bayo.context.close()
})

test('a member with Games but no Lichess sees how to connect, and nothing to play yet', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'chess_new')
  await page.goto('/games/chess')
  await expect(page.getByRole('button', { name: 'Connect Lichess' })).toBeVisible()
  await expect(page.getByText('No challenges waiting')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Challenge a member' })).toHaveCount(0)
  await page.setViewportSize({ width: 320, height: 640 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await context.close()
})
