import { expect, test } from '@playwright/test'
import { newMember, post, replyBox } from '../lib/members.ts'

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n')
const height = async (box: import('@playwright/test').Locator) => Math.round((await box.boundingBox())!.height)

/** The box's height once it has stopped changing: focusing it opens it to a few rows a moment after the click. */
async function settledHeight(box: import('@playwright/test').Locator) {
  let last = await height(box)
  for (let stable = 0; stable < 3; ) {
    await box.page().waitForTimeout(100)
    const now = await height(box)
    stable = now === last ? stable + 1 : 0
    last = now
  }
  return last
}

/** Typing grows the box, a lot of text stops at its cap and scrolls, and clearing shrinks it back. */
async function expectGrowsWithText(page: import('@playwright/test').Page, box: import('@playwright/test').Locator) {
  await box.click()
  const empty = await settledHeight(box)

  await box.fill(lines(8))
  await expect.poll(() => height(box)).toBeGreaterThan(empty + 60)
  // Everything typed is in view: nothing is hidden above or below.
  expect(await box.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)

  // Far more text than fits: the box stops at half the window and scrolls.
  await box.fill(Array.from({ length: 100 }, () => 'x').join('\n'))
  const cap = (page.viewportSize()?.height ?? 800) / 2
  await expect.poll(() => height(box)).toBeLessThanOrEqual(Math.ceil(cap) + 2)
  expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

  await box.fill('')
  await expect.poll(() => height(box)).toBe(empty)
}

test('the writing box grows with what is typed, in the feed and in a reply @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'grower')
  await page.goto('/')
  await expectGrowsWithText(page, page.getByRole('textbox', { name: 'New post' }))

  const article = await post(page, `Grow with me ${handle}`)
  const id = (await article.getAttribute('id'))!.replace('post-', '')
  await page.goto(`/p/${id}`)
  await expectGrowsWithText(page, await replyBox(page))
  await context.close()
})

test('a long post still shows all of its text after it is posted, and the box shrinks back', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'longform')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  const empty = await settledHeight(box)
  await box.fill(`${handle}\n${lines(6)}`)
  await expect.poll(() => height(box)).toBeGreaterThan(empty + 40)
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.locator('article', { hasText: 'line 6' }).first()).toBeVisible()
  // Posted: the box is emptied and closes back up.
  await expect(box).toHaveValue('')
  await expect.poll(() => height(box)).toBeLessThan(empty)
  await context.close()
})
