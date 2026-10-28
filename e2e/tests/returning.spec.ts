import { expect, test } from '@playwright/test'
import { newMember, post, replyBox } from '../lib/members.ts'

test('a like, a repost and a reply made on a post’s page show on the feed after going Back', async ({ browser }) => {
  const author = await newMember(browser, 'asker')
  const reader = await newMember(browser, 'answerer')
  const text = `Worth a like, from ${author.handle}`
  await post(author.page, text)

  const { page } = reader
  await page.goto('/?feed=latest')
  const card = page.locator('.post-list article', { hasText: text })
  await expect(card.getByRole('button', { name: 'Like (0 likes)' })).toBeVisible()
  await card.locator('time').click()
  await expect(page).toHaveURL(/\/p\//)

  const focused = page.locator('article.is-focused')
  await focused.getByRole('button', { name: 'Like (0 likes)' }).click()
  await expect(focused.getByRole('button', { name: 'Unlike (1 like)' })).toBeVisible()
  await focused.getByLabel('Repost or quote (0 reposts)').click()
  await focused.getByRole('button', { name: 'Repost', exact: true }).click()
  await expect(focused.getByLabel('Reposted. Undo or quote (1 repost)')).toBeVisible()
  await (await replyBox(page)).fill(`An answer from ${reader.handle}`)
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(page.locator('article', { hasText: `An answer from ${reader.handle}` })).toBeVisible()

  // Back brings the feed from the browser's memory, as it was; it still shows what the reader did.
  await page.goBack()
  await expect(page).toHaveURL(/feed=latest/)
  await expect(card.getByRole('button', { name: 'Unlike (1 like)' })).toBeVisible()
  await expect(card.getByLabel('Reposted. Undo or quote (1 repost)')).toBeVisible()
  await expect(card.getByRole('link', { name: 'Reply (1 reply)' })).toBeVisible()

  // Taking the like back on the post's page shows on the feed too.
  await card.locator('time').click()
  await focused.getByRole('button', { name: 'Unlike (1 like)' }).click()
  await expect(focused.getByRole('button', { name: 'Like (0 likes)' })).toBeVisible()
  await page.goBack()
  await expect(card.getByRole('button', { name: 'Like (0 likes)' })).toBeVisible()

  await author.context.close()
  await reader.context.close()
})
