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

/** Clicks a square on the board, as a player would (the board takes a click on the piece, then on where it goes). */
async function clickSquare(page: Page, square: string, orientation: 'white' | 'black') {
  const board = page.locator('.chess-board cg-board')
  // On a short window the bottom ranks are below the fold. The board hears about a scroll on the next frame.
  await board.scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))))
  const box = (await board.boundingBox())!
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1]) - 1
  const col = orientation === 'white' ? file : 7 - file
  const row = orientation === 'white' ? 7 - rank : rank
  await page.mouse.click(box.x + (col + 0.5) * (box.width / 8), box.y + (row + 0.5) * (box.height / 8))
}

async function move(page: Page, from: string, to: string, orientation: 'white' | 'black') {
  // The board's code arrives a moment after the page; wait for its pieces.
  await expect(page.locator('.chess-board cg-board piece').first()).toBeVisible()
  await clickSquare(page, from, orientation)
  await clickSquare(page, to, orientation)
}

test('two members connect, play a game watched by a third, and The Arbiter posts the result in Chess Arena', async ({ browser }) => {
  const ada = await newMember(browser, 'chess_ada')
  const bayo = await newMember(browser, 'chess_bayo')
  const chi = await newMember(browser, 'chess_chi')

  // Saying no on Lichess connects nothing, and says so.
  await ada.page.goto('/games/chess')
  await ada.page.getByRole('button', { name: 'Connect Lichess' }).click()
  await ada.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(ada.page.getByText('you said no on Lichess')).toBeVisible()

  await connect(ada.page, ada.handle)
  await expect(ada.page.locator('.chess-ratings')).toContainText('Rapid1620')
  await connect(bayo.page, bayo.handle)

  // Ada challenges Bayo from his profile, playing white, with a public thread (ticked by default).
  await ada.page.goto(`/u/${bayo.handle}`)
  await expect(ada.page.getByText(`Lichess ${bayo.handle}`)).toBeVisible()
  await ada.page.getByRole('link', { name: '· Challenge to chess' }).click()
  await expect(ada.page.getByLabel('Who')).toHaveValue(bayo.handle)
  await ada.page.getByLabel('Time').selectOption('10+5')
  await ada.page.getByLabel('You play').selectOption('white')
  await expect(ada.page.getByLabel('Open a public thread in Chess Arena', { exact: false })).toBeChecked()
  await ada.page.getByRole('button', { name: 'Send challenge' }).click()
  await expect(ada.page.getByText(`Challenge sent to @${bayo.handle}`)).toBeVisible()

  // Bayo is told, sees the game will get a thread, accepts, and lands on the game.
  await bayo.page.goto('/notifications')
  await bayo.page.getByRole('link').filter({ hasText: 'challenged you to a rated Rapid game (10+5)' }).click()
  await expect(bayo.page.getByText('This game will get a public thread in Chess Arena.')).toBeVisible()
  await bayo.page.getByRole('button', { name: 'Accept' }).click()
  await bayo.page.waitForURL(/\/games\/chess\/games\/[0-9a-f]{8}$/)
  const gameUrl = new URL(bayo.page.url()).pathname
  await expect(bayo.page.getByText(`Waiting for @${ada.handle}`)).toBeVisible()

  // Ada is told the game has started, and plays.
  await ada.page.goto('/notifications')
  await ada.page.getByRole('link').filter({ hasText: 'accepted your challenge. Your game has started.' }).click()
  await ada.page.waitForURL((url) => url.pathname === gameUrl)
  await expect(ada.page.getByText('Your move')).toBeVisible()
  await move(ada.page, 'e2', 'e4', 'white')
  // Each move reaches the other player by itself.
  await expect(bayo.page.getByRole('list', { name: 'Moves' })).toContainText('1. e4')
  await expect(bayo.page.getByText('Your move')).toBeVisible()
  await move(bayo.page, 'e7', 'e5', 'black')
  await expect(ada.page.getByRole('list', { name: 'Moves' })).toContainText('1. e4 e5')

  // Chi finds the game being played, watches, and talks about it in Chess Arena.
  await chi.page.goto(`/u/${ada.handle}`)
  await expect(chi.page.getByRole('link', { name: '· Playing now: watch' })).toBeVisible()
  await chi.page.goto('/games/chess')
  await chi.page.getByRole('link').filter({ hasText: 'Watch' }).first().click()
  await chi.page.waitForURL((url) => url.pathname === gameUrl)
  await expect(chi.page.getByRole('list', { name: 'Moves' })).toContainText('1. e4 e5')
  await expect(chi.page.getByRole('button', { name: 'Resign' })).toHaveCount(0)
  await chi.page.getByRole('link', { name: 'The thread in Chess Arena' }).click()
  await expect(chi.page.getByText('Automated').first()).toBeVisible()
  const threadUrl = chi.page.url()
  await chi.page.getByRole('textbox').first().fill('Watch the d-pawn, Ada')
  await chi.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(chi.page.getByText('Watch the d-pawn, Ada')).toBeVisible()

  // While the game is on, Ada (a player) does not see it.
  await ada.page.goto(threadUrl)
  // The Arbiter names the players without an @, so nobody is pinged.
  await expect(ada.page.getByText(`${ada.handle} (white) vs ${bayo.handle} (black)`, { exact: false }).first()).toBeVisible()
  await expect(ada.page.getByText('Watch the d-pawn, Ada')).toHaveCount(0)

  // Bayo resigns; the result shows, and the thread opens up to the players.
  await bayo.page.goto(gameUrl)
  bayo.page.once('dialog', (dialog) => dialog.accept())
  await bayo.page.getByRole('button', { name: 'Resign' }).click()
  await expect(bayo.page.locator('.chess-status')).toHaveText(`@${ada.handle} won by resignation`)
  // And it is said for screen readers.
  await expect(bayo.page.locator('[aria-live="polite"]').filter({ hasText: 'won by resignation' })).toHaveCount(1)
  await ada.page.goto(threadUrl)
  await expect(ada.page.getByText('Watch the d-pawn, Ada')).toBeVisible()
  await expect(ada.page.getByText(`${ada.handle} won by resignation after`, { exact: false })).toBeVisible()

  // Disconnecting gives the key back.
  await ada.page.goto('/games/chess')
  ada.page.once('dialog', (dialog) => dialog.accept())
  await ada.page.getByRole('button', { name: 'Disconnect' }).click()
  await expect(ada.page.getByText('Your Lichess account is disconnected.')).toBeVisible()

  for (const m of [ada, bayo, chi]) await m.context.close()
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
