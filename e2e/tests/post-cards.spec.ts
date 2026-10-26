import { expect, test } from '@playwright/test'
import { seedThread } from '../lib/db.ts'
import { newMember, post } from '../lib/members.ts'

test('opens a feed post from blank padding, header space and body text @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'cards')
  try {
    const text = `Card navigation from ${handle}`
    const created = await post(page, text)
    const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
    for (const surface of ['padding', 'header', 'body']) {
      await page.goto('/')
      const card = page.locator(`#post-${id}`)
      await expect(card).toBeVisible()
      // Positions are relative to the card: the card-wide link covers the header,
      // so Playwright would refuse a click aimed at the header element itself.
      const at = async (selector: string, dx: number, dy?: number) => {
        const [outer, inner] = await Promise.all([card.boundingBox(), card.locator(selector).boundingBox()])
        return { x: inner!.x - outer!.x + dx, y: inner!.y - outer!.y + (dy ?? inner!.height / 2) }
      }
      if (surface === 'padding') await card.click({ position: { x: 4, y: 4 } })
      // The 12px gap between the 42px avatar and author is blank header space.
      else if (surface === 'header') await card.click({ position: await at('.post-header', 48, 8) })
      else await card.locator('.post-body').click()
      await expect(page).toHaveURL((url) => url.pathname === `/p/${id}`)
      await expect(page.locator(`#post-${id}.is-focused`)).toBeVisible()
    }
  } finally {
    await context.close()
  }
})

test('clicking a reply card focuses its own conversation without sibling replies @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'focus')
  try {
    const fixture = await seedThread(handle)
    // Reply 01 is the oldest of 25: oldest first keeps it on the first page.
    await page.goto(`/p/${fixture.root}?replies=oldest`)
    await page.locator(`#post-${fixture.first}`).click({ position: { x: 4, y: 4 } })
    await expect(page).toHaveURL((url) => url.pathname === `/p/${fixture.first}`)
    await expect(page.locator(`#post-${fixture.first}.is-focused`)).toBeVisible()
    const replies = page.locator(`section#replies-${fixture.first}`)
    await expect(replies).toBeVisible()
    await expect(replies.locator('article')).toHaveCount(2)
    const displayed = await replies.locator('article').evaluateAll((nodes) => nodes.map((node) => node.id.replace(/^post-/, '')))
    expect(displayed.sort()).toEqual([...fixture.nested].sort())
    await expect(replies.locator(`#post-${fixture.bridgeParent}`)).toHaveCount(0)
    await expect(replies.locator(`#post-${fixture.root}`)).toHaveCount(0)
    // The original root stays visible above, as the post being replied to.
    await expect(page.locator(`.thread-immediate-parent #post-${fixture.root}`)).toHaveCount(1)
  } finally {
    await context.close()
  }
})

test('reply card controls keep their actions without opening the card @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'controls')
  try {
    const fixture = await seedThread(handle)
    // Reply 01 is the oldest of 25: oldest first keeps it on the first page.
    await page.goto(`/p/${fixture.root}?replies=oldest`)
    const url = page.url()
    const card = page.locator(`#post-${fixture.first}`)
    await card.getByRole('button', { name: 'Like (0 likes)', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Unlike (1 like)', exact: true })).toBeVisible()
    await expect(page).toHaveURL(url)

    await card.getByLabel('Post options', { exact: true }).click()
    await card.getByRole('button', { name: 'Bookmark', exact: true }).click()
    await expect(card.getByRole('button', { name: 'Remove bookmark', exact: true, includeHidden: true })).toHaveCount(1)
    await expect(page).toHaveURL(url)
    await page.keyboard.press('Escape')

    await card.getByLabel('Post options', { exact: true }).click()
    await expect(card.getByRole('button', { name: 'Delete post', exact: true })).toBeVisible()
    await expect(page).toHaveURL(url)
    await page.keyboard.press('Escape')
    await expect(card.getByRole('button', { name: 'Delete post', exact: true })).toBeHidden()

    await card.getByRole('link', { name: /^Reply \(/ }).click()
    await expect(page.locator('form#compose input[name="replyTo"]')).toHaveValue(fixture.first)
    await expect(page.getByRole('textbox', { name: 'Your reply' })).toBeFocused()
    await expect(page).toHaveURL(url)
  } finally {
    await context.close()
  }
})

test('card text remains selectable and the conversation link supports keyboard and modified clicks', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'native')
  try {
    const text = `Selectable conversation text from ${handle}`
    const created = await post(page, text)
    const id = (await created.getAttribute('id'))!.replace(/^post-/, '')
    const card = page.locator(`#post-${id}`)
    const body = card.locator('.post-body')
    await body.scrollIntoViewIfNeeded()
    const bounds = (await body.boundingBox())!
    const lineHeight = await body.evaluate((node) => Number.parseFloat(getComputedStyle(node).lineHeight))
    const url = page.url()
    await page.mouse.move(bounds.x + 3, bounds.y + lineHeight / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + Math.min(bounds.width - 3, 230), bounds.y + lineHeight / 2, { steps: 20 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim() ?? '')).not.toBe('')
    await expect(page).toHaveURL(url)
    await page.evaluate(() => window.getSelection()?.removeAllRanges())

    // A real link preserves browser new-tab behavior and native keyboard access.
    const permalink = card.locator('a.post-primary-link')
    await expect(permalink).toHaveAttribute('href', `/p/${id}`)
    const opened = context.waitForEvent('page')
    await permalink.click({ modifiers: ['ControlOrMeta'] })
    const other = await opened
    await other.waitForURL((target) => target.pathname === `/p/${id}`)
    await expect(page).toHaveURL(url)
    await other.close()

    await permalink.focus()
    await expect(permalink).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL((target) => target.pathname === `/p/${id}`)
  } finally {
    await context.close()
  }
})
