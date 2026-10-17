import { type Browser, expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'
import { expectNoHorizontalScroll, expectOnScreen } from '../lib/layout.ts'

/** A signed-out browser, the way someone opening a shared link arrives. */
async function visitor(browser: Browser, init?: () => void) {
  const use = test.info().project.use
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  })
  if (init) await context.addInitScript(init)
  return context
}

test('a visitor copies a post link from the custom popup without opening the post @mobile', async ({ browser }) => {
  const author = await newMember(browser, 'sharer')
  const text = `Worth sharing, from ${author.handle}`
  const created = await post(author.page, text)
  const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
  await author.context.close()

  const context = await visitor(browser)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  try {
    await page.goto(`/u/${author.handle}`)
    const share = page.locator(`#post-${id}`).getByRole('button', { name: 'Share post', exact: true })
    await share.click()
    const popup = page.getByRole('dialog', { name: 'Share post', exact: true })
    await expect(popup).toContainText(text)
    await expect(popup.locator('.share-preview-name')).toHaveText(`@${author.handle}`)
    await expect(popup.getByRole('textbox', { name: 'Post link' })).toHaveValue(new URL(`/p/${id}`, page.url()).href)
    await expect(popup.getByRole('status')).toBeEmpty()

    await popup.getByRole('button', { name: 'Copy link', exact: true }).click()
    await expect(popup.getByRole('status')).toHaveText('Link copied')
    await expect(popup.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
    await expect(page).toHaveURL((url) => url.pathname === `/u/${author.handle}`)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/p/${id}`, page.url()).href)
    await expect(popup.getByRole('status')).toBeEmpty()
    await popup.getByRole('button', { name: 'Close share popup' }).click()
    await expect(popup).toBeHidden()
    await expect(share).toBeFocused()
  } finally {
    await context.close()
  }
})

test('the custom share popup bypasses native sharing and fits every viewport and theme @mobile', async ({ browser }) => {
  const author = await newMember(browser, 'popup')
  const text = `Pepper & jollof? 100% yes! 🇳🇬 ${author.handle}`
  const created = await post(author.page, text)
  const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
  await author.context.close()

  const context = await visitor(browser, () => {
    Object.assign(window, { nativeShareCalls: 0, clipboardWrites: 0 })
    Object.defineProperty(Navigator.prototype, 'share', {
      value: async () => { (window as unknown as { nativeShareCalls: number }).nativeShareCalls++ },
    })
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      value: { writeText: async () => { (window as unknown as { clipboardWrites: number }).clipboardWrites++ } },
    })
  })
  const page = await context.newPage()
  try {
    await page.goto(`/p/${id}`)
    const share = page.locator(`#post-${id}`).getByRole('button', { name: 'Share post', exact: true })
    await share.click()
    const popup = page.getByRole('dialog', { name: 'Share post', exact: true })
    const close = popup.getByRole('button', { name: 'Close share popup' })
    await expect(close).toBeFocused()
    await expect(share).toHaveAttribute('aria-expanded', 'true')

    const url = new URL(`/p/${id}`, page.url()).href
    const shareText = `${text}\n\n@${author.handle} on HeyNaija`
    const whatsapp = new URL((await popup.getByRole('link', { name: /^Share on WhatsApp/ }).getAttribute('href'))!)
    expect(whatsapp.origin).toBe('https://wa.me')
    expect(whatsapp.searchParams.get('text')).toBe(`${shareText}\n${url}`)
    const x = new URL((await popup.getByRole('link', { name: /^Share on X / }).getAttribute('href'))!)
    expect(x.origin + x.pathname).toBe('https://twitter.com/intent/tweet')
    expect(x.searchParams.get('url')).toBe(url)
    expect(x.searchParams.get('text')).toBe(shareText)
    const telegram = new URL((await popup.getByRole('link', { name: /^Share on Telegram/ }).getAttribute('href'))!)
    expect(telegram.origin + telegram.pathname).toBe('https://t.me/share/url')
    expect(telegram.searchParams.get('url')).toBe(url)
    expect(telegram.searchParams.get('text')).toBe(shareText)
    const facebook = new URL((await popup.getByRole('link', { name: /^Share on Facebook/ }).getAttribute('href'))!)
    expect(facebook.origin + facebook.pathname).toBe('https://www.facebook.com/sharer/sharer.php')
    expect(facebook.searchParams.get('u')).toBe(url)

    // Tab and Shift+Tab stay inside the popup; the feed cannot take focus.
    await page.keyboard.press('Shift+Tab')
    await expect(popup.getByRole('button', { name: 'Copy link', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()

    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 850 })
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme)
        await expectOnScreen(popup)
        await expectOnScreen(close)
        await expectOnScreen(popup.getByRole('button', { name: 'Copy link', exact: true }))
        for (const link of await popup.getByRole('link').all()) await expectOnScreen(link)
        await expectNoHorizontalScroll(popup)
        expect(await popup.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
        const bounds = (await popup.boundingBox())!
        if (width < 640) expect(Math.abs(bounds.y + bounds.height - 850)).toBeLessThanOrEqual(1)
        else {
          // The page reserves a scrollbar gutter even while modal scrolling is locked.
          const margins = await popup.evaluate((node) => {
            const style = getComputedStyle(node)
            return { left: Number.parseFloat(style.marginLeft), right: Number.parseFloat(style.marginRight) }
          })
          expect(margins.left).toBeGreaterThan(0)
          expect(Math.abs(margins.left - margins.right)).toBeLessThanOrEqual(1)
        }
        if (width === 390 || width === 1280) {
          const screenshot = test.info().outputPath(`share-${width}-${theme}.png`)
          await page.screenshot({ path: screenshot })
          await test.info().attach(`share-${width}-${theme}`, { path: screenshot, contentType: 'image/png' })
        }
      }
    }

    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await expect(share).toBeFocused()
    await expect(share).toHaveAttribute('aria-expanded', 'false')
    await share.click()
    // Tapping inside does not dismiss; tapping the backdrop does.
    await popup.getByRole('heading', { name: 'Share post' }).click()
    await expect(popup).toBeVisible()
    await page.mouse.click(8, 8)
    await expect(popup).toBeHidden()
    await expect(share).toBeFocused()
    expect(await page.evaluate(() => ({
      native: (window as unknown as { nativeShareCalls: number }).nativeShareCalls,
      copies: (window as unknown as { clipboardWrites: number }).clipboardWrites,
    }))).toEqual({ native: 0, copies: 0 })

    // Check the handoff in a new tab without contacting or posting to another service.
    await share.click()
    await context.route('https://t.me/share/url?**', (route) => route.fulfill({ contentType: 'text/plain', body: 'Share destination' }))
    const opened = page.waitForEvent('popup')
    await popup.getByRole('link', { name: /^Share on Telegram/ }).click()
    const destination = await opened
    await expect(destination).toHaveURL(telegram.href)
    await destination.close()
    await expect(page).toHaveURL((current) => current.pathname === `/p/${id}`)
  } finally {
    await context.close()
  }
})

for (const fallbackWorks of [true, false]) {
  test(`copying ${fallbackWorks ? 'falls back inside the modal' : 'offers a selected link when copying is blocked'} @mobile`, async ({ browser }) => {
    const author = await newMember(browser, 'copy')
    const created = await post(author.page, `Copy me, ${author.handle}`)
    const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
    await author.context.close()

    const context = await visitor(browser)
    await context.addInitScript((fallbackWorks) => {
      Object.assign(window, { fallbackInsideModal: false, fallbackText: '' })
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        value: { writeText: async () => { throw new DOMException('Clipboard blocked', 'NotAllowedError') } },
      })
      document.execCommand = () => {
        const field = document.activeElement as HTMLTextAreaElement
        Object.assign(window, {
          fallbackInsideModal: !!field.closest('dialog[open]'),
          fallbackText: field.value,
        })
        return fallbackWorks
      }
    }, fallbackWorks)
    const page = await context.newPage()
    try {
      await page.goto(`/u/${author.handle}`)
      await page.locator(`#post-${id}`).getByRole('button', { name: 'Share post', exact: true }).click()
      const popup = page.getByRole('dialog', { name: 'Share post', exact: true })
      await popup.getByRole('button', { name: 'Copy link', exact: true }).click()
      expect(await page.evaluate(() => (window as unknown as { fallbackInsideModal: boolean }).fallbackInsideModal)).toBe(true)
      expect(await page.evaluate(() => (window as unknown as { fallbackText: string }).fallbackText)).toBe(new URL(`/p/${id}`, page.url()).href)
      if (fallbackWorks) {
        await expect(popup.getByRole('status')).toHaveText('Link copied')
      } else {
        await expect(popup.getByRole('status')).toContainText('Could not copy')
        const field = popup.getByRole('textbox', { name: 'Post link' })
        await expect(field).toBeFocused()
        expect(await field.evaluate((node: HTMLInputElement) => node.value.slice(node.selectionStart!, node.selectionEnd!))).toBe(new URL(`/p/${id}`, page.url()).href)
      }
    } finally {
      await context.close()
    }
  })
}

test('a post link previews its author and text where WhatsApp reads it', async ({ browser, request }) => {
  const author = await newMember(browser, 'preview')
  const text = `Jollof is better with   plenty pepper, says ${author.handle}`
  const created = await post(author.page, text)
  const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
  await author.context.close()

  // Link-preview fetchers do not run JavaScript, so the tags must be in the HTML head.
  const res = await request.get(`/p/${id}`, { headers: { 'user-agent': 'WhatsApp/2.24.1.6 A' } })
  expect(res.ok()).toBe(true)
  const [head = ''] = (await res.text()).split('</head>')
  const meta = (property: string) => head.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1]
  expect(meta('og:title')).toBe(`@${author.handle} on HeyNaija`)
  expect(meta('og:description')).toBe(text.replace(/\s+/g, ' '))
  expect(meta('og:url')).toMatch(new RegExp(`^https?://[^/]+/p/${id}$`))
  // No photo on the post, so the site's own picture, as an absolute URL.
  expect(meta('og:image')).toMatch(/^https?:\/\/[^/]+\/brand\/community-conversation\.jpg$/)
})
