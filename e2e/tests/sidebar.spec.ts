import { expect, test, type Page } from '@playwright/test'
import { expectOnScreen } from '../lib/layout.ts'
import { newMember } from '../lib/members.ts'

async function expectWholeCard(page: Page) {
  const sidebar = page.locator('.square-sidebar')
  await expectOnScreen(sidebar.locator('.ownership-illustration'))
  await expectOnScreen(sidebar.getByRole('link', { name: 'Get to know HeyNaija' }))
  await expectOnScreen(sidebar.getByText('Real people. Real conversations.'))
}

test('a visitor sees the whole sidebar without scrolling on a 1440×900 window', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expectWholeCard(page)
})

// Members have Notifications too, so on 1440×900 the sidebar runs about 20px over and scrolls.
test('a member sees the whole sidebar on 1920×1080, and can still reach every link on 1280×720', async ({ browser }) => {
  const member = await newMember(browser, 'sidebar')
  try {
    const { page } = member
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/')
    await expectWholeCard(page)

    // Too short for everything: the image shrinks to its floor, then the sidebar scrolls.
    await page.setViewportSize({ width: 1280, height: 720 })
    const sidebar = page.locator('.square-sidebar')
    const image = sidebar.locator('.ownership-illustration')
    await expect.poll(() => image.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(56)
    for (const link of [sidebar.getByRole('link', { name: 'Settings' }), sidebar.getByRole('link', { name: 'New post' })]) {
      await link.scrollIntoViewIfNeeded()
      await expectOnScreen(link)
    }
  } finally {
    await member.context.close()
  }
})
