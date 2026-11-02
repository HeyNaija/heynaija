import { type APIRequestContext, expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// The Gist routes for anyone who may not use them, which needs no LiveKit, so CI
// runs it (gists.spec.ts, the live room, does not). In CI the Gists switches are
// off; locally they may be on with a short allow-list. Either way these members
// are not on it, and every /gists URL must look like one that does not exist.
// Signed out, it depends on the switch: off, the same; on, a sign-in prompt at
// every Gist address, real or not (docs/adr/0017 section 4a).

const MISSING = '/gists/00000000-0000-4000-8000-000000000000'

/** A Gists route asked with no session answers 401 while Gists are on, and 404 (as a missing route) while off. */
const gistsOn = async (request: APIRequestContext) => (await request.get('/api/v1/gists/live')).status() === 401

test('a member who may not use Gists gets the normal not-found page', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'gist_out')
  for (const path of [MISSING, '/gists/new']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  }
  await context.close()
})

test('with Gists off, a signed-out visitor gets the same not-found page as for any missing URL', async ({ page, request }) => {
  test.skip(await gistsOn(request), 'Gists are on here')
  const missing = await page.goto('/no-such-page-at-all')
  expect(missing?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  const notFound = await page.locator('body').innerText()
  for (const path of [MISSING, '/gists/new']) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
    expect(await page.locator('body').innerText(), path).toBe(notFound)
  }
})

test('with Gists on, a signed-out visitor is asked to sign in and come back, and the preview names no Gist', async ({ page, request }) => {
  test.skip(!(await gistsOn(request)), 'Gists are off here, as in CI')
  const res = await page.goto(MISSING)
  expect(res?.status()).toBe(200)
  expect(new URL(page.url()).pathname).toBe(MISSING)
  await expect(page.getByRole('heading', { name: 'Sign in to join this Gist' })).toBeVisible()
  const signIn = await page.getByRole('link', { name: 'Sign in', exact: true }).getAttribute('href')
  expect(new URL(new URL(signIn ?? '', page.url()).searchParams.get('return_to') ?? '').pathname).toBe(MISSING)
  // What WhatsApp or X shows for a link to any Gist, real or not.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'A Gist on HeyNaija')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /community-conversation\.jpg$/)
  // Anything under /gists that cannot be a Gist is still a missing page.
  for (const path of ['/gists/new', '/gists/abc']) {
    expect((await page.goto(path))?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  }
})
