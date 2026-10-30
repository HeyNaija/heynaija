import { expect, type Page, test } from '@playwright/test'
import { seedPosts, seedThread } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// Next keeps recently visited pages in the DOM, hidden, so only visible posts count.
const cards = (page: Page) => page.getByRole('main').locator('.post-list article').filter({ visible: true })

async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
}

/**
 * Scrolls to the end until no more posts arrive; returns each count seen. Waits
 * for the count to grow rather than for a fixed time, so a busy machine does not
 * end the loop while a batch is still on its way.
 */
async function scrollUntilSettled(page: Page) {
  const seen = [await cards(page).count()]
  for (let i = 0; i < 12; i++) {
    const before = seen.at(-1)!
    await scrollToEnd(page)
    const grew = await expect
      .poll(() => cards(page).count(), { timeout: 10_000 })
      .toBeGreaterThan(before)
      .then(() => true, () => false)
    if (!grew) break
    seen.push(await cards(page).count())
  }
  return seen
}

async function ids(page: Page) {
  return cards(page).evaluateAll((els) => els.map((el) => el.id))
}

test.describe('infinite scroll on a long feed', () => {
  test('loads batches near the end, stops at 150, then loads on request', async ({ browser }) => {
    const { page, handle, context } = await newMember(browser, 'prolific')
    await seedPosts(handle, 160)
    await page.goto(`/u/${handle}`)
    await expect(cards(page)).toHaveCount(30)

    const counts = await scrollUntilSettled(page)
    expect(counts.at(-1)).toBe(150)
    expect(counts).toEqual(expect.arrayContaining([60, 90, 120]))
    await expect(page.getByRole('status').filter({ hasText: '30 more posts loaded' })).toBeAttached()

    await page.getByRole('link', { name: 'Older posts' }).click()
    await expect(cards(page)).toHaveCount(160)
    await expect(page.getByText('No older posts.')).toBeVisible()

    const all = await ids(page)
    expect(new Set(all).size).toBe(all.length)
    await context.close()
  })

  test('Back from a post restores the loaded posts and the scroll position', async ({ browser }) => {
    const { page, handle, context } = await newMember(browser, 'scroller')
    await seedPosts(handle, 160)
    await page.goto(`/u/${handle}`)
    await scrollUntilSettled(page)

    // Open a post from a batch that was loaded in the browser.
    const target = cards(page).nth(100)
    const id = await target.getAttribute('id')
    await target.scrollIntoViewIfNeeded()
    const before = await page.evaluate(() => Math.round(window.scrollY))
    const count = await cards(page).count()
    await target.locator('time').click()
    await expect(page).toHaveURL(/\/p\//)

    await page.goBack()
    await expect(cards(page)).toHaveCount(count)
    await expect(page.locator(`#${id}`).filter({ visible: true })).toBeInViewport()
    expect(Math.abs((await page.evaluate(() => Math.round(window.scrollY))) - before)).toBeLessThan(50)
    await context.close()
  })

  test('a failed load says so and can be retried', async ({ browser }) => {
    const { page, handle, context } = await newMember(browser, 'offline')
    await seedPosts(handle, 40)
    await page.goto(`/u/${handle}`)
    await expect(cards(page)).toHaveCount(30)

    // Fail the next server action (the batch load) as a dropped connection would.
    let failed = false
    await page.route('**/*', async (route) => {
      const request = route.request()
      if (!failed && request.method() === 'POST' && (await request.headerValue('next-action'))) {
        failed = true
        return route.abort('internetdisconnected')
      }
      return route.fallback()
    })
    await scrollToEnd(page)
    await expect(page.getByText('Check your connection and try again')).toBeVisible()
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(cards(page)).toHaveCount(40)
    await context.close()
  })
})

test('a reply in a list says whom it answers, previews the post, and says nothing of one that is gone @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'replyctx')
  try {
    const fixture = await seedThread(handle)
    await page.goto(`/u/${handle}?tab=replies`)
    const card = page.locator('article.post-card', { hasText: 'Thread reply 25 ' })
    await expect(card).toBeVisible()
    await expect(card.locator('.reply-to')).toHaveText(`Replying to @${handle}`)
    await expect(card.locator('.reply-to a')).toHaveAttribute('href', `/p/${fixture.root}`)
    await expect(card.locator('.reply-parent-excerpt')).toHaveText(`Thread fixture from ${handle}`)
    // The deleted bridge's reply, were it listed, would say only "no longer available"; the
    // text of a gone post never reaches the page.
    await expect(page.locator('body')).not.toContainText('Deleted bridge content must not appear')
  } finally {
    await context.close()
  }
})
