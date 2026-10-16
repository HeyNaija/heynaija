import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

test('a repost reaches the reposter’s followers and profile; a quote embeds the post until it is deleted', async ({ browser }) => {
  const author = await newMember(browser, 'orig')
  const sharer = await newMember(browser, 'sharer')
  const reader = await newMember(browser, 'reader')

  // The reader follows the sharer, not the author.
  await reader.page.goto(`/u/${sharer.handle}`)
  await reader.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(reader.page.getByRole('main').getByRole('button', { name: 'Following' })).toBeVisible()

  const text = `Worth passing on, from ${author.handle}`
  await post(author.page, text)

  // Repost from Latest: the control changes at once and stays changed after a reload.
  await sharer.page.goto('/')
  const card = sharer.page.locator('article', { hasText: text })
  await card.getByLabel('Repost or quote (0 reposts)').click()
  await card.getByRole('button', { name: 'Repost', exact: true }).click()
  await expect(card.getByLabel('Reposted. Undo or quote (1 repost)')).toBeVisible()
  await sharer.page.reload()
  await expect(sharer.page.locator('article', { hasText: text }).getByLabel('Reposted. Undo or quote (1 repost)')).toBeVisible()

  // It reaches the sharer's followers, saying who reposted it, and the sharer's profile.
  await reader.page.goto('/?feed=following')
  const reposted = reader.page.locator('article', { hasText: text })
  await expect(reposted).toContainText(`@${sharer.handle} reposted`)
  await expect(reposted).toContainText(`@${author.handle}`)
  await reader.page.goto(`/u/${sharer.handle}`)
  await expect(reader.page.locator('article', { hasText: text })).toContainText(`@${sharer.handle} reposted`)
  await sharer.page.goto(`/u/${sharer.handle}`)
  await expect(sharer.page.locator('article', { hasText: text })).toContainText('You reposted')

  // Quote it: the composer shows the post being quoted, and posting opens the quote.
  await sharer.page.goto('/')
  await sharer.page.locator('article', { hasText: text }).getByLabel(/^Reposted\. Undo or quote/).click()
  await sharer.page.locator('article', { hasText: text }).getByRole('link', { name: 'Quote' }).click()
  await sharer.page.waitForURL(/\/p\/[^/]+\/quote/)
  await expect(sharer.page.locator('#compose .quoted-post')).toContainText(text)
  const take = `Read this, from ${sharer.handle}`
  const box = sharer.page.getByRole('textbox', { name: 'New post' })
  await expect(box).toBeFocused()
  await box.fill(take)
  await sharer.page.getByRole('button', { name: 'Post', exact: true }).click()
  await sharer.page.waitForURL(/\/p\/[0-9a-f-]+$/)
  const quotePath = new URL(sharer.page.url()).pathname
  const quote = sharer.page.locator('article', { hasText: take })
  await expect(quote.locator('.quoted-post')).toContainText(text)
  await expect(quote.locator('.quoted-post')).toContainText(`@${author.handle}`)

  // The author hears about both.
  await author.page.goto('/notifications')
  await expect(author.page.getByText(`@${sharer.handle} reposted your post`)).toBeVisible()
  await expect(author.page.getByText(`@${sharer.handle} quoted your post`)).toBeVisible()

  // Deleting the original takes the repost away and leaves a placeholder in the quote.
  await author.page.goto(`/u/${author.handle}`)
  author.page.once('dialog', (dialog) => dialog.accept())
  const original = author.page.locator('article', { hasText: text })
  await original.getByLabel('Post options').click()
  await original.getByRole('button', { name: 'Delete post' }).click()
  await expect(author.page.locator('article', { hasText: text })).toHaveCount(0)

  await reader.page.goto('/?feed=following')
  await expect(reader.page.locator('article', { hasText: take })).toContainText('This post is no longer available.')
  await expect(reader.page.locator('article', { hasText: `@${sharer.handle} reposted` })).toHaveCount(0)
  await sharer.page.goto(quotePath)
  await expect(sharer.page.locator('article', { hasText: take })).toContainText('This post is no longer available.')
  await expect(sharer.page.locator('article', { hasText: take })).not.toContainText(text)

  await author.context.close()
  await sharer.context.close()
  await reader.context.close()
})
