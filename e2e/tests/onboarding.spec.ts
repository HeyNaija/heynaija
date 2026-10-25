import { expect, type Page, test } from '@playwright/test'
import { expectNoHorizontalScroll } from '../lib/layout.ts'
import { handleFor, newMember, post, signIn, signUpOverHttp } from '../lib/members.ts'

/** Joins a community from its own page, as a member would. */
async function join(page: Page, slug: string) {
  await page.goto(`/c/${slug}`)
  // The rail lists communities with Join buttons too; this one is the page's own.
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(main.getByRole('button', { name: 'Joined' })).toBeVisible()
}

const onPath = (page: Page, path: string) => page.waitForURL((url) => url.pathname === path)

/**
 * Step 3 offers push notifications on this device, and leaving it goes home. Headless
 * Chromium refuses notifications, so here it says so and offers Continue; where it
 * can ask, it offers Not now (push-notifications.spec.ts turns push on from here).
 */
async function passNotifications(page: Page) {
  await page.waitForURL((url) => url.pathname === '/welcome' && url.searchParams.get('step') === 'notifications')
  await expect(page.getByRole('heading', { level: 1, name: /Stay in the loop/ })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toHaveText(/Notifications/)
  // Setup is already finished, so there is nothing left to skip.
  await expect(page.getByRole('button', { name: 'Skip setup' })).toHaveCount(0)
  await expectNoHorizontalScroll(page.locator('body'))
  await page.getByRole('link', { name: /^(Continue|Not now)$/ }).click()
}

test('a newcomer chooses communities and people, then finds their posts in Following @mobile', async ({ browser, page }) => {
  // Two members already here, each posting in a community the newcomer will choose,
  // which is how the welcome flow comes to suggest them.
  const ada = await newMember(browser, 'campus')
  const bayo = await newMember(browser, 'capital')
  await join(ada.page, 'universities')
  await post(ada.page, `Campus news from ${ada.handle}`, 'Universities')
  await join(bayo.page, 'abuja')
  await post(bayo.page, `Capital news from ${bayo.handle}`, 'Abuja')
  // Posted to everyone: these reach Following only through the follows.
  const adaText = `Hello everyone, ${ada.handle} here`
  const bayoText = `Good morning from ${bayo.handle}`
  await post(ada.page, adaText)
  await post(bayo.page, bayoText)

  const handle = handleFor('newbie')
  await signUpOverHttp(page, handle, { welcome: 'stay' })
  // Until they finish or skip, the home page sends them back here.
  await page.goto('/')
  await onPath(page, '/welcome')
  await page.setViewportSize({ width: 320, height: 720 })

  // Step 1: communities, with what each is about and how many are in it.
  await expect(page.getByRole('heading', { level: 1, name: /Find your places/ })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Setup steps' }).locator('[aria-current="step"]')).toHaveText(/Communities/)
  const universities = page.getByRole('checkbox', { name: 'Join Universities' })
  await expect(page.locator('label', { has: universities })).toContainText(/\d+ members?/)
  await expectNoHorizontalScroll(page.locator('body'))
  await universities.check()
  await page.getByRole('checkbox', { name: 'Join Abuja' }).check()
  await page.getByRole('button', { name: 'Continue' }).click()

  // Step 2: people from those communities, nothing joined yet.
  await expect(page.getByRole('heading', { level: 1, name: /Find your people/ })).toBeVisible()
  await expect(page).toHaveURL(/step=people/)
  await expect(page.getByText('Finishing also joins Abuja and Universities.')).toBeVisible()
  const adaBox = page.getByRole('checkbox', { name: new RegExp(`@${ada.handle}$`) })
  const bayoBox = page.getByRole('checkbox', { name: new RegExp(`@${bayo.handle}$`) })
  await expect(page.locator('label', { has: adaBox })).toContainText('Posts in Universities')
  await expect(page.locator('label', { has: bayoBox })).toContainText('Posts in Abuja')
  await expect(page.getByRole('checkbox', { name: new RegExp(`@${handle}$`) })).toHaveCount(0)
  await expectNoHorizontalScroll(page.locator('body'))
  await adaBox.check()
  await bayoBox.check()
  await page.getByRole('button', { name: 'Finish' }).click()

  // Step 3: notifications. Setup is finished already, so leaving here loses nothing.
  await passNotifications(page)

  // Step 4: home, on Following, with a nudge to say hello.
  await page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('feed') === 'following')
  await expect(page.getByRole('heading', { name: 'Say hello to the town square' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'New post' })).toHaveAttribute('placeholder', /Introduce yourself/)
  await expect(page.locator('article', { hasText: adaText })).toContainText(`You follow @${ada.handle}`)
  await expect(page.locator('article', { hasText: bayoText })).toContainText(`You follow @${bayo.handle}`)
  await expectNoHorizontalScroll(page.locator('body'))

  // Done: the home page no longer sends them to /welcome.
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
  await expect(page.getByRole('heading', { name: 'Say hello to the town square' })).toHaveCount(0)

  // The joins and follows behave as if made one at a time.
  await page.goto('/c')
  for (const name of ['Universities', 'Abuja']) {
    await expect(page.locator('.community-card', { hasText: name }).getByRole('button', { name: 'Joined' })).toBeVisible()
  }
  await ada.page.goto('/notifications')
  await expect(ada.page.locator('.notification-row', { hasText: `@${handle} followed you` })).toBeVisible()

  await ada.context.close()
  await bayo.context.close()
})

test('the whole welcome flow can be skipped, and is not shown again @mobile', async ({ page }) => {
  const handle = handleFor('skipper')
  const email = await signUpOverHttp(page, handle, { welcome: 'stay' })
  await page.getByRole('button', { name: 'Skip setup' }).click()

  await onPath(page, '/')
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Say hello to the town square' })).toHaveCount(0)
  // Nothing was joined, so home still points them at the communities.
  await expect(page.getByRole('link', { name: /Find a place that feels like you/ })).toBeVisible()
  await page.reload()
  expect(new URL(page.url()).pathname).toBe('/')

  // Not after signing in again, either.
  await page.getByLabel('Account menu').click()
  await page.locator('details[open]').getByRole('link', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  await signIn(page, email)
  expect((await (await page.context().request.get('/api/v1/me')).json()).onboarded).toBe(true)
})

test('each step can be skipped on its own', async ({ page }) => {
  await signUpOverHttp(page, handleFor('stepper'), { welcome: 'stay' })
  await page.getByRole('link', { name: 'Skip this step' }).click()
  await expect(page.getByRole('heading', { level: 1, name: /Find your people/ })).toBeVisible()
  await page.getByRole('button', { name: 'Skip this step' }).click()
  await passNotifications(page)

  await page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('feed') === 'following')
  await expect(page.getByRole('heading', { name: 'Say hello to the town square' })).toBeVisible()
  // The last step's skip: the nudge goes, and so does the flow.
  await page.getByRole('link', { name: 'Not now' }).click()
  await expect(page.getByRole('heading', { name: 'Say hello to the town square' })).toHaveCount(0)
  await expect(page.getByText('Your Following feed is empty')).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
})
