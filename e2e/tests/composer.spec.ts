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

test('emoji picked from the picker go in at the caret, whole, and are in the post @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emoji')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Hello ${handle}`)
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker).toBeVisible()
  const { bottom, right } = await picker.evaluate((el) => el.getBoundingClientRect().toJSON())
  expect(bottom).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(right).toBeLessThanOrEqual(page.viewportSize()!.width)

  // The picker stays open for several picks, and the box keeps the focus.
  await picker.getByRole('button', { name: 'grinning face', exact: true }).click()
  await picker.getByRole('searchbox', { name: 'Search emoji' }).fill('family')
  await picker.getByRole('button', { name: 'family: man, woman, girl' }).click()
  await expect(box).toHaveValue(`Hello ${handle}😀👨‍👩‍👧`)
  await expect(box).toBeFocused()

  await box.press('Escape')
  await expect(picker).toBeHidden()
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.locator('article', { hasText: `Hello ${handle}😀👨‍👩‍👧` }).first()).toBeVisible()
  await context.close()
})

test('when the emoji picker cannot be downloaded it closes, the draft stays, and the next open tries again', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojioffline')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  const draft = `A long draft ${handle}`
  await box.fill(draft)

  // The picker's code is fetched on first open; a new deploy or a dropped connection makes that fail.
  const chunks = /\/_next\/static\/chunks\//
  let refused = 0
  await page.route(chunks, (route) => {
    refused++
    return route.abort('internetdisconnected')
  })
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.click()
  await expect.poll(() => refused).toBeGreaterThan(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('dialog', { name: 'Emoji' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'We could not load this page' })).toBeHidden()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load emoji. Try again.' })).toBeVisible()
  await expect(box).toHaveValue(draft)

  await page.unroute(chunks)
  await toggle.click()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker).toBeVisible()
  await expect(page.getByText('Could not load emoji. Try again.')).toBeHidden()
  await picker.getByRole('button', { name: 'grinning face', exact: true }).click()
  await expect(box).toHaveValue(`${draft}😀`)
  await context.close()
})

test('picking the emoji that is selected leaves the caret where the member next puts it', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'emojisame')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill('Good 😀 morning')
  // Selects the 😀 (two UTF-16 units), so picking 😀 writes the same text back.
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(5, 7))
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await picker.getByRole('button', { name: 'grinning face', exact: true }).click()
  await expect(box).toHaveValue('Good 😀 morning')
  await expect(box).toBeFocused()
  expect(await box.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([7, 7])

  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length))
  await box.pressSequentially('!?')
  await expect(box).toHaveValue('Good 😀 morning!?')
  await context.close()
})

test('the emoji picker is two tab stops, moves by arrow keys and lets Tab carry on', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojikeys')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Hi ${handle}`)
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')

  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker.getByRole('searchbox', { name: 'Search emoji' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(picker.getByRole('button', { name: 'grinning face', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(picker.getByRole('searchbox', { name: 'Search emoji' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(picker.getByRole('button', { name: 'grinning face', exact: true })).toBeFocused()
  // Every emoji but the one the arrows are on is out of the tab order.
  await expect(picker.locator('button[tabindex="0"]')).toHaveCount(1)
  await page.keyboard.press('ArrowRight')
  await expect(picker.getByRole('button', { name: 'grinning face with big eyes', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(box).toHaveValue(`Hi ${handle}😃`)
  await expect(picker).toBeVisible()

  await page.keyboard.press('Tab')
  await expect(picker).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await context.close()
})

test('pressing inside the emoji picker keeps a reply box open around it, and Escape returns to its button @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojireply')
  const article = await post(page, `Reply with emoji ${handle}`)
  const id = (await article.getAttribute('id'))!.replace('post-', '')
  await page.goto(`/p/${id}`)
  const box = await replyBox(page)
  await box.click()

  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker.getByRole('searchbox', { name: 'Search emoji' })).toBeFocused()

  // The picker is drawn in the body, outside the form, but it belongs to the box.
  await picker.getByRole('searchbox', { name: 'Search emoji' }).click()
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await expect(toggle).toBeFocused()
  await context.close()
})

const PHONE = { width: 375, height: 667 }
const USABLE = 36 + 3 * 44
const rect = (locator: import('@playwright/test').Locator) => locator.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect)

/** The picker is on screen, tall enough to use, and clear of the box it writes into. */
async function expectClearOfBox(page: import('@playwright/test').Page, box: import('@playwright/test').Locator) {
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker).toBeVisible()
  const [p, t] = [await rect(picker), await rect(box)]
  expect(p.bottom <= t.top || p.top >= t.bottom, `picker ${p.top}-${p.bottom} overlaps the box ${t.top}-${t.bottom}`).toBe(true)
  expect(p.top).toBeGreaterThanOrEqual(0)
  expect(p.bottom).toBeLessThanOrEqual(PHONE.height)
  // Room for the search box and three rows of emoji at least.
  expect(p.height).toBeGreaterThanOrEqual(USABLE)
}

test('the emoji picker never covers the box, in a tall feed draft or in the phone reply bar @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojiclear', { viewport: PHONE })
  // A draft tall enough that the toolbar sits low, with more room above it than below.
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await box.fill(`${handle}\n${lines(8)}`)
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await expectClearOfBox(page, box)
  await box.press('Escape')

  const article = await post(page, `Reply bar ${handle}`)
  const id = (await article.getAttribute('id'))!.replace('post-', '')
  await page.goto(`/p/${id}`)
  const reply = await replyBox(page)
  await reply.click()
  await reply.fill('Nice one')
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await expectClearOfBox(page, reply)
  await context.close()
})

test('scrolling the emoji grid does not place the picker again on every scroll event', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'emojiscroll')
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker).toBeVisible()
  const measured = await page.evaluate(async () => {
    let count = 0
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains('composer-toolbar')) count++
      return original.call(this)
    }
    const grid = document.querySelector<HTMLElement>('.emoji-scroll')!
    const scrolled = new Promise((resolve) => grid.addEventListener('scroll', resolve, { once: true }))
    grid.scrollTop = 400
    await scrolled
    await new Promise((resolve) => requestAnimationFrame(resolve))
    Element.prototype.getBoundingClientRect = original
    return { count, top: grid.scrollTop }
  })
  expect(measured.top).toBeGreaterThan(0)
  expect(measured.count).toBe(0)
  await context.close()
})

test('the emoji picker closes when the post is sent, not after it lands', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojisend')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Sending ${handle}`)
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.click()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker).toBeVisible()

  // The post is held on its way until the picker has been checked.
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/*', async (route) => {
    if (route.request().method() !== 'POST' || !route.request().headers()['next-action']) return route.fallback()
    await held
    return route.continue()
  })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Posting…' })).toBeVisible()
  await expect(picker).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  release()
  await expect(page.locator('article', { hasText: `Sending ${handle}` }).first()).toBeVisible()
  await context.close()
})

test('on a touch screen the Emoji button is a full touch target, in the feed and in a reply @mobile', async ({ browser }) => {
  test.skip(!test.info().project.use.hasTouch, 'touch screens only')
  const { page, handle, context } = await newMember(browser, 'emojitarget')
  await page.goto('/')
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  await page.getByRole('textbox', { name: 'New post' }).click()
  expect(await height(page.getByRole('button', { name: 'Emoji', exact: true }))).toBeGreaterThanOrEqual(44)

  const article = await post(page, `Big targets ${handle}`)
  const id = (await article.getAttribute('id'))!.replace('post-', '')
  await page.goto(`/p/${id}`)
  await (await replyBox(page)).click()
  expect(await height(page.getByRole('button', { name: 'Emoji', exact: true }))).toBeGreaterThanOrEqual(44)
  await context.close()
})

test('tapping Emoji and an emoji leaves the box unfocused, so no on-screen keyboard opens, and Escape still closes it @mobile', async ({ browser }) => {
  test.skip(!test.info().project.use.hasTouch, 'touch screens only')
  const { page, handle, context } = await newMember(browser, 'emojitap')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Tap ${handle}`)
  await box.evaluate((el: HTMLTextAreaElement) => el.blur())
  await page.getByRole('button', { name: 'Emoji', exact: true }).tap()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker).toBeVisible()
  await expect(box).not.toBeFocused()
  await picker.getByRole('button', { name: 'grinning face', exact: true }).tap()
  await expect(box).toHaveValue(`Tap ${handle}😀`)
  await expect(box).not.toBeFocused()

  // Nothing in the composer has focus now; Escape still closes the picker.
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await context.close()
})

test('a screen reader click on Emoji (no pointer press before it) moves focus into the picker, and its pick keeps focus there', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojireader')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Read ${handle}`)
  // VoiceOver's double-tap: a click with detail 1 and no pointerdown.
  await page.getByRole('button', { name: 'Emoji', exact: true }).dispatchEvent('click', { detail: 1 })
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker.getByRole('searchbox', { name: 'Search emoji' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const grinning = picker.getByRole('button', { name: 'grinning face', exact: true })
  await expect(grinning).toBeFocused()
  await grinning.dispatchEvent('click', { detail: 1 })
  await expect(box).toHaveValue(`Read ${handle}😀`)
  await expect(grinning).toBeFocused()
  await context.close()
})

test('pressing a heading in the picker keeps it open for Escape, and pressing nothing in the form closes it', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojiescape')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Escape ${handle}`)
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await picker.getByRole('heading', { name: 'Smileys' }).click()
  await expect(picker).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(picker).toBeVisible()
  // The form's own padding: focus leaves the picker for nothing.
  await page.locator('form#compose').click({ position: { x: 4, y: 4 } })
  await expect(picker).toBeHidden()
  await context.close()
})

test('the Recently used row is there from the picker\'s first paint', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'emojirecent')
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('emoji-recent', JSON.stringify(['🎉']))
    // Notes any moment the picker is in the page without the row.
    const seen = { without: false }
    ;(window as unknown as { emojiSeen: typeof seen }).emojiSeen = seen
    new MutationObserver(() => {
      const picker = document.querySelector('[role="dialog"][aria-label="Emoji"]')
      if (picker && !picker.textContent?.includes('Recently used')) seen.without = true
    }).observe(document.body, { childList: true, subtree: true })
  })
  await page.getByRole('textbox', { name: 'New post' }).click()
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker.getByRole('heading', { name: 'Recently used' })).toBeVisible()
  await expect(picker.getByRole('button', { name: 'party popper' }).first()).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { emojiSeen: { without: boolean } }).emojiSeen.without)).toBe(false)
  await context.close()
})

test('the emoji picker says it is loading while it downloads', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'emojiwait')
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const chunks = /\/_next\/static\/chunks\//
  await page.route(chunks, async (route) => {
    await held
    return route.continue()
  })
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await expect(page.getByText('Loading emoji…')).toBeVisible()
  release()
  await expect(page.getByRole('dialog', { name: 'Emoji' })).toBeVisible()
  await expect(page.getByText('Loading emoji…')).toBeHidden()
  await page.unroute(chunks)
  await context.close()
})
