import { expect, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { newMember } from '../lib/members.ts'

// Games for anyone the `games` flag is off for (docs/adr/0018, docs/feature-flags.md).
// The flag is on in development, as in CI, so a site moderator keeps it to one
// member for the length of this file, and puts it back after. /games must then look
// exactly like a URL that does not exist to everyone else, with no link to it.
test.describe.configure({ mode: 'serial' })

test('signed out, /games is the same not-found page as any missing URL', async ({ page }) => {
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

test('a member the games flag is off for gets the not-found page, a 404 from the API and no Games link', async ({ browser }) => {
  const admin = await newMember(browser, 'game_admin')
  grantModerator(admin.handle)
  const flag = (body: object) => admin.page.request.put('/api/v1/admin/flags/games', { data: body })
  const { page, context } = await newMember(browser, 'game_out')
  // The flag is read through the same API process the admin writes through, so the change is seen at once.
  expect((await flag({ enabled: null, handles: [admin.handle] })).ok()).toBe(true)
  try {
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
    // The member on the list still has it.
    expect((await admin.page.request.get('/api/v1/games')).status()).toBe(200)
  } finally {
    expect((await flag({ enabled: null, handles: [] })).ok()).toBe(true)
    await context.close()
    await admin.context.close()
  }
})
