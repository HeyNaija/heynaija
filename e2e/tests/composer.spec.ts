import { expect, test } from '@playwright/test'
import { gif } from '../lib/gif.ts'
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

/** Taps Emoji while the picker's code cannot be fetched, and waits for its error. */
async function failEmojiLoad(page: import('@playwright/test').Page) {
  const chunks = /\/_next\/static\/chunks\//
  await page.route(chunks, (route) => route.abort('internetdisconnected'))
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load emoji. Try again.' })).toBeVisible()
  await page.unroute(chunks)
}

test('a post refused after the emoji picker failed to load says why it was refused, and a sent one leaves no error', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojirefused')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Refused ${handle}`)
  await failEmojiLoad(page)

  // A community that does not exist: the server refuses the post.
  await page.locator('form#compose').evaluate((form) => {
    const field = Object.assign(document.createElement('input'), { type: 'hidden', name: 'community', value: 'no-such-community', id: 'bogus-community' })
    form.append(field)
  })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'That community is no longer available.' })).toBeVisible()
  await expect(page.getByText('Could not load emoji. Try again.')).toBeHidden()

  await page.locator('#bogus-community').evaluate((field) => field.remove())
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.locator('article', { hasText: `Refused ${handle}` }).first()).toBeVisible()
  await expect(page.getByText('Could not load emoji. Try again.')).toBeHidden()
  await context.close()
})

test('typing after the emoji picker failed to load clears its error', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojitypeon')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Typing on ${handle}`)
  await failEmojiLoad(page)
  await box.press('End')
  await box.pressSequentially('!')
  await expect(page.getByText('Could not load emoji. Try again.')).toBeHidden()
  await context.close()
})

test('focus leaving the emoji search for nothing on a focused page keeps the picker open and the search', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojiblur')
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).fill(`Blur ${handle}`)
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  const search = picker.getByRole('searchbox', { name: 'Search emoji' })
  await expect(search).toBeFocused()
  await search.fill('heart')
  await search.evaluate((el: HTMLInputElement) => el.blur())
  await expect(picker).toBeVisible()
  await expect(search).toHaveValue('heart')
  await expect(toggle).not.toBeFocused()
  // Nothing has focus now; Escape still closes it.
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await context.close()
})

test('on a touch screen, closing the on-screen keyboard from the emoji search keeps the picker and what was typed', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojikbd', { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true })
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Keyboard ${handle}`)
  await box.evaluate((el: HTMLTextAreaElement) => el.blur())
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.tap()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  const search = picker.getByRole('searchbox', { name: 'Search emoji' })
  await search.tap()
  await expect(search).toBeFocused()
  await search.pressSequentially('heart')
  // The keyboard's own close key blurs the field to nothing; the page keeps its focus.
  await search.evaluate((el: HTMLInputElement) => el.blur())
  expect(await page.evaluate(() => document.hasFocus())).toBe(true)
  await expect(picker).toBeVisible()
  await expect(search).toHaveValue('heart')
  await expect(toggle).not.toBeFocused()
  await picker.getByRole('button', { name: 'red heart', exact: true }).tap()
  await expect(box).toHaveValue(`Keyboard ${handle}❤️`)
  await context.close()
})

test('the emoji picker stays open when the window loses focus, and focus is still in it', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojiwindow')
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).fill(`Window ${handle}`)
  const toggle = page.getByRole('button', { name: 'Emoji', exact: true })
  await toggle.focus()
  await page.keyboard.press('Enter')
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  const search = picker.getByRole('searchbox', { name: 'Search emoji' })
  await expect(search).toBeFocused()
  // What a browser does on a tab or app switch: the focused element gets a blur with no
  // relatedTarget and keeps focus, and the document no longer has focus.
  await page.evaluate(() => {
    document.hasFocus = () => false
    const focused = document.activeElement!
    focused.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }))
    focused.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
  })
  await expect(picker).toBeVisible()
  await expect(search).toBeFocused()
  await search.fill('grinning')
  await expect(picker.getByRole('button', { name: 'grinning face', exact: true })).toBeVisible()
  await context.close()
})

test('the emoji picker stays open when the box it writes into is blurred, as by an iPhone keyboard\'s Done', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'emojidone')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Done ${handle}`)
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await expect(picker).toBeVisible()
  await expect(box).toBeFocused()
  await box.evaluate((el: HTMLTextAreaElement) => el.blur())
  await expect(picker).toBeVisible()
  await picker.getByRole('button', { name: 'grinning face', exact: true }).click()
  await expect(box).toHaveValue(`Done ${handle}😀`)
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

// The Giphy controls exist only in a web app built with a key (NEXT_PUBLIC_GIPHY_API_KEY, any
// value: Giphy itself is answered here, never reached), so this runs only when the run is told
// the app has one:
//
//   NEXT_PUBLIC_GIPHY_API_KEY=stand-in pnpm dev:web
//   NEXT_PUBLIC_GIPHY_API_KEY=stand-in pnpm e2e composer
test('a GIF from Giphy with no words can be posted', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_GIPHY_API_KEY, 'needs a web app built with a Giphy key; see the comment above this test')
  const { page, handle, context } = await newMember(browser, 'gifonly')
  const id = `e2e${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
  const title = `Waving for ${handle}`
  const rendition = { url: `https://media1.giphy.com/media/${id}/100w.gif`, width: '100', height: '100' }
  await context.route(/^https:\/\/[a-z0-9.-]*\bgiphy\.com\//, (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'api.giphy.com') return route.fulfill({ contentType: 'image/gif', body: gif() })
    return route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: {
        data: [{ id, title, type: 'gif', images: { fixed_width_small: rendition, fixed_width: rendition } }],
        pagination: { total_count: 1, count: 1, offset: 0 },
        meta: { status: 200, msg: 'OK', response_id: 'e2e' },
      },
    })
  })

  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await page.getByRole('button', { name: 'Search GIFs' }).click()
  await page.getByRole('dialog', { name: 'Search GIFs' }).getByRole('button', { name: title }).click()
  await expect(page.getByLabel('Description of GIF')).toHaveValue(title)

  await expect(box).toHaveValue('')
  // The browser's own check of the form, which runs before a press on Post reaches the app.
  expect(await page.locator('#compose').evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(true)
  await page.getByRole('button', { name: 'Post', exact: true }).click()

  await expect(page.locator('article').filter({ has: page.locator(`img[src*="/media/${id}/"]`) }).first()).toBeVisible()
  await expect(page.getByLabel('Description of GIF')).toBeHidden()
  await context.close()
})

test('when the GIF search cannot be downloaded it closes, the draft stays, and the next open tries again', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_GIPHY_API_KEY, 'needs a web app built with a Giphy key; see the comment above the test before this one')
  const { page, handle, context } = await newMember(browser, 'gifoffline')
  await context.route(/^https:\/\/[a-z0-9.-]*\bgiphy\.com\//, (route) =>
    route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { data: [], pagination: { total_count: 0, count: 0, offset: 0 }, meta: { status: 200, msg: 'OK', response_id: 'e2e' } },
    }),
  )
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  const draft = `A long draft ${handle}`
  await box.fill(draft)

  const chunks = /\/_next\/static\/chunks\//
  let refused = 0
  await page.route(chunks, (route) => {
    refused++
    return route.abort('internetdisconnected')
  })
  const toggle = page.getByRole('button', { name: 'Search GIFs' })
  await toggle.click()
  await expect.poll(() => refused).toBeGreaterThan(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('dialog', { name: 'Search GIFs' })).toBeHidden()
  await expect(page.getByRole('heading', { name: 'We could not load this page' })).toBeHidden()
  await expect(box).toHaveValue(draft)

  await page.unroute(chunks)
  await toggle.click()
  await expect(page.getByRole('dialog', { name: 'Search GIFs' })).toBeVisible()
  await expect(box).toHaveValue(draft)
  await context.close()
})

test('a poll or a picture that hides the GIF search closes it, so taking them away does not open it again', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_GIPHY_API_KEY, 'needs a web app built with a Giphy key; see the comment above the test before this one')
  const { page, handle, context } = await newMember(browser, 'gifhidden')
  let searches = 0
  await context.route(/^https:\/\/[a-z0-9.-]*\bgiphy\.com\//, (route) => {
    if (new URL(route.request().url()).hostname === 'api.giphy.com') searches++
    return route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { data: [], pagination: { total_count: 0, count: 0, offset: 0 }, meta: { status: 200, msg: 'OK', response_id: 'e2e' } },
    })
  })
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Hidden ${handle}`)
  const toggle = page.getByRole('button', { name: 'Search GIFs' })
  const search = page.getByRole('dialog', { name: 'Search GIFs' })
  await toggle.click()
  await expect(search).toBeVisible()
  await expect.poll(() => searches).toBe(1)

  const poll = page.getByRole('button', { name: 'Poll' })
  await poll.click()
  await expect(search).toBeHidden()
  await poll.click()
  await expect(poll).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(search).toBeHidden()

  await toggle.click()
  await expect(search).toBeVisible()
  await page.locator('#compose input[type="file"]:not([accept*="video"])').setInputFiles({ name: 'dance.gif', mimeType: 'image/gif', buffer: gif() })
  await expect(search).toBeHidden()
  await page.getByRole('button', { name: 'Remove GIF 1' }).click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(search).toBeHidden()
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

test('while searching, no emoji section is labelled by a heading that is not drawn', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'emojilabels')
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await picker.getByRole('searchbox', { name: 'Search emoji' }).fill('heart')
  await expect(picker.getByRole('button', { name: 'red heart' })).toBeVisible()
  const dangling = await picker.locator('section').evaluateAll((sections) =>
    sections.map((s) => s.getAttribute('aria-labelledby')).filter((id) => id !== null && !document.getElementById(id)),
  )
  expect(dangling).toEqual([])
  await context.close()
})

type Rect = { top: number; bottom: number; left: number; right: number }
const overlaps = (a: Rect, b: Rect) => a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right

/** The picker overlaps none of `parts`, each named for the failure message. */
async function expectPickerClearOf(picker: import('@playwright/test').Locator, parts: Record<string, import('@playwright/test').Locator>) {
  await expect(picker).toBeVisible()
  // Placement follows the composer on its next layout; let it settle.
  await picker.page().evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const p = await rect(picker)
  for (const [name, part] of Object.entries(parts)) {
    for (const r of await part.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
      expect(overlaps(p, r), `picker ${Math.round(p.top)}-${Math.round(p.bottom)} overlaps ${name} ${Math.round(r.top)}-${Math.round(r.bottom)}`).toBe(false)
    }
  }
}

/** Scrolls the feed so the composer sits right under the top bar, as it does once the page has been read a little. */
async function scrollComposerToTop(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const bar = document.querySelector('.square-topbar')?.getBoundingClientRect().bottom ?? 0
    window.scrollBy(0, document.querySelector('#compose')!.getBoundingClientRect().top - Math.max(0, bar))
  })
}

const composerParts = (page: import('@playwright/test').Page) => ({
  'the box': page.getByRole('textbox', { name: 'New post' }),
  'a poll choice': page.locator('#compose .composer-poll input'),
  'a toolbar button': page.locator('#compose .composer-toolbar button:not([role="dialog"] *)'),
  'an attached picture': page.locator('#compose .composer-images'),
})

test('the emoji picker moves when the composer grows under it: a poll or a photo added while it is open', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'emojigrow', { viewport: { width: 1280, height: 800 } })
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await box.fill(`${'A long draft that wraps over many lines of the box. '.repeat(21)}end`)
  await scrollComposerToTop(page)
  const picker = page.getByRole('dialog', { name: 'Emoji' })
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await expectPickerClearOf(picker, composerParts(page))
  expect((await rect(picker)).top).toBeGreaterThanOrEqual((await rect(page.locator('#compose .composer-toolbar'))).bottom)

  await page.getByRole('button', { name: 'Poll' }).click()
  await expect(page.getByPlaceholder('Choice 2')).toBeVisible()
  await expect(picker).toBeVisible()
  await expectPickerClearOf(picker, composerParts(page))

  await box.press('Escape')
  await expect(picker).toBeHidden()
  await page.getByRole('button', { name: 'Emoji', exact: true }).click()
  await expectPickerClearOf(picker, composerParts(page))
  await page.locator('#compose input[type="file"]:not([accept*="video"])').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('list', { name: 'Images' })).toBeVisible()
  await expect(picker).toBeVisible()
  await expectPickerClearOf(picker, composerParts(page))
  await context.close()
})

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** Where the caret's row is on screen, by laying out the text before the caret in a copy of the box. */
function caretRow(box: import('@playwright/test').Locator) {
  return box.evaluate((el: HTMLTextAreaElement) => {
    const copy = el.cloneNode() as HTMLTextAreaElement
    copy.style.cssText = `position:absolute;visibility:hidden;height:0;min-height:0;max-height:none;width:${el.offsetWidth}px`
    copy.value = el.value.slice(0, el.selectionEnd)
    el.parentNode!.appendChild(copy)
    const end = copy.scrollHeight - parseFloat(getComputedStyle(el).paddingBottom)
    copy.remove()
    const line = parseFloat(getComputedStyle(el).lineHeight)
    const r = el.getBoundingClientRect()
    const bottom = r.top + el.clientTop + end - el.scrollTop
    return { top: bottom - line, bottom, left: r.left, right: r.right, boxTop: r.top + el.clientTop, boxBottom: r.top + el.clientTop + el.clientHeight }
  })
}

const NEEDS_KEY = 'needs a web app built with a Giphy key; see the comment above "a GIF from Giphy with no words can be posted"'

/** Answers Giphy for `context`: `count` GIFs for any search, or a 500 for the first `failing` calls. Returns the call count. */
async function answerGiphy(context: import('@playwright/test').BrowserContext, { count = 6, failing = 0 } = {}) {
  const calls = { api: 0 }
  await context.route(/^https:\/\/[a-z0-9.-]*\bgiphy\.com\//, (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'api.giphy.com') return route.fulfill({ contentType: 'image/gif', body: gif() })
    calls.api++
    if (calls.api <= failing) return route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, json: { meta: { status: 500, msg: 'down' } } })
    const data = Array.from({ length: count }, (_, i) => {
      const id = `e2e${i}${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
      const rendition = { url: `https://media1.giphy.com/media/${id}/100w.gif`, width: '100', height: '100' }
      return { id, title: `Wave ${i + 1}`, type: 'gif', images: { fixed_width_small: rendition, fixed_width: rendition } }
    })
    return route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { data, pagination: { total_count: count, count, offset: 0 }, meta: { status: 200, msg: 'OK', response_id: 'e2e' } },
    })
  })
  return calls
}

const PICKERS = [
  { what: 'emoji picker', button: 'Emoji', dialog: 'Emoji', giphy: false },
  { what: 'GIF search', button: 'Search GIFs', dialog: 'Search GIFs', giphy: true },
]

for (const kind of PICKERS) for (const size of [{ width: 375, height: 667 }, { width: 375, height: 400 }]) {
  test(`on a ${size.width}x${size.height} touch screen the ${kind.what} leaves the caret's row of a long draft in view`, async ({ browser }) => {
    test.skip(kind.giphy && !process.env.NEXT_PUBLIC_GIPHY_API_KEY, NEEDS_KEY)
    const { page, handle, context } = await newMember(browser, 'pickcaret', { viewport: size, hasTouch: true, isMobile: true })
    if (kind.giphy) await answerGiphy(context)
    await page.goto('/')
    const box = page.getByRole('textbox', { name: 'New post' })
    await box.fill(`${handle}\n${lines(9)}`)
    await box.evaluate((el: HTMLTextAreaElement) => {
      el.setSelectionRange(el.value.length, el.value.length)
      el.blur()
    })
    await scrollComposerToTop(page)
    const before = await height(box)
    await page.getByRole('button', { name: kind.button, exact: true }).tap()
    const picker = page.getByRole('dialog', { name: kind.dialog })
    await expect(picker).toBeVisible()
    if (kind.giphy) await expect(picker.getByRole('button', { name: 'Wave 6' })).toBeAttached()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const [p, row] = [await rect(picker), await caretRow(box)]
    expect(overlaps(p, row), `picker ${Math.round(p.top)}-${Math.round(p.bottom)} covers the caret row ${Math.round(row.top)}-${Math.round(row.bottom)}`).toBe(false)
    expect(row.top).toBeGreaterThanOrEqual(row.boxTop - 1)
    expect(row.bottom).toBeLessThanOrEqual(row.boxBottom + 1)
    expect(row.top).toBeGreaterThanOrEqual(0)
    expect(row.bottom).toBeLessThanOrEqual(size.height)
    expect(p.height).toBeGreaterThanOrEqual(USABLE)

    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    expect(await height(box)).toBe(before)
    await context.close()
  })
}

test('a GIF search that opens upward goes above the box, not over it', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_GIPHY_API_KEY, NEEDS_KEY)
  const { page, context } = await newMember(browser, 'gifabove', { viewport: { width: 1280, height: 800 } })
  await answerGiphy(context)
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await box.fill(lines(12))
  const picker = page.getByRole('dialog', { name: 'Search GIFs' })
  await page.getByRole('button', { name: 'Search GIFs', exact: true }).click()
  await expect(picker.getByRole('button', { name: 'Wave 6' })).toBeAttached()
  await expectPickerClearOf(picker, composerParts(page))
  expect((await rect(picker)).bottom).toBeLessThanOrEqual((await rect(box)).top)
  await context.close()
})

test('tapping Search GIFs and a GIF on a touch screen leaves the box unfocused, so no on-screen keyboard opens', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_GIPHY_API_KEY, NEEDS_KEY)
  const { page, handle, context } = await newMember(browser, 'giftap', { viewport: PHONE, hasTouch: true, isMobile: true })
  await answerGiphy(context)
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Tap ${handle}`)
  await box.evaluate((el: HTMLTextAreaElement) => el.blur())
  await page.getByRole('button', { name: 'Search GIFs', exact: true }).tap()
  const picker = page.getByRole('dialog', { name: 'Search GIFs' })
  await expect(picker).toBeVisible()
  await expect(box).not.toBeFocused()
  await picker.getByRole('button', { name: 'Wave 1' }).tap()
  await expect(page.getByLabel('Description of GIF')).toHaveValue('Wave 1')
  await expect(box).not.toBeFocused()
  await context.close()
})

test('Try again right after GIPHY fails asks GIPHY again', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_GIPHY_API_KEY, NEEDS_KEY)
  const { page, context } = await newMember(browser, 'gifretry')
  const calls = await answerGiphy(context, { failing: 1 })
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  await page.getByRole('button', { name: 'Search GIFs', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Search GIFs' })
  await expect(picker.getByRole('alert')).toContainText('Could not load GIFs from GIPHY')
  expect(calls.api).toBe(1)
  await picker.getByRole('button', { name: 'Try again' }).click()
  await expect(picker.getByRole('button', { name: 'Wave 1' })).toBeVisible()
  expect(calls.api).toBe(2)
  await context.close()
})

test('the GIF search closes on Escape with focus on nothing, stays open when focus goes to nothing, and closes when Tab leaves it', async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_GIPHY_API_KEY, NEEDS_KEY)
  const { page, handle, context } = await newMember(browser, 'gifkeys')
  await answerGiphy(context, { count: 2 })
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.fill(`Keys ${handle}`)
  const toggle = page.getByRole('button', { name: 'Search GIFs', exact: true })
  const picker = page.getByRole('dialog', { name: 'Search GIFs' })
  const search = picker.getByRole('searchbox', { name: 'Search GIFs' })

  await toggle.click()
  await expect(picker).toBeVisible()
  await box.evaluate((el: HTMLTextAreaElement) => el.blur())
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()

  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(search).toBeFocused()
  await search.fill('wave')
  await search.evaluate((el: HTMLInputElement) => el.blur())
  await expect(picker).toBeVisible()
  await expect(search).toHaveValue('wave')

  await search.focus()
  await expect(picker.getByRole('button', { name: 'Wave 2' })).toBeVisible()
  const inSearch = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-label="Search GIFs"]'))
  for (let i = 0; i < 10 && (await inSearch()); i++) await page.keyboard.press('Tab')
  await expect(picker).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await context.close()
})
