import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

const registry = JSON.parse(await readFile(new URL('../../docs/feature-roadmap.json', import.meta.url), 'utf8')) as {
  features: { id: string; status: string; priority: string; caveat?: string }[]
}

const readingModes = [
  { colorScheme: 'light', javaScriptEnabled: false, label: 'without JavaScript' },
  { colorScheme: 'light', javaScriptEnabled: true, label: 'in light mode' },
  { colorScheme: 'dark', javaScriptEnabled: true, label: 'in dark mode' },
] as const

for (const { colorScheme, javaScriptEnabled, label } of readingModes) {
  test(`public information is readable ${label} @mobile`, async ({ browser }) => {
    const use = test.info().project.use
    const context = await browser.newContext({
      baseURL: use.baseURL, viewport: use.viewport, userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor, isMobile: use.isMobile, hasTouch: use.hasTouch,
      javaScriptEnabled, colorScheme,
    })
    const page = await context.newPage()
    try {
      await page.goto('/about')
      if (javaScriptEnabled) await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('A place for our conversations. A say in what comes next.')
      await expect(page.locator('.about-page')).toContainText('The code is public under the AGPL licence')
      const status = page.locator('.about-page .governance-status')
      await expect(status).toContainText('HeyNaija is founder-operated')
      await expect(status).toContainText('Incorporation as a nonprofit under Incorporated Trustees is proposed, not completed')
      await expect(status).toContainText('not legally community-owned yet')
      await expect(page.locator('.about-page')).toContainText('temporary signup restriction')
      await expect(page.locator('.about-page')).toContainText('planned and unavailable')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: test.info().outputPath(`about-${colorScheme}.png`) })

      await page.getByRole('link', { name: 'See what we’re building', exact: true }).first().click()
      await expect(page).toHaveURL(/\/progress$/)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Building HeyNaija in the open')
      await expect(page.locator('.progress-features > li')).toHaveCount(registry.features.length)
      await expect(page.locator('.progress-feature-heading').first()).toHaveCSS('display', 'flex')
      for (const feature of registry.features) {
        const row = page.locator(`#${feature.id}`)
        await expect(row).toContainText(feature.priority)
        if (feature.caveat) await expect(row).toContainText(feature.caveat)
      }
      for (const [index, status] of ['implemented', 'partial', 'planned', 'blocked'].entries()) {
        await expect(page.locator('.progress-definitions dt strong').nth(index)).toHaveText(String(registry.features.filter((feature) => feature.status === status).length))
      }
      await expect(page.locator('.progress-availability')).toContainText('not been verified')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      const publicText = await page.locator('main').innerText()
      expect(publicText).not.toMatch(/apps\/api|NoScanner|IDENTITY_KEY_SECRET/)
      await expect(page.getByRole('link', { name: 'developer version' })).toHaveAttribute('href', 'https://github.com/HeyNaija/heynaija/blob/main/docs/FEATURE_ROADMAP.md')
      await page.screenshot({ path: test.info().outputPath(`progress-${colorScheme}.png`) })
      await page.getByRole('navigation', { name: 'Roadmap priorities' }).getByRole('link', { name: /^P2/ }).click()
      await expect(page).toHaveURL(/#p2$/)
      await expect(page.locator('#P2-heading')).toBeInViewport()
    } finally {
      await context.close()
    }
  })
}

test('both information pages fit a 320px phone @mobile', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  for (const path of ['/about', '/progress']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: test.info().outputPath(`${path.slice(1)}-320.png`) })
  }
})

test('signed-in members reach both pages from the account menu @mobile', async ({ browser }) => {
  const member = await newMember(browser, 'roadmap')
  try {
    await member.page.getByLabel('Account menu').click()
    await member.page.getByRole('link', { name: 'What we’re building', exact: true }).click()
    await expect(member.page).toHaveURL(/\/progress$/)
    await expect(member.page.getByRole('heading', { level: 1 })).toHaveText('Building HeyNaija in the open')
    await member.page.getByLabel('Account menu').click()
    await member.page.locator('.account-menu-panel').getByRole('link', { name: 'About HeyNaija', exact: true }).click()
    await expect(member.page).toHaveURL(/\/about$/)
    await expect(member.page.getByRole('heading', { level: 1 })).toContainText('A place for our conversations.')
    expect(await member.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  } finally {
    await member.context.close()
  }
})

test('visitors can find About and Progress from existing public surfaces @mobile', async ({ page }) => {
  await page.goto('/')
  await page.locator('.welcome-intro').getByRole('link', { name: 'About HeyNaija' }).click()
  await expect(page).toHaveURL(/\/about$/)
  await page.goto('/join')
  const footer = page.getByRole('navigation', { name: 'About HeyNaija' })
  await expect(footer.getByRole('link', { name: 'About HeyNaija' })).toHaveAttribute('href', '/about')
  await footer.getByRole('link', { name: 'Progress', exact: true }).click()
  await expect(page).toHaveURL(/\/progress$/)
  await page.getByRole('navigation', { name: 'More about HeyNaija' }).getByRole('link', { name: 'Governance', exact: true }).click()
  await expect(page).toHaveURL(/\/governance$/)
  await expect(page.locator('.governance-status')).toContainText('no binding community vote or treasury is live')
  await page.getByRole('link', { name: 'Product roadmap and progress' }).click()
  await expect(page).toHaveURL(/\/progress$/)
})
