import { expect, type Page, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

const question = (page: Page) => page.getByRole('alertdialog', { name: 'Delete this post?' })
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })

/** Opens the post's menu if it is closed, and presses Delete post. */
async function askToDelete(page: Page, text: string) {
  const article = page.locator('article', { hasText: text })
  const item = article.getByRole('button', { name: 'Delete post' })
  if (!(await item.isVisible())) await article.getByLabel('Post options').click()
  await item.click()
  await expect(question(page)).toBeVisible()
  return item
}

test('deleting a post asks in our own dialog: Cancel, Esc and the scrim keep the post, and focus goes back', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'asker')
  let browserDialogs = 0
  page.on('dialog', (dialog) => {
    browserDialogs++
    void dialog.dismiss()
  })
  const text = `Maybe a mistake, ${handle}`
  await post(page, text)

  const item = await askToDelete(page, text)
  await expect(question(page)).toContainText('This cannot be undone.')
  // A destructive question starts on Cancel, so Enter does nothing by accident.
  await expect(question(page).getByRole('button', { name: 'Cancel' })).toBeFocused()
  // The page behind is out of reach, and Tab stays in the dialog.
  await page.keyboard.press('Tab')
  await expect(question(page).getByRole('button', { name: 'Delete post' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(question(page).getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(question(page).getByRole('button', { name: 'Delete post' })).toBeFocused()

  await question(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(question(page)).toBeHidden()
  await expect(item).toBeFocused()

  await askToDelete(page, text)
  await page.keyboard.press('Escape')
  await expect(question(page)).toBeHidden()
  await expect(item).toBeFocused()

  await askToDelete(page, text)
  await page.mouse.click(4, 4)
  await expect(question(page)).toBeHidden()
  await expect(item).toBeFocused()

  await page.reload()
  await expect(page.locator('article', { hasText: text })).toBeVisible()
  await expect(toasts(page)).toHaveCount(0)
  expect(browserDialogs).toBe(0)
  await context.close()
})

test('confirming deletes the post and says so in a toast, once @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'confirmer')
  let browserDialogs = 0
  page.on('dialog', (dialog) => {
    browserDialogs++
    void dialog.accept()
  })
  const text = `Posted by mistake, ${handle}`
  await post(page, text)

  await askToDelete(page, text)
  const view = page.viewportSize()!
  const sheet = (await question(page).boundingBox())!
  if (view.width < 640) {
    // A bottom sheet, as wide as the phone.
    expect(Math.round(sheet.width)).toBe(view.width)
    expect(Math.round(sheet.y + sheet.height)).toBe(view.height)
  } else {
    // A card in the middle of the window. A page scrollbar (Linux CI draws a
    // 15px one) is not part of the area the dialog is centred in.
    const area = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    }))
    expect(Math.abs(sheet.x + sheet.width / 2 - area.width / 2)).toBeLessThan(2)
    expect(Math.abs(sheet.y + sheet.height / 2 - area.height / 2)).toBeLessThan(2)
  }
  for (const name of ['Cancel', 'Delete post']) {
    const button = (await question(page).getByRole('button', { name }).boundingBox())!
    expect(button.height).toBeGreaterThanOrEqual(44)
  }

  await question(page).getByRole('button', { name: 'Delete post' }).click()
  await expect(page.locator('article', { hasText: text })).toHaveCount(0)
  const toast = toasts(page).getByText('Post deleted')
  await expect(toast).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Post deleted' })).toHaveCount(1)
  await expect(question(page)).toBeHidden()

  // Clear of the bars a phone keeps on screen.
  const box = (await toasts(page).boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(view.width)
  if (view.width < 1024) {
    const top = (await page.locator('.square-topbar').boundingBox())!
    const bottom = (await page.locator('.square-bottom-nav').boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(top.y + top.height)
    expect(box.y + box.height).toBeLessThanOrEqual(bottom.y)
  }

  await toasts(page).getByRole('button', { name: 'Dismiss' }).click()
  await expect(toasts(page)).toHaveCount(0)

  // Read once: the next page does not say it again.
  await page.reload()
  await expect(page.getByLabel('Account menu')).toBeVisible()
  await expect(page.locator('article', { hasText: text })).toHaveCount(0)
  await expect(toasts(page)).toHaveCount(0)
  expect(browserDialogs).toBe(0)
  await context.close()
})

test('a toast goes by itself, but not while the pointer or the keyboard is on it', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'reader')
  const text = `Short-lived, ${handle}`
  await post(page, text)
  await page.clock.install()

  await askToDelete(page, text)
  await question(page).getByRole('button', { name: 'Delete post' }).click()
  const toast = toasts(page).getByText('Post deleted')
  await expect(toast).toBeVisible()

  await toast.hover()
  await page.clock.runFor(20_000)
  await expect(toast).toBeVisible()

  await page.mouse.move(0, 0)
  await toasts(page).getByRole('button', { name: 'Dismiss' }).focus()
  await page.clock.runFor(20_000)
  await expect(toast).toBeVisible()

  await page.getByRole('textbox', { name: 'New post' }).focus()
  await page.clock.runFor(6_000)
  await expect(toasts(page)).toHaveCount(0)
  await context.close()
})
