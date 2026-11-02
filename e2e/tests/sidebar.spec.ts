import { expect, test, type Page } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { expectOnScreen } from '../lib/layout.ts'
import { newMember } from '../lib/members.ts'

type Look = {
  /** Links drawn in the list, and the ones moved into More. */
  listed: string[]
  moved: string[]
  more: boolean
  card: boolean
  picture: number
  /** Everything that is wrong with what the sidebar shows right now. */
  problems: string[]
}

/** The sidebar as it is drawn at the window's current size, and what is wrong with it. */
async function look(page: Page): Promise<Look> {
  // Container queries answer on the next frame after a resize.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  return page.evaluate(() => {
    const sidebar = document.querySelector('.square-sidebar')!
    const rect = (selector: string) => sidebar.querySelector(selector)!.getBoundingClientRect()
    const drawn = (el: Element | null) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0
    // The link's own words: its text nodes, without the icon or the unread count.
    const name = (el: Element) =>
      Array.from(el.querySelector('a')!.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim()

    // Every link is in the list and, as a copy, in the More menu, in the same order.
    const inList = Array.from(sidebar.querySelectorAll('.sidebar-nav-list > li[data-tier]'))
    const inMore = Array.from(sidebar.querySelectorAll('.sidebar-more-panel > [data-tier]'))
    const listed: string[] = []
    const moved: string[] = []
    const problems: string[] = []
    inList.forEach((item, i) => {
      const label = name(item)
      const there = getComputedStyle(inMore[i]!).display !== 'none'
      const here = drawn(item)
      if (here) listed.push(label)
      if (there) moved.push(label)
      if (here === there) problems.push(here ? `${label} is in the list and in More` : `${label} is nowhere`)
    })
    const more = drawn(sidebar.querySelector('.sidebar-more'))
    if (more !== moved.length > 0) problems.push(`More is ${more ? 'shown' : 'hidden'} with ${moved.length} links in it`)
    if (moved.length === 1) problems.push(`More holds only ${moved[0]}, which would have fitted in its place`)

    if (sidebar.scrollHeight > sidebar.clientHeight) problems.push('the sidebar scrolls')
    const body = rect('.sidebar-body')
    const compose = rect('.sidebar-compose')
    if (compose.top < rect('.sidebar-nav').bottom) problems.push('the compose button overlaps the links')
    if (compose.bottom > body.bottom + 0.5) problems.push('the compose button runs out of the sidebar')
    const card = drawn(sidebar.querySelector('.ownership-card'))
    if (card) {
      if (rect('.ownership-card').top < compose.bottom) problems.push('the card overlaps the compose button')
      if (rect('.sidebar-footer').bottom > body.bottom + 0.5) problems.push('the footer runs out of the sidebar')
      // The words sit inside the card, not against its edge.
      if (Number.parseFloat(getComputedStyle(sidebar.querySelector('.ownership-copy')!).paddingLeft) < 12) problems.push('the card text touches the card edge')
    }
    const picture = sidebar.querySelector('.ownership-illustration')
    const height = drawn(picture) ? Math.round(picture!.getBoundingClientRect().height) : 0
    if (![0, 56, 108].includes(height)) problems.push(`the card picture is ${height}px tall`)
    return { listed, moved, more, card, picture: height, problems }
  })
}

/** Shrink the window from 1100px to 360px tall and report whatever goes wrong with the sidebar on the way. */
async function sweep(page: Page) {
  const wrong: string[] = []
  let before: Look | undefined
  for (let height = 1100; height >= 360; height -= 20) {
    await page.setViewportSize({ width: 1440, height })
    const now = await look(page)
    for (const problem of now.problems) wrong.push(`${height}px: ${problem}`)
    // A shorter window never brings anything back.
    if (before && now.listed.length > before.listed.length) wrong.push(`${height}px: more links are listed than at ${height + 20}px`)
    if (before && !before.card && now.card) wrong.push(`${height}px: the card is back`)
    if (before && before.card && now.picture > before.picture) wrong.push(`${height}px: the card picture grew from ${before.picture}px to ${now.picture}px`)
    before = now
  }
  return wrong
}

test('a visitor on a tall window sees every link, including the ideas board, without More', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 })
  await page.goto('/')
  await expect(page.locator('a.sidebar-compose')).toBeVisible()
  const now = await look(page)
  expect(now.problems).toEqual([])
  expect(now.listed).toEqual(['Home', 'Communities', 'About HeyNaija', 'Progress', 'Governance', 'Ideas board', 'Bookmarks', 'Settings'])
  expect(now.moved).toEqual([])
  expect(now.more).toBe(false)
  expect(now.card).toBe(true)
  expect(now.picture).toBe(108)
  await expectOnScreen(page.locator('.square-sidebar').getByText('Real people. Real conversations.'))
  await page.locator('.square-sidebar').getByRole('link', { name: 'Ideas board' }).click()
  await page.waitForURL((url) => url.pathname === '/ideas')
})

test('a member on 1280×720 sees the everyday links and the compose button', async ({ browser }) => {
  const member = await newMember(browser, 'sidebar')
  try {
    const { page } = member
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await expect(page.locator('a.sidebar-compose')).toBeVisible()
    const now = await look(page)
    expect(now.problems).toEqual([])
    expect(now.listed).toEqual(['Home', 'Communities', 'Notifications', 'About HeyNaija', 'Progress', 'Governance', 'Ideas board', 'Bookmarks', 'Settings'])
    expect(now.moved).toEqual([])
    expect(now.more).toBe(false)
    expect(now.card).toBe(false)
    await expectOnScreen(page.locator('.square-sidebar').getByRole('link', { name: 'New post' }))
  } finally {
    await member.context.close()
  }
})

test('at any window height the sidebar fits, loses no link and keeps the order of what gives way', async ({ browser }) => {
  const member = await newMember(browser, 'fits')
  try {
    await member.page.goto('/')
    await expect(member.page.locator('a.sidebar-compose')).toBeVisible()
    expect(await sweep(member.page)).toEqual([])
  } finally {
    await member.context.close()
  }
})

test('a moderator has a member’s sidebar, and Moderation in the account menu', async ({ browser }) => {
  const moderator = await newMember(browser, 'fitsmod')
  try {
    grantModerator(moderator.handle)
    const { page } = moderator
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    await expect(page.locator('a.sidebar-compose')).toBeVisible()
    // The same rows as the first paint, which is drawn for a member (shell.tsx).
    const now = await look(page)
    expect(now.problems).toEqual([])
    expect(now.listed).toEqual(['Home', 'Communities', 'Notifications', 'About HeyNaija', 'Progress', 'Governance', 'Ideas board', 'Bookmarks', 'Settings'])
    expect(now.more).toBe(false)
    await page.getByLabel('Account menu').click()
    await page.locator('.account-menu-panel').getByRole('link', { name: 'Moderation' }).click()
    await page.waitForURL((url) => url.pathname === '/mod')
  } finally {
    await moderator.context.close()
  }
})

test('More holds the links that do not fit and opens above its button', async ({ browser }) => {
  const member = await newMember(browser, 'more')
  try {
    const { page } = member
    await page.setViewportSize({ width: 1280, height: 480 })
    await page.goto('/')
    const sidebar = page.locator('.square-sidebar')
    const more = sidebar.getByLabel('More', { exact: true })
    await expect(more).toBeVisible()
    // Several lower-priority links moved together; Home and the essentials remain in the list.
    await expect(sidebar.getByRole('link', { name: 'About HeyNaija' })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: 'Home', exact: true })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'Ideas board' })).toBeVisible()
    await expectOnScreen(sidebar.getByRole('link', { name: 'New post' }))
    // Home is in the list, so More is not the current page.
    await expect(more).toHaveCSS('font-weight', '500')

    await more.click()
    const panel = sidebar.locator('.sidebar-more-panel')
    await expectOnScreen(panel.getByRole('link', { name: 'About HeyNaija' }))
    await expectOnScreen(panel.getByRole('link', { name: 'Progress' }))
    await expect(panel.getByRole('link', { name: 'Home', exact: true })).toHaveCount(0)
    const [panelBox, buttonBox] = await Promise.all([panel.boundingBox(), more.boundingBox()])
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(buttonBox!.y + 1)

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(more).toBeFocused()

    await more.click()
    await panel.getByRole('link', { name: 'Progress' }).click()
    await page.waitForURL((url) => url.pathname === '/progress')
    await expect(panel).toBeHidden()
    // Progress is in More, so More is marked as the current page.
    await expect(more).toHaveCSS('font-weight', '700')
    await more.click()
    await expect(panel.getByRole('link', { name: 'Progress' })).toHaveAttribute('aria-current', 'page')
  } finally {
    await member.context.close()
  }
})

test('on a very short window every link is still in reach through More', async ({ browser }) => {
  const member = await newMember(browser, 'short')
  try {
    const { page } = member
    await page.setViewportSize({ width: 1280, height: 420 })
    await page.goto('/')
    const sidebar = page.locator('.square-sidebar')
    // The links are drawn at once and replaced when the member is known (shell.tsx);
    // a More menu opened before that goes away with the links it was drawn with.
    await expect(sidebar.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page')
    const more = sidebar.getByLabel('More', { exact: true })
    await more.click()
    const links = sidebar.locator('.sidebar-more-panel').getByRole('link')
    expect(await links.count()).toBeGreaterThanOrEqual(5)
    for (const link of await links.all()) await expectOnScreen(link)
    await sidebar.locator('.sidebar-more-panel').getByRole('link', { name: 'Settings' }).click()
    await page.waitForURL((url) => url.pathname === '/settings')
  } finally {
    await member.context.close()
  }
})

test('the unread dot moves to More when Notifications does', async ({ browser }) => {
  const author = await newMember(browser, 'noted')
  const reader = await newMember(browser, 'reader')
  try {
    // Following someone is a notification for them.
    await reader.page.goto(`/u/${author.handle}`)
    await reader.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()
    await expect(reader.page.getByRole('main').getByRole('button', { name: 'Following' })).toBeVisible()

    const { page } = author
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')
    const sidebar = page.locator('.square-sidebar')
    await expect(sidebar.getByRole('link', { name: /Notifications/ }).locator('.unread-badge')).toBeVisible()
    await expect(sidebar.locator('summary .unread-dot')).toBeHidden()

    await page.setViewportSize({ width: 1280, height: 380 })
    await expect(sidebar.getByRole('link', { name: /Notifications/ })).toHaveCount(0)
    await expect(sidebar.locator('summary .unread-dot')).toBeVisible()
    await sidebar.getByLabel('More', { exact: true }).click()
    await expect(sidebar.locator('.sidebar-more-panel').getByRole('link', { name: /Notifications/ }).locator('.unread-badge')).toBeVisible()
  } finally {
    await author.context.close()
    await reader.context.close()
  }
})
