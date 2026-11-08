import { expect, test } from '@playwright/test'
import { makeMinor } from '../lib/db.ts'
import { newMember, post } from '../lib/members.ts'

// A minor's posts are shown to signed-in members only, never to signed-out
// visitors or search engines (ADR 0020, question 7). Signed out, the post is
// missing, as a deleted one is, and nothing on the page says why; the API tests
// in apps/api/src/posts/minor-posts.test.ts try every read path.

test("a minor's post: seen by any member, missing for a signed-out visitor and kept out of search", async ({ browser }) => {
  const minor = await newMember(browser, 'teen')
  const stranger = await newMember(browser, 'stranger')
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  try {
    await makeMinor(minor.handle)
    const text = `Homework done, from ${minor.handle}`
    const article = await post(minor.page, text)
    const id = (await article.getAttribute('id'))!.replace('post-', '')

    // A member who is a stranger to them reads it on its page and their profile.
    await stranger.page.goto(`/p/${id}`)
    await expect(stranger.page.locator(`#post-${id}`).getByText(text)).toBeVisible()
    await stranger.page.goto(`/u/${minor.handle}`)
    await expect(stranger.page.getByText(text)).toBeVisible()
    await expect(stranger.page.getByText('1 post', { exact: true })).toBeVisible()

    // Signed out, its page is not found, a link to it previews as nothing, and it is kept out of search.
    const page = await visitor.newPage()
    await page.goto(`/p/${id}`)
    await expect(page.getByText('That page does not exist')).toBeVisible()
    await expect(page.getByText(text)).toHaveCount(0)
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached()
    // The site's own description, never the post's words or its author.
    for (const meta of await page.locator('meta[property^="og:"], meta[name="description"]').all()) {
      expect(await meta.getAttribute('content')).not.toMatch(new RegExp(`Homework|${minor.handle}`))
    }

    // Their profile is found, as anyone's is, but looks like a member's who has not posted yet.
    await page.goto(`/u/${minor.handle}`)
    await expect(page.getByText('has not posted yet')).toBeVisible()
    await expect(page.getByText('0 posts', { exact: true })).toBeVisible()
    await expect(page.getByText(text)).toHaveCount(0)
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached()

    // Nor is it in Latest.
    await page.goto('/?feed=latest')
    await expect(page.getByRole('main').locator('article').first()).toBeVisible()
    await expect(page.getByText(text)).toHaveCount(0)
  } finally {
    await visitor.close()
    await minor.context.close()
    await stranger.context.close()
  }
})
