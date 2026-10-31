import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// The Gist routes for anyone who may not use them, which needs no LiveKit, so CI
// runs it (gists.spec.ts, the live room, does not). In CI the Gists switches are
// off; locally they may be on with a short allow-list. Either way these members
// are not on it, and every /gists URL must look like one that does not exist.

const MISSING = '/gists/00000000-0000-4000-8000-000000000000'

test('a member who may not use Gists gets the normal not-found page', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'gist_out')
  for (const path of [MISSING, '/gists/new']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  }
  await context.close()
})

test('a signed-out visitor gets the same not-found page as for any missing URL', async ({ page }) => {
  const missing = await page.goto('/no-such-page-at-all')
  expect(missing?.status()).toBe(404)
  const notFound = await page.locator('main').innerText()
  for (const path of [MISSING, '/gists/new']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
    expect(await page.locator('main').innerText(), path).toBe(notFound)
  }
})
