import { type Browser, expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

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

test('a visitor copies a post link from a card without opening the post', async ({ browser }) => {
  const author = await newMember(browser, 'sharer')
  const created = await post(author.page, `Worth sharing, from ${author.handle}`)
  const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
  await author.context.close()

  // Desktop Chrome on some systems has a share sheet; this test is about copying.
  const context = await visitor(browser, () => {
    Object.defineProperty(Navigator.prototype, 'share', { value: undefined })
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  try {
    await page.goto(`/u/${author.handle}`)
    const card = page.locator(`#post-${id}`)
    const status = card.getByRole('status')
    await expect(status).toBeEmpty()

    await card.getByRole('button', { name: 'Copy link', exact: true }).click()
    await expect(status).toHaveText('Link copied')
    await expect(page).toHaveURL((url) => url.pathname === `/u/${author.handle}`)
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toBe(new URL(`/p/${id}`, page.url()).href)
    // The note goes away by itself.
    await expect(status).toBeEmpty()
  } finally {
    await context.close()
  }
})

test('a phone opens the share sheet with the post link, and closing it copies nothing @mobile', async ({ browser }) => {
  const author = await newMember(browser, 'sheet')
  const text = `Send this to the group chat, from ${author.handle}`
  const created = await post(author.page, text)
  const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
  await author.context.close()

  // A stand-in for the system share sheet: it records what it was given, and the
  // second time it is dismissed the way a person closing the sheet would.
  const context = await visitor(browser, () => {
    const calls: ShareData[] = []
    Object.assign(window, { shareCalls: calls })
    Object.defineProperty(Navigator.prototype, 'share', {
      value: async (data: ShareData) => {
        calls.push(data)
        if (calls.length > 1) throw new DOMException('Share canceled', 'AbortError')
      },
    })
  })
  const page = await context.newPage()
  try {
    await page.goto(`/p/${id}`)
    const card = page.locator(`#post-${id}`)
    const share = card.getByRole('button', { name: 'Share', exact: true })

    await share.click()
    const calls = () => page.evaluate(() => (window as unknown as { shareCalls: ShareData[] }).shareCalls)
    await expect.poll(calls).toEqual([
      { url: new URL(`/p/${id}`, page.url()).href, title: `@${author.handle} on HeyNaija`, text },
    ])

    await share.click()
    await expect.poll(async () => (await calls()).length).toBe(2)
    await expect(card.getByRole('status')).toBeEmpty()
  } finally {
    await context.close()
  }
})

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
