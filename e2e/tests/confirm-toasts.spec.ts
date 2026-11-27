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
    // A card in the middle of the window, beside the page's scrollbar gutter (15px on
    // Linux CI), which Chromium's documentElement.clientWidth wrongly counts.
    const margins = await question(page).evaluate((node) => {
      const style = getComputedStyle(node)
      return { left: Number.parseFloat(style.marginLeft), right: Number.parseFloat(style.marginRight) }
    })
    expect(margins.left).toBeGreaterThan(0)
    expect(Math.abs(margins.left - margins.right)).toBeLessThan(2)
    const height = await page.evaluate(() => document.documentElement.clientHeight)
    expect(Math.abs(sheet.y + sheet.height / 2 - height / 2)).toBeLessThan(2)
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

test('a double click on Delete post leaves the question open', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'doubler')
  const text = `Pressed twice, ${handle}`
  await post(page, text)

  const article = page.locator('article', { hasText: text })
  await article.getByLabel('Post options').click()
  await article.getByRole('button', { name: 'Delete post' }).dblclick()
  // The second click lands on the scrim of the question the first one opened.
  await expect(question(page)).toBeVisible()
  await question(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(article).toBeVisible()
  await context.close()
})

/** The middle of the dialog's confirm button, where a second click or tap would land. */
async function confirmPoint(page: Page) {
  const box = (await question(page).getByRole('button', { name: 'Delete post' }).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('a double click on Cancel, the scrim or the confirm button answers once and the second click reaches nothing behind', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'dbldeleter', { viewport: { width: 1280, height: 800 } })
  const behind = `Stays put, ${handle}`
  const text = `Deleted with a double click, ${handle}`
  await post(page, behind)
  await post(page, text)
  const before = page.url()

  // Behind the dialog is the post's own card, which opens the post when clicked.
  await askToDelete(page, text)
  const cancel = (await question(page).getByRole('button', { name: 'Cancel' }).boundingBox())!
  await page.mouse.dblclick(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2)
  await expect(question(page)).toBeHidden()
  await askToDelete(page, text)
  const sheet = (await question(page).boundingBox())!
  await page.mouse.dblclick(sheet.x + sheet.width / 2, sheet.y + sheet.height + 30)
  await expect(question(page)).toBeHidden()
  await page.waitForTimeout(1_000)
  expect(page.url()).toBe(before)
  await expect(page.locator('article', { hasText: text })).toBeVisible()

  await askToDelete(page, text)
  const point = await confirmPoint(page)
  await page.mouse.dblclick(point.x, point.y)
  await expect(question(page)).toBeHidden()
  await page.waitForTimeout(1_000)
  expect(page.url()).toBe(before)
  await expect(page.locator('article', { hasText: text })).toHaveCount(0)
  await expect(page.locator('article', { hasText: behind })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Post deleted' })).toHaveCount(1)
  await context.close()
})

test('a double tap on the confirm button over the phone tab bar does not open the tab, and a later tap does', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'dbltapper', {
    viewport: { width: 375, height: 667 },
    hasTouch: true,
    isMobile: true,
  })
  const text = `Deleted with a double tap, ${handle}`
  await post(page, text)
  const before = page.url()

  await askToDelete(page, text)
  const button = (await question(page).getByRole('button', { name: 'Delete post' }).boundingBox())!
  const alerts = (await page.getByRole('link', { name: 'Alerts (Notifications)' }).boundingBox())!
  // The confirm button sits over the Alerts tab, so a stray second tap would open it.
  const left = Math.max(button.x, alerts.x)
  const right = Math.min(button.x + button.width, alerts.x + alerts.width)
  const top = Math.max(button.y, alerts.y)
  const bottom = Math.min(button.y + button.height, alerts.y + alerts.height)
  expect(right).toBeGreaterThan(left)
  expect(bottom).toBeGreaterThan(top)
  const point = { x: (left + right) / 2, y: (top + bottom) / 2 }

  await page.touchscreen.tap(point.x, point.y)
  await page.touchscreen.tap(point.x, point.y)
  await expect(question(page)).toBeHidden()
  await page.waitForTimeout(1_000)
  expect(page.url()).toBe(before)
  await expect(page.locator('article', { hasText: text })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Post deleted' })).toHaveCount(1)

  await page.touchscreen.tap(point.x, point.y)
  await expect(page).toHaveURL(/\/notifications$/)
  await context.close()
})

test('on a touch screen, dismissing one toast lets the others go by themselves @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'tapper')
  test.skip(!test.info().project.use.hasTouch, 'a touch screen only')
  const pinned = `Pinned, ${handle}`
  const deleted = `Tapped away, ${handle}`
  await post(page, pinned)
  await post(page, deleted)
  await page.clock.install()
  // Held still, so the first toast is not gone before the second arrives.
  await page.clock.pauseAt(Date.now() + 1_000)

  const article = page.locator('article', { hasText: pinned }).first()
  await article.getByLabel('Post options').click()
  await article.getByRole('button', { name: 'Pin to your profile' }).click()
  await expect(toasts(page).getByText('Pinned to your profile')).toBeVisible()
  await askToDelete(page, deleted)
  await question(page).getByRole('button', { name: 'Delete post' }).click()
  await expect(toasts(page).getByText('Post deleted')).toBeVisible()

  await toasts(page).getByRole('button', { name: 'Dismiss' }).first().tap()
  await expect(toasts(page).getByText('Pinned to your profile')).toHaveCount(0)
  await page.clock.runFor(6_000)
  await expect(toasts(page)).toHaveCount(0)
  await context.close()
})

test('signing out forgets a flash nobody has seen yet', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'leaver')
  await page.goto('/')
  await context.addCookies([{
    name: 'hn_flash',
    value: 'blocked.0b0e3c1e-6f0a-4f6e-9a57-0d7f0e2f9c11',
    url: new URL('/', page.url()).href,
    httpOnly: true,
    expires: Math.floor(Date.now() / 1000) + 30,
  }])
  // Kratos's own logout is not followed: its redirect home goes to the configured web origin.
  const out = await page.request.get('/logout?to=%2Fkratos%2Fself-service%2Flogout%3Ftoken%3De2e', { maxRedirects: 0 })
  expect(out.status()).toBe(303)
  expect((await context.cookies()).map((cookie) => cookie.name)).not.toContain('hn_flash')
  await context.close()
})
