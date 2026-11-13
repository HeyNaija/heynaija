import { expect, type Page, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { createCommunity } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// A community's Lichess team and its tournaments (docs/adr/0028, phase 6), against
// the stand-in in lib/fake-lichess.ts. Like chess.spec.ts it needs the API pointed
// at the stand-in, so it runs only with E2E_LICHESS set; and the API started with
// CHESS_STANDINGS_EVERY_MS short (CI uses 10 seconds) so standings arrive quickly:
//
//   node --experimental-strip-types e2e/lib/fake-lichess.ts &
//   LICHESS_URL=http://127.0.0.1:8790 CHESS_STANDINGS_EVERY_MS=10000 pnpm dev:api
//   E2E_LICHESS=1 pnpm e2e chess-teams
test.skip(!process.env.E2E_LICHESS, 'needs the API pointed at the fake Lichess; see the comment at the top of this file')

const LICHESS = process.env.E2E_LICHESS_URL ?? 'http://127.0.0.1:8790'

/** Tells the stand-in something only a test can: a team and its leader, or how a tournament went. */
async function lichessSays(path: string, body: unknown) {
  const res = await fetch(`${LICHESS}/_test/${path}`, { method: 'POST', body: JSON.stringify(body) })
  expect(res.ok).toBe(true)
}

/** Says yes on the stand-in's consent page as `username`. */
async function authorize(page: Page, username: string) {
  await page.getByLabel('Lichess username').fill(username)
  await page.getByRole('button', { name: 'Authorize' }).click()
}

/** A Lagos datetime-local value this many minutes from now. */
const lagosIn = (minutes: number) => new Date(Date.now() + minutes * 60_000 + 3_600_000).toISOString().slice(0, 16)

test('a community moderator links the Lichess team and makes an Arena; members who play show in the standings and the result is posted in the community', async ({ browser }) => {
  test.setTimeout(180_000)
  const slug = `e2e-chess-${Date.now().toString(36)}`
  await createCommunity(slug, 'E2E Chess Club')
  const mo = await newMember(browser, 'teams_mo')
  const ada = await newMember(browser, 'teams_ada')
  grantModerator(mo.handle, slug)
  const teamId = `${slug}-team`
  await lichessSays('team', { id: teamId, name: 'E2E Chess Team', leader: mo.handle })

  // Ada joins the community and connects Lichess.
  await ada.page.goto(`/c/${slug}`)
  const header = ada.page.locator('.community-header')
  await header.getByRole('button', { name: 'Join' }).click()
  await expect(header.getByRole('button', { name: 'Joined' })).toBeVisible()
  await ada.page.goto('/games/chess')
  await ada.page.getByRole('button', { name: 'Connect Lichess' }).click()
  await authorize(ada.page, ada.handle)
  await expect(ada.page.getByText('Your Lichess account is connected.')).toBeVisible()

  // The moderator is offered the set-up from the community page, connects with tournament permission and comes back.
  await mo.page.goto(`/c/${slug}`)
  await mo.page.getByRole('link', { name: 'Set it up' }).click()
  await expect(mo.page.getByRole('heading', { name: 'Chess for E2E Chess Club' })).toBeVisible()
  await mo.page.goto('/games/chess')
  await mo.page.getByRole('button', { name: 'Connect Lichess' }).click()
  await authorize(mo.page, mo.handle)
  await mo.page.goto(`/games/chess/teams/${slug}`)
  await mo.page.getByLabel('Link a team').fill(`https://lichess.org/team/${teamId}`)
  await mo.page.getByRole('button', { name: 'Link team' }).click()
  await expect(mo.page.getByText('The Lichess team is linked to this community.')).toBeVisible()
  await mo.page.getByRole('button', { name: 'Allow tournaments on Lichess' }).click()
  await expect(mo.page.getByText('tournament:write')).toBeVisible()
  await authorize(mo.page, mo.handle)
  await mo.page.waitForURL((url) => url.pathname === `/games/chess/teams/${slug}`)
  await expect(mo.page.getByText('HeyNaija may make tournaments for you')).toBeVisible()

  // An Arena, starting in a quarter of an hour.
  await mo.page.getByRole('textbox', { name: /^Name/ }).fill('E2E Blitz')
  await mo.page.getByLabel('Starts (Lagos time)').fill(lagosIn(15))
  await mo.page.getByRole('button', { name: 'Make the tournament on Lichess' }).click()
  await mo.page.waitForURL(/\/games\/competitions\/[0-9a-f-]{36}$/)
  const competition = mo.page.url()
  await expect(mo.page.getByRole('heading', { name: 'E2E Blitz' })).toBeVisible()
  await expect(mo.page.getByText('Chess · Arena')).toBeVisible()
  const href = await mo.page.getByRole('link', { name: 'Join on Lichess' }).getAttribute('href')
  const tournamentId = /\/tournament\/([^/]+)$/.exec(href ?? '')?.[1]
  expect(tournamentId).toBeTruthy()

  // Ada sees where to play, and no Enter button: tournaments are joined on Lichess.
  await ada.page.goto(competition)
  await expect(ada.page.getByRole('link', { name: 'Join on Lichess' })).toBeVisible()
  await expect(ada.page.getByRole('link', { name: 'Join the team' })).toBeVisible()
  await expect(ada.page.getByRole('button', { name: 'Enter' })).toHaveCount(0)
  await expect(ada.page.getByRole('button', { name: 'Cancel tournament' })).toHaveCount(0)

  // It is played and finished on Lichess; HeyNaija reads it (the start is moved to now, as if the time had come).
  const { pool } = await import('../lib/db.ts')
  const db = pool()
  try {
    await db.query(`update games.competitions set starts_at = now() - interval '1 minute' where lichess_tournament_id = $1`, [tournamentId])
  } finally {
    await db.end()
  }
  await lichessSays(`tournament/${tournamentId}`, {
    status: 'finished',
    results: [
      { rank: 1, username: 'SomeoneElse', score: 12 },
      { rank: 2, username: ada.handle, score: 9 },
    ],
  })
  await expect(async () => {
    await ada.page.goto(competition)
    await expect(ada.page.getByRole('heading', { name: 'Final standings' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 90_000, intervals: [3000] })
  const row = ada.page.locator('.keno-board-row', { hasText: '(you)' })
  await expect(row).toContainText('#2 on Lichess')
  await expect(row).toContainText('9 pts')

  await ada.page.getByRole('link', { name: 'The Arbiter’s result post' }).click()
  await expect(ada.page.getByText('E2E Blitz is over. The results for HeyNaija members:')).toBeVisible()
  await ada.page.goto(`/c/${slug}`)
  await expect(ada.page.getByText('E2E Blitz is over.')).toBeVisible()
})
