import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

test('posts to everyone and the post shows in Latest', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'poster')
  const text = `Hello from ${handle}, first post`
  await post(page, text)

  // Other tests post at the same time, so it need not be first; it must be there.
  await page.reload()
  await expect(page.locator('.post-list article', { hasText: text })).toBeVisible()
  await context.close()
})

test('posts into a community it joined', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'local')
  await page.goto('/c/lagos')
  // The rail lists communities with Join buttons too; this one is the page's own.
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(main.getByRole('button', { name: 'Joined' })).toBeVisible()

  const text = `Traffic report from ${handle}`
  const article = await post(page, text, 'Lagos')
  await expect(article.getByRole('link', { name: 'Lagos' })).toBeVisible()

  await page.goto('/c/lagos')
  await expect(page.locator('article', { hasText: text })).toBeVisible()
  await context.close()
})

test('replies in a thread', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'replier')
  const article = await post(page, `Question from ${handle}`)
  await article.locator('time').click()
  await expect(page).toHaveURL(/\/p\//)

  const reply = `Answer from ${handle}`
  await page.getByRole('textbox', { name: 'Your reply' }).fill(reply)
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(page.locator('article', { hasText: reply })).toBeVisible()
  await page.reload()
  await expect(page.locator('article', { hasText: reply })).toBeVisible()
  await context.close()
})

test('a like changes at once and survives a reload', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'liker')
  const article = await post(page, `Like me, says ${handle}`)
  const like = article.getByRole('button', { name: /^Like \(0 likes\)$/ })
  await like.click()
  await expect(article.getByRole('button', { name: /^Unlike \(1 like\)$/ })).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  const again = page.locator('article', { hasText: `Like me, says ${handle}` })
  await expect(again.getByRole('button', { name: /^Unlike \(1 like\)$/ })).toBeVisible()
  await again.getByRole('button', { name: /^Unlike/ }).click()
  await expect(again.getByRole('button', { name: /^Like \(0 likes\)$/ })).toBeVisible()
  await context.close()
})

test('a bookmarked post appears under Bookmarks', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'keeper')
  const text = `Worth keeping, by ${handle}`
  const article = await post(page, text)
  await article.getByRole('button', { name: 'Bookmark', exact: true }).click()
  await expect(article.getByRole('button', { name: 'Remove bookmark' })).toBeVisible()

  await page.goto('/bookmarks')
  await expect(page.locator('article', { hasText: text })).toBeVisible()
  await context.close()
})

test('deletes its own post after confirming', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'deleter')
  const text = `Posted by mistake, ${handle}`
  const article = await post(page, text)
  page.once('dialog', (dialog) => dialog.accept())
  await article.getByLabel('Post options').click()
  await article.getByRole('button', { name: 'Delete post' }).click()
  await expect(page.locator('article', { hasText: text })).toHaveCount(0)
  await context.close()
})

test('the + button opens the composer with the keyboard ready @mobile', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'the + button is in the phone layout')
  const { page, context } = await newMember(browser, 'thumb')
  await page.goto('/')
  await page.mouse.wheel(0, 3000)
  await page.getByRole('link', { name: 'New post' }).click()
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeFocused()
  await context.close()
})
