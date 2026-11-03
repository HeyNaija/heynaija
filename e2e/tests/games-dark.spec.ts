import { type APIRequestContext, expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// Games for anyone who may not use them (docs/adr/0018). In CI the switch is off;
// locally it may be on with a short list. Either way these members are not on it,
// and /games must look exactly like a URL that does not exist, with no link to it.

/** Asked with no session, the API answers 401 while Games is on (it wants a member) and 404 while it is off. */
const gamesOn = async (request: APIRequestContext) => (await request.get('/api/v1/games')).status() === 401

test('a member who may not use Games gets the normal not-found page and no Games link', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'game_out')
  for (const path of ['/games', '/games/chess']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  }
  expect((await page.request.get('/api/v1/games')).status()).toBe(404)
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Games', exact: true })).toHaveCount(0)
  await page.getByLabel('Account menu').click()
  await expect(page.getByRole('link', { name: 'Governance' }).last()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Games', exact: true })).toHaveCount(0)
  await context.close()
})

test('a signed-out visitor gets the same not-found page as for any missing URL', async ({ page }) => {
  const missing = await page.goto('/no-such-page-at-all')
  expect(missing?.status()).toBe(404)
  const notFound = await page.locator('body').innerText()
  for (const path of ['/games', '/games/keno']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
    expect(await page.locator('body').innerText(), path).toBe(notFound)
  }
})

test('with Games off, the API answers like a route that does not exist', async ({ request }) => {
  test.skip(await gamesOn(request), 'Games is on here')
  const res = await request.get('/api/v1/games')
  expect(res.status()).toBe(404)
  expect(await res.json()).toEqual({ message: 'Cannot GET /v1/games', error: 'Not Found', statusCode: 404 })
})
