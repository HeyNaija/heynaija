import { expect, type Page, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

test('the top bar holds no placeholder while the page streams in', async ({ page }) => {
  // The first thing the server sends: the account controls are still being fetched, and
  // the bar must not stand in for them with a grey shape that then turns into buttons.
  const html = await (await page.request.get('/')).text()
  const bar = html.match(/<header class="square-topbar">[\s\S]*?<\/header>/)?.[0]
  expect(bar).toContain('square-search')
  expect(bar).not.toContain('skeleton')
})

test('the feed sends room for its heading and tabs ahead of its placeholders', async ({ page }) => {
  // The heading and tabs wait only for who is looking, not for the posts, and while they
  // do the page keeps their room (invisible), so the placeholders start below it.
  const html = await (await page.request.get('/')).text()
  const main = html.slice(html.indexOf('id="main-content"'))
  const room = main.indexOf('inert=""')
  const firstPlaceholder = main.indexOf('class="skeleton')
  expect(room).toBeGreaterThan(-1)
  expect(main.slice(room, firstPlaceholder)).toContain('feed-tabs')
  expect(room).toBeLessThan(firstPlaceholder)
})

test('the sidebar sends its links and the room for its button before it knows who is looking', async ({ page }) => {
  // Who is looking is fetched after the first paint, but most of the sidebar is the
  // same for everyone: its links must already be in what the server sends first
  // (the part before the card; what is fetched later comes after the rest of the page).
  const html = await (await page.request.get('/')).text()
  const sidebar = html.slice(html.indexOf('class="square-sidebar"'))
  const first = sidebar.slice(0, sidebar.indexOf('sidebar-card-slot'))
  for (const href of ['/c', '/about', '/progress', '/governance', '/bookmarks', '/settings']) {
    expect(first, href).toContain(`href="${href}"`)
  }
  expect(first).toContain('sidebar-compose')
  // A member's Notifications row is kept, empty, so the links below it do not move.
  expect(first).toMatch(/class="sidebar-nav-item invisible"[^>]*>[\s\S]*?Notifications/)
  expect(first).not.toContain('aria-current')
})

/** The places an element has been drawn at, as `left,top`, in every frame from the start of the page. */
async function watchPlaces(page: Page, elements: Record<string, string>) {
  await page.addInitScript((selectors) => {
    const w = window as unknown as { places: Record<string, string[]> }
    w.places = {}
    const tick = () => {
      for (const [name, selector] of Object.entries(selectors)) {
        const box = document.querySelector(selector)?.getBoundingClientRect()
        if (!box || (box.width === 0 && box.height === 0)) continue
        const place = `${Math.round(box.left)},${Math.round(box.top)}`
        const seen = (w.places[name] ??= [])
        if (!seen.includes(place)) seen.push(place)
      }
      requestAnimationFrame(tick)
    }
    tick()
  }, elements)
  return () => page.evaluate(() => (window as unknown as { places: Record<string, string[]> }).places)
}

test('nothing in the sidebar moves when a member’s page fills in', async ({ browser }) => {
  const member = await newMember(browser, 'steady')
  try {
    const { page } = member
    await page.setViewportSize({ width: 1440, height: 1000 })
    const places = await watchPlaces(page, {
      more: '.sidebar-more summary',
      bookmarks: '.sidebar-nav-list a[href="/bookmarks"]',
      compose: '.sidebar-compose',
    })
    await page.goto('/')
    // The real links are in once the current page is marked.
    await expect(page.locator('.sidebar-nav-list > li[data-tier] a[aria-current="page"]')).toBeVisible()
    await expect(page.locator('.sidebar-compose')).toHaveAttribute('href', '/#compose')
    await page.waitForTimeout(300)
    const seen = await places()
    for (const name of ['more', 'bookmarks', 'compose']) expect(seen[name], name).toHaveLength(1)
  } finally {
    await member.context.close()
  }
})

test('nothing in the top bar moves when a member’s account menu arrives on a phone', async ({ browser }) => {
  const member = await newMember(browser, 'phonebar')
  try {
    const { page } = member
    await page.setViewportSize({ width: 390, height: 844 })
    const places = await watchPlaces(page, {
      governance: '.square-topbar a[aria-label="Governance"]',
      search: '.square-topbar a[aria-label="Search"]',
    })
    await page.goto('/')
    await expect(page.getByLabel('Account menu')).toBeVisible()
    await page.waitForTimeout(300)
    const seen = await places()
    for (const name of ['governance', 'search']) expect(seen[name], name).toHaveLength(1)
  } finally {
    await member.context.close()
  }
})

test('moving to the feed never draws placeholders where its heading and tabs go', async ({ browser }) => {
  const member = await newMember(browser, 'header')
  try {
    const { page } = member
    await page.goto('/notifications')
    await page.waitForURL((url) => url.pathname === '/notifications')
    await page.waitForLoadState('networkidle')
    // Watch every frame from here: whenever placeholders are on screen, the heading and
    // tabs (or their room) must be above them.
    await page.evaluate(() => {
      const w = window as unknown as { wrong: string[] }
      w.wrong = []
      const tick = () => {
        const placeholder = document.querySelector('.square-feed .skeleton')
        if (placeholder) {
          const tabs = document.querySelector('.square-feed .home-feed .feed-tabs')
          if (!tabs) w.wrong.push('placeholders with no heading and tabs above them')
          else if (placeholder.getBoundingClientRect().top < tabs.getBoundingClientRect().bottom - 1) w.wrong.push('placeholders over the tabs')
        }
        requestAnimationFrame(tick)
      }
      tick()
    })
    await page.locator('.square-sidebar').getByRole('link', { name: 'Home', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByRole('navigation', { name: 'Feeds' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your town square' })).toBeVisible()
    // Let the posts arrive too, then read what the frames saw.
    await expect(page.locator('.square-feed .skeleton')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { wrong: string[] }).wrong)).toEqual([])
  } finally {
    await member.context.close()
  }
})

test('placeholders wait a moment before they show, so a quick load does not flash them', async ({ page }) => {
  await page.goto('/about')
  const opacity = () => page.evaluate(() => {
    let probe = document.getElementById('skeleton-probe')
    if (!probe) {
      probe = document.createElement('div')
      probe.id = 'skeleton-probe'
      probe.className = 'skeleton'
      probe.style.height = '10px'
      document.body.append(probe)
    }
    return Number(getComputedStyle(probe).opacity)
  })
  expect(await opacity()).toBe(0)
  await expect.poll(opacity).toBeGreaterThan(0.4)
})
