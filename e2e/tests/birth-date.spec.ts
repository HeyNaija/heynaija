// During the 18+ beta nobody is asked for a date of birth (BIRTH_DATE_ENABLED is
// off, 8 November 2026): the "I am 18 or older" box on /join is the member's age.
// The /birth-date question for members already here is kept, switched off with it.
import { expect, test } from '@playwright/test'
import { forgetBirthDate } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

test('a member who ticked "18 or older" is never asked for a date of birth @mobile', async ({ browser }) => {
  const { handle, page, context } = await newMember(browser, 'ticked')
  for (const path of ['/', '/settings', `/u/${handle}`]) {
    await page.goto(path)
    await expect(page).toHaveURL((url) => url.pathname === path)
  }
  // The old question sends them home.
  await page.goto('/birth-date')
  await page.waitForURL((url) => url.pathname === '/')

  // Settings has their word for it, and no date.
  await page.goto('/settings')
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Identity and governance' }) })
  await expect(section).toContainText('18 or older')
  await expect(section).toContainText('As you stated it. It is not a verified age.')
  await expect(section).not.toContainText('Date of birth')
  await context.close()
})

test('a member with no age on record is not asked either, and is not treated as an adult', async ({ browser }) => {
  const { handle, page, context } = await newMember(browser, 'noage')
  await forgetBirthDate(handle)
  await page.goto('/')
  await expect(page).toHaveURL((url) => url.pathname === '/')
  await page.goto('/settings')
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Identity and governance' }) })
  await expect(section).toContainText('Not on record')
  await expect(section).toContainText('It is not treated as a confirmed adult.')
  await context.close()
})
