import { expect, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { newMember, post } from '../lib/members.ts'

test('a reported post is removed by a moderator and its author is told', async ({ browser }) => {
  const author = await newMember(browser, 'offender')
  const reporter = await newMember(browser, 'report')
  const moderator = await newMember(browser, 'mod')
  grantModerator(moderator.handle)

  const text = `Buy followers cheap, from ${author.handle}`
  await post(author.page, text)

  // Report it.
  await reporter.page.goto('/')
  const article = reporter.page.locator('article', { hasText: text })
  await article.getByLabel('Post options').click()
  await article.getByRole('link', { name: 'Report post' }).click()
  await reporter.page.getByLabel('Spam').check()
  await reporter.page.getByRole('button', { name: 'Send report' }).click()
  await expect(reporter.page.getByRole('button', { name: 'Send report' })).toHaveCount(0)

  // The moderator finds it in the queue and removes the post.
  await moderator.page.goto('/mod')
  const item = moderator.page.locator('form', { hasText: text })
  await expect(item).toContainText(`reported by @${reporter.handle}`)
  await item.getByRole('button', { name: 'Remove post' }).click()
  await expect(moderator.page.locator('form', { hasText: text })).toHaveCount(0)

  // The post has left the feed, and its author has a notification saying why.
  await author.page.goto('/')
  await expect(author.page.locator('article', { hasText: text })).toHaveCount(0)
  await author.page.goto('/notifications')
  await expect(author.page.getByText('A moderator removed your post for spam')).toBeVisible()

  await Promise.all([author, reporter, moderator].map((m) => m.context.close()))
})

test('a suspended member appeals and the moderator sees the appeal', async ({ browser }) => {
  const author = await newMember(browser, 'suspect')
  const reporter = await newMember(browser, 'witness')
  const moderator = await newMember(browser, 'judge')
  grantModerator(moderator.handle)

  const text = `Harassing post from ${author.handle}`
  await post(author.page, text)

  await reporter.page.goto('/')
  const article = reporter.page.locator('article', { hasText: text })
  await article.getByLabel('Post options').click()
  await article.getByRole('link', { name: 'Report post' }).click()
  await reporter.page.getByLabel('Harassment or bullying').check()
  await reporter.page.getByRole('button', { name: 'Send report' }).click()

  await moderator.page.goto('/mod')
  moderator.page.once('dialog', (dialog) => dialog.accept())
  await moderator.page.locator('form', { hasText: text }).getByRole('button', { name: 'Suspend account' }).click()
  await expect(moderator.page.locator('form', { hasText: text })).toHaveCount(0)

  // The author now sees the suspension, and appeals.
  await author.page.goto('/')
  await expect(author.page.getByRole('heading', { name: 'Your account is suspended' })).toBeVisible()
  const reason = `I was quoting someone else, not attacking anyone. ${author.handle}`
  await author.page.getByLabel('Why should this be looked at again?').fill(reason)
  await author.page.getByRole('button', { name: 'Send appeal' }).click()
  await expect(author.page.getByText('Your appeal has been sent. A moderator will review it.')).toBeVisible()

  // The appeal reaches the queue, with the member's words, ready to reinstate.
  await moderator.page.goto('/mod')
  const appeal = moderator.page.locator('form', { hasText: reason })
  await expect(appeal).toContainText(`from @${author.handle}`)
  await appeal.getByRole('button', { name: 'Reinstate account' }).click()
  await expect(moderator.page.locator('form', { hasText: reason })).toHaveCount(0)

  await author.page.goto('/')
  await expect(author.page.getByRole('textbox', { name: 'New post' })).toBeVisible()

  await Promise.all([author, reporter, moderator].map((m) => m.context.close()))
})
