import { expect, test } from '@playwright/test'
import { newMember, post, replyBox } from '../lib/members.ts'

test('a member who turns off like notifications is not told of likes, and still hears of replies', async ({ browser }) => {
  const author = await newMember(browser, 'quiet')
  const fan = await newMember(browser, 'fan')

  const text = `Tell me about replies only, says ${author.handle}`
  const card = await post(author.page, text)
  await card.getByText(text).click({ position: { x: 4, y: 4 } })
  await author.page.waitForURL(/\/p\/[0-9a-f-]+$/)
  const postPath = new URL(author.page.url()).pathname
  const postId = postPath.split('/').pop()!

  // Every kind starts on. Untick likes and save; moderation notices are not offered.
  await author.page.goto('/settings')
  const section = author.page.locator('section', { has: author.page.getByRole('heading', { name: 'Notifications', exact: true }) })
  const labels = [
    'Someone replies to your post',
    'Someone mentions you',
    'Someone likes your post',
    'Someone reposts your post',
    'Someone quotes your post',
    'Someone follows you',
  ]
  for (const label of labels) await expect(section.getByLabel(label)).toBeChecked()
  // The kinds, and the box that says whether they are also emailed (on for a new member).
  await expect(section.getByRole('checkbox')).toHaveCount(labels.length + 1)
  await expect(section.getByLabel('Email me my notifications')).toBeChecked()
  await expect(section).toContainText('Safety and moderation notices')
  await section.getByLabel('Someone likes your post').uncheck()
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(section.getByRole('status')).toHaveText('Saved.')
  // The boxes show what was saved, so saving again would not undo it.
  await expect(section.getByLabel('Someone likes your post')).not.toBeChecked()
  await expect(section.getByLabel('Someone replies to your post')).toBeChecked()

  // The choice is kept.
  await author.page.reload()
  await expect(section.getByLabel('Someone likes your post')).not.toBeChecked()
  await expect(section.getByLabel('Someone replies to your post')).toBeChecked()

  // Another member likes the post (and the like is saved), then replies to it.
  await fan.page.goto(postPath)
  const focused = fan.page.locator('article', { hasText: text }).first()
  await focused.getByRole('button', { name: /^Like \(0 likes\)$/ }).click()
  await expect(focused.getByRole('button', { name: /^Unlike \(1 like\)$/ })).toHaveAttribute('aria-pressed', 'true')
  await fan.page.reload()
  await expect(fan.page.locator('article', { hasText: text }).first().getByRole('button', { name: /^Unlike \(1 like\)$/ })).toBeVisible()
  const answer = `Replying all the same, from ${fan.handle}`
  await (await replyBox(fan.page, postId)).fill(answer)
  await fan.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(fan.page.locator('article', { hasText: answer })).toBeVisible()

  // One unread notification, the reply; nothing about the like.
  await author.page.goto('/')
  await expect(author.page.getByText('1 unread', { exact: true }).first()).toBeAttached()
  await author.page.goto('/notifications')
  await expect(author.page.getByText(`@${fan.handle} replied to your post`)).toBeVisible()
  await expect(author.page.getByText(`@${fan.handle} liked your post`)).toHaveCount(0)
  await expect(author.page.locator('.notification-row')).toHaveCount(1)

  await author.context.close()
  await fan.context.close()
})
