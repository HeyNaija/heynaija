import { expect, test } from '@playwright/test'
import { expectNoHorizontalScroll, expectOnScreen } from '../lib/layout.ts'
import { newMember, post } from '../lib/members.ts'

test('profile, post, repost and account menus stay inside the viewport @mobile', async ({ browser }) => {
  const member = await newMember(browser, 'profile')
  const reader = await newMember(browser, 'menus')
  try {
    const text = `Menu checks from ${member.handle}`
    await post(member.page, text)
    for (const width of [320, 390, 768, 1280]) {
      await reader.page.setViewportSize({ width, height: 844 })
      await reader.page.goto(`/u/${member.handle}`)
      const more = reader.page.getByLabel('More options', { exact: true })
      await more.click()
      await expectOnScreen(reader.page.getByRole('button', { name: 'Mute', exact: true }))
      await expectOnScreen(reader.page.getByRole('button', { name: 'Block', exact: true }))
      await expectOnScreen(reader.page.getByRole('link', { name: 'Report account' }))
      await expectNoHorizontalScroll(more)
      await reader.page.keyboard.press('Escape')
      await expect(more).toBeFocused()

      const card = reader.page.locator('article', { hasText: text })
      await card.getByLabel('Post options', { exact: true }).click()
      await expectOnScreen(card.getByRole('link', { name: 'Report post', exact: true }))
      await expectOnScreen(card.getByRole('button', { name: `Block @${member.handle}`, exact: true }))
      await reader.page.keyboard.press('Escape')
      await card.getByLabel('Repost or quote (0 reposts)', { exact: true }).click()
      await expectOnScreen(card.getByRole('link', { name: 'Quote', exact: true }))
      await reader.page.keyboard.press('Escape')
      await reader.page.getByLabel('Account menu', { exact: true }).click()
      await expectOnScreen(reader.page.locator('.account-menu-panel'))
      await expectNoHorizontalScroll(more)
      await reader.page.keyboard.press('Escape')
    }

    // Choosing a profile action still works after collision adjustment.
    await reader.page.setViewportSize({ width: 320, height: 844 })
    await reader.page.goto(`/u/${member.handle}`)
    await reader.page.getByLabel('More options', { exact: true }).click()
    await reader.page.getByRole('button', { name: 'Mute', exact: true }).click()
    await expect(reader.page.getByText(`You muted @${member.handle}. Their posts only show here.`)).toBeVisible()
  } finally {
    await member.context.close()
    await reader.context.close()
  }
})

test('an open post menu stays below the sticky navigation while scrolling @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'layers')
  try {
    const first = `Scrolling post from ${handle}`
    const text = [first, ...Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`)].join('\n')
    // A list shows only the first 8 lines of a post this long (apps/web/lib/post-length.ts),
    // still a tall card, so it is found by its first line.
    const card = await post(page, text, undefined, first)
    for (const label of ['Repost or quote (0 reposts)', 'Post options']) {
      await card.evaluate((node) => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 150))
      await card.getByLabel(label, { exact: true }).click()
      await expect(card.locator('details[open] .menu-panel')).toBeVisible()
      // Scroll the open post underneath both sticky bars.
      await card.evaluate((node) => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 20))
      for (const selector of ['.square-topbar', '.feed-tabs']) {
        await expect.poll(() => page.locator(selector).evaluate((bar) => {
          const rect = bar.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          return !!hit && bar.contains(hit)
        })).toBe(true)
      }
      // Return the menu to the content area before checking its actions.
      await card.evaluate((node) => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 150))
      await expectOnScreen(card.locator('details[open] .menu-item').last())
      await page.keyboard.press('Escape')
    }
  } finally {
    await context.close()
  }
})
