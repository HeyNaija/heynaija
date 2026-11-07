// Everyone gives a date of birth (ADR 0020, section 1): a member who joined
// before signup asked sees only /birth-date until they give theirs.
import { expect, test } from '@playwright/test'
import { forgetBirthDate } from '../lib/db.ts'
import { fillBirthDate, newMember } from '../lib/members.ts'

/** A date of birth for someone `years` old today, as YYYY-MM-DD. */
function bornYearsAgo(years: number) {
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() - years)
  date.setUTCDate(date.getUTCDate() - 2)
  return date.toISOString().slice(0, 10)
}

test('a member who ticked "18 or older" gives a date of birth before anything else, once @mobile', async ({ browser }) => {
  const { handle, page, context } = await newMember(browser, 'ticked')
  await forgetBirthDate(handle, { ticked: true })

  // Every page of the app leads to the question, and nothing else is shown.
  for (const path of ['/', '/settings', '/privacy', `/u/${handle}`]) {
    await page.goto(path)
    await page.waitForURL((url) => url.pathname === '/birth-date')
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Add your date of birth' })).toBeVisible()
  await expect(page.getByLabel('Account menu')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Sign out' })).toBeVisible()

  // The day list follows the month and the year, so a day that does not exist
  // cannot be chosen, and one the month no longer has is cleared.
  const day = page.getByLabel('Day')
  await day.selectOption('31')
  await page.getByLabel('Month').selectOption('2')
  await expect(day).toHaveValue('')
  await expect(day.locator('option')).toHaveCount(1 + 29)
  await page.getByLabel('Year').selectOption('1990')
  await expect(day.locator('option')).toHaveCount(1 + 28)

  await fillBirthDate(page, '1985-06-14')
  await page.getByRole('button', { name: 'Save date of birth' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByLabel('Account menu')).toBeVisible()

  // Asked once: the page sends them on, and Settings has the date.
  await page.goto('/birth-date')
  await page.waitForURL((url) => url.pathname === '/')
  await page.goto('/settings')
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Identity and governance' }) })
  await expect(section).toContainText('14 June 1985')
  await expect(section).toContainText('18 or older')
  await context.close()
})

test('a member with no age on record who is under 18 is kept as under 18, and under 13 is suspended', async ({ browser }) => {
  const teen = await newMember(browser, 'teen')
  await forgetBirthDate(teen.handle)
  await teen.page.goto('/')
  await teen.page.waitForURL((url) => url.pathname === '/birth-date')
  await fillBirthDate(teen.page, bornYearsAgo(15))
  await teen.page.getByRole('button', { name: 'Save date of birth' }).click()
  await teen.page.waitForURL((url) => url.pathname === '/')
  await teen.page.goto('/settings')
  await expect(teen.page.locator('.settings-status')).toContainText('Under 18')
  await teen.context.close()

  const child = await newMember(browser, 'child')
  await forgetBirthDate(child.handle)
  await child.page.goto('/')
  await child.page.waitForURL((url) => url.pathname === '/birth-date')
  await fillBirthDate(child.page, bornYearsAgo(10))
  await child.page.getByRole('button', { name: 'Save date of birth' }).click()
  await child.page.waitForURL((url) => url.pathname === '/')
  await expect(child.page.getByRole('heading', { level: 1, name: 'Your account is suspended' })).toBeVisible()
  await child.context.close()
})
