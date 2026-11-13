import { expect, type Page, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

const notifications = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'Notifications', exact: true }) })
const highlightsBox = (page: Page) => notifications(page).getByLabel('Send me weekly highlights')
const emailBox = (page: Page) => notifications(page).getByLabel('Email me my notifications')

// What is chosen and who is sent it are covered against a real database by the
// API's tests (apps/api/src/highlights): the weekly run is only open for a day a
// week, so a browser test cannot wait for it.

test('weekly highlights are on for a new member, and turn off and on in Settings without touching email', async ({ browser }) => {
  const member = await newMember(browser, 'highlights')
  await member.page.goto('/settings')
  const section = notifications(member.page)

  await expect(highlightsBox(member.page)).toBeChecked()
  await expect(section).toContainText('at most once a week and only when you have not opened HeyNaija for a few days')
  await expect(section.getByRole('link', { name: 'How they are chosen' })).toHaveAttribute('href', '/about/highlights')

  await highlightsBox(member.page).uncheck()
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(section.getByRole('status')).toHaveText('Saved.')
  await expect(highlightsBox(member.page)).not.toBeChecked()
  await expect(emailBox(member.page)).toBeChecked()
  await expect(section.getByLabel('Someone replies to your post')).toBeChecked()

  // The choice is kept, and can be made again.
  await member.page.reload()
  await expect(highlightsBox(member.page)).not.toBeChecked()
  await highlightsBox(member.page).check()
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(section.getByRole('status')).toHaveText('Saved.')
  await member.page.reload()
  await expect(highlightsBox(member.page)).toBeChecked()

  await member.context.close()
})

test('the rules are published with the numbers the API applies, to anyone', async ({ browser }) => {
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await visitor.newPage()
  const rules = await (await page.request.get('/api/v1/highlights/rules')).json()
  expect(rules.live, 'the weeklyHighlights flag is on in development').toBe(true)

  await page.goto('/about/highlights')
  const main = page.getByRole('main')
  await expect(page.getByRole('heading', { level: 1, name: 'How weekly highlights work' })).toBeVisible()
  await expect(main).toContainText(`Only if you have not opened HeyNaija for ${rules.awayDays} days`)
  await expect(main).toContainText(`Only if at least ${rules.minPosts} conversations are worth sending`)
  await expect(main).toContainText(`you are sent at most ${rules.maxPosts}`)
  await expect(main).toContainText('Never both, and if you have neither on, nothing is sent')
  await expect(main).toContainText('nothing that tells us you opened it or what you tapped')
  // Live, so the page does not say they are yet to come.
  await expect(main).not.toContainText('not being sent yet')
  // Discover's page leads here, and this one back.
  await page.goto('/about/discover')
  await page.getByRole('link', { name: 'How weekly highlights work' }).click()
  await expect(page).toHaveURL(/\/about\/highlights$/)
  await expect(page.getByRole('link', { name: 'How Discover works' })).toBeVisible()

  // No sideways scroll on a small phone.
  await page.setViewportSize({ width: 320, height: 640 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  await visitor.close()
})

test('a highlights link that is not ours changes nothing and says so; a notification-email link is not a highlights link', async ({ browser, request }) => {
  const member = await newMember(browser, 'hlink')
  const stranger = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await stranger.newPage()

  await page.goto('/api/v1/highlights/unsubscribe/00000000-0000-4000-8000-000000000000.AAAA')
  await expect(page).toHaveURL(/\/email-off\?what=highlights&link=invalid$/)
  await expect(page.getByRole('heading', { name: 'That link did not work' })).toBeVisible()
  await expect(page.getByText('Sign in and open Settings to turn weekly highlights off yourself.')).toBeVisible()

  // A mail program's one-click POST with a forged link is refused.
  const forged = await request.post('/api/v1/highlights/unsubscribe/00000000-0000-4000-8000-000000000000.AAAA')
  expect(forged.status()).toBe(400)

  await member.page.goto('/settings')
  await expect(highlightsBox(member.page)).toBeChecked()

  await stranger.close()
  await member.context.close()
})
