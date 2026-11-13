import { expect, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { createCommunity } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// Community announcements (docs/adr/0029).

/** A community only this test knows about. */
async function newCommunity(label: string) {
  const slug = `e2e-${label}-${Date.now().toString(36)}`
  const name = `E2E ${label} ${slug.slice(-6)}`
  await createCommunity(slug, name)
  return { slug, name }
}

async function join(page: import('@playwright/test').Page, slug: string) {
  await page.goto(`/c/${slug}`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(main.getByRole('button', { name: 'Joined' })).toBeVisible()
}

test('a moderator notifies every member of a community once a day, and a member can turn that off', async ({ browser }) => {
  const { slug, name } = await newCommunity('announce')
  const mod = await newMember(browser, 'amod')
  const member = await newMember(browser, 'amember')
  const quiet = await newMember(browser, 'aquiet')
  grantModerator(mod.handle, slug)
  await join(member.page, slug)
  await join(quiet.page, slug)

  // An ordinary member is not offered it.
  const membersBox = member.page.getByRole('textbox', { name: 'New post' })
  await membersBox.click()
  await membersBox.fill('just a member')
  await expect(member.page.getByRole('button', { name: /Notify all members/ })).toHaveCount(0)

  // One member turns this community's announcements off with the bell beside Joined.
  const bell = quiet.page.getByRole('button', { name: /^Announcements from this community are on/ })
  await expect(bell).toHaveAttribute('aria-pressed', 'true')
  await bell.click()
  await expect(quiet.page.getByRole('button', { name: /^Announcements from this community are off/ })).toHaveAttribute('aria-pressed', 'false')

  // The moderator writes a post, turns the switch on, and the button says what it will do.
  await mod.page.goto(`/c/${slug}`)
  const text = `Meet-up this Saturday, says ${mod.handle}`
  const box = mod.page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await box.fill(text)
  const notify = mod.page.getByRole('button', { name: 'Notify all members' })
  await expect(notify).toHaveAttribute('aria-pressed', 'false')
  await notify.click()
  await expect(mod.page.getByRole('button', { name: 'Notifying all members' })).toHaveAttribute('aria-pressed', 'true')
  await expect(mod.page.locator('form#compose')).toContainText('Every member of this community will be notified.')
  await mod.page.getByRole('button', { name: 'Post and notify', exact: true }).click()
  await expect(mod.page.locator('article', { hasText: text }).first()).toBeVisible()

  // The member is told, and the notification opens the post.
  await member.page.goto('/notifications')
  const row = member.page.locator('.notification-row', { hasText: `@${mod.handle} posted an announcement in ${name}` })
  await expect(row).toBeVisible()
  await expect(row).toContainText(text)
  await row.click()
  // The address ends with the post's own anchor (#post-…), so only the path is matched.
  await member.page.waitForURL((url) => /^\/p\/[0-9a-f-]+$/.test(url.pathname))
  await expect(member.page.locator('article', { hasText: text }).first()).toBeVisible()

  // The one who turned them off is not.
  await quiet.page.goto('/notifications')
  await expect(quiet.page.locator('.notification-row', { hasText: 'posted an announcement' })).toHaveCount(0)

  // Today's has gone: the switch says so and cannot be turned on, and a post goes as an ordinary one.
  await mod.page.goto(`/c/${slug}`)
  const again = mod.page.getByRole('textbox', { name: 'New post' })
  await again.click()
  await again.fill(`A second post, from ${mod.handle}`)
  await expect(mod.page.getByRole('button', { name: /^Members notified today/ })).toBeDisabled()
  await mod.page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(mod.page.locator('article', { hasText: `A second post, from ${mod.handle}` }).first()).toBeVisible()
  await member.page.goto('/notifications')
  await expect(member.page.locator('.notification-row', { hasText: 'posted an announcement' })).toHaveCount(1)
})
