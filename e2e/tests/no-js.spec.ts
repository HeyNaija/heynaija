import { expect, test } from '@playwright/test'
import { seedPosts } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// PLAN.md §0 says reading and posting work without JavaScript. They do not yet:
// pages render inside <Suspense> (Cache Components needs it for per-visitor data),
// and Next streams the content in with an inline script, so without JavaScript
// the main column stays on its loading skeleton. Found by these tests on
// 15 October 2026. Marked as expected failures until that is fixed; when they
// start passing, Playwright reports it, and the marks should come off.
test.describe('with JavaScript off', () => {
  test.fail(true, 'streamed pages never reveal their content without JavaScript')

  test('reads a feed and pages with Older posts', async ({ browser }) => {
    const { handle, context } = await newMember(browser, 'reader')
    await seedPosts(handle, 40)
    const state = await context.storageState()
    await context.close()

    const plain = await browser.newContext({ baseURL: test.info().project.use.baseURL, javaScriptEnabled: false, storageState: state })
    const page = await plain.newPage()
    await page.goto(`/u/${handle}`)
    const cards = page.getByRole('main').locator('.post-list article')
    await expect(cards).toHaveCount(30)
    await expect(cards.first()).toContainText('Seeded post 40')

    await page.getByRole('link', { name: 'Older posts' }).click()
    await expect(page).toHaveURL(/cursor=/)
    await expect(cards).toHaveCount(10)
    await expect(cards.first()).toContainText('Seeded post 10')
    await plain.close()
  })

  test('posts from the composer and likes a post', async ({ browser }) => {
    const { handle, context } = await newMember(browser, 'nojs')
    const state = await context.storageState()
    await context.close()

    const plain = await browser.newContext({ baseURL: test.info().project.use.baseURL, javaScriptEnabled: false, storageState: state })
    const page = await plain.newPage()
    await page.goto('/')
    const text = `Posted without JavaScript by ${handle}`
    await page.getByRole('textbox', { name: 'New post' }).fill(text)
    await page.getByRole('button', { name: 'Post', exact: true }).click()

    await page.goto('/')
    const article = page.locator('article', { hasText: text })
    await expect(article).toBeVisible()

    await article.getByRole('button', { name: /^Like \(0 likes\)$/ }).click()
    await page.goto('/')
    await expect(page.locator('article', { hasText: text }).getByRole('button', { name: /^Unlike \(1 like\)$/ })).toBeVisible()
    await plain.close()
  })
})
