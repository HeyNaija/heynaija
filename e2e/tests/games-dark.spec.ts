import { expect, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { newMember } from '../lib/members.ts'

// Games for anyone the `games` flag is off for (docs/adr/0028, docs/feature-flags.md),
// and for anyone signed out. The flag is on in development, as in CI, so a site
// moderator keeps it to one member for the length of this file, and puts it back
// after. As for every link (docs/deployment/app-links.md), nobody is shown "page not
// found": someone signed out is asked to sign in and comes back to the same address,
// and a member Games is not open to is told so. There is still no link to it for them.
test.describe.configure({ mode: 'serial' })

test('signed out, a Games address asks to sign in, then comes back to it', async ({ page }) => {
  for (const path of ['/games', '/games/keno', '/games/chess?tab=leaderboard']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Sign in to play' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Nothing here' })).toHaveCount(0)
    const signIn = await page.getByRole('link', { name: 'Sign in', exact: true }).getAttribute('href')
    const back = new URL(new URL(signIn ?? '', page.url()).searchParams.get('return_to') ?? '')
    expect(`${back.pathname}${back.search}`, path).toBe(path)
    // The address stays the one in the link.
    expect(new URL(page.url()).pathname).toBe(path.split('?')[0])
  }
  // What WhatsApp or X shows for a link to any Games page: what Games is, nothing about the page.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Games on HeyNaija')
})

test('a member the games flag is off for is told it is not open to them, with a 404 from the API and no Games link', async ({ browser }) => {
  const admin = await newMember(browser, 'game_admin')
  grantModerator(admin.handle)
  const flag = (body: object) => admin.page.request.put('/api/v1/admin/flags/games', { data: body })
  const { page, context } = await newMember(browser, 'game_out')
  // The flag is read through the same API process the admin writes through, so the change is seen at once.
  expect((await flag({ enabled: null, handles: [admin.handle] })).ok()).toBe(true)
  try {
    for (const path of ['/games', '/games/chess']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: 'Games is not open to you yet' })).toBeVisible()
      await expect(page.getByText('Some members are trying it out first.')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Nothing here' })).toHaveCount(0)
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
