import { expect, test } from '@playwright/test'
import { setFounder } from '../lib/cli.ts'
import { newMember, post } from '../lib/members.ts'

test('a founder’s gold badge shows on their profile, posts, notifications and in search, until it is taken away', async ({ browser }) => {
  const founder = await newMember(browser, 'builder')
  const reader = await newMember(browser, 'reader')
  const founderText = `An update from ${founder.handle}`
  const readerText = `A question from ${reader.handle}`
  await post(founder.page, founderText)
  await post(reader.page, readerText)
  setFounder(founder.handle)

  // On the profile it is a link to the idea behind HeyNaija, and explains itself on focus.
  const page = reader.page
  await page.goto(`/u/${founder.handle}`)
  const badge = page.getByRole('heading', { level: 1 }).getByRole('link', { name: 'Founder' })
  await expect(badge).toHaveAttribute('href', '/about#about-origin')
  await badge.focus()
  const tip = page.getByRole('main').getByRole('tooltip').first()
  await expect(tip).toBeVisible()
  await expect(tip).toHaveText('Founder. One of the people who founded HeyNaija. Their posts are their own views, not decisions by HeyNaija.')
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()

  // On their posts, and only theirs; hovering it names it.
  await page.goto('/?feed=latest')
  const founderPost = page.locator('article', { hasText: founderText })
  await founderPost.getByRole('link', { name: 'Founder' }).hover()
  await expect(founderPost.getByRole('tooltip')).toBeVisible()
  await expect(founderPost.getByRole('tooltip')).toContainText('Founder.')
  await expect(page.locator('article', { hasText: readerText })).toBeVisible()
  await expect(page.locator('article', { hasText: readerText }).locator('.founder-badge-mark')).toHaveCount(0)

  // In a notification about something they did, and in search, where the row is already a link.
  await founder.page.goto(`/u/${reader.handle}`)
  await founder.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(founder.page.getByRole('main').getByRole('button', { name: 'Following' })).toBeVisible()
  await page.goto('/notifications')
  await expect(page.getByRole('main').locator('.notification-header', { hasText: 'followed you' }).locator('.founder-badge-mark')).toHaveText('(Founder)')
  await page.goto(`/search?q=${founder.handle}`)
  const result = page.getByRole('link', { name: new RegExp(`@${founder.handle}`) })
  await expect(result.locator('.founder-badge-mark')).toHaveText('(Founder)')

  // Taken away, it goes everywhere at once.
  setFounder(founder.handle, false)
  await page.goto(`/u/${founder.handle}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('main').locator('.founder-badge-mark')).toHaveCount(0)

  await founder.context.close()
  await reader.context.close()
})
