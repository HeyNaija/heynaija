import { expect, test } from '@playwright/test'
import { createInvite } from '../lib/cli.ts'
import { env, MARK } from '../lib/env.ts'
import { codeFor } from '../lib/mailpit.ts'
import { fillBirthDate, handleFor, signIn, signUp } from '../lib/members.ts'

test('joins with an invite, signs up with an emailed code and lands signed in @mobile', async ({ page, context }) => {
  const handle = handleFor('joiner')
  await signUp(page, handle, { welcome: 'stay' })
  // Signed in as the new member, who starts on the welcome flow; skipping it leads home.
  await expect(page.getByRole('heading', { level: 1, name: /Find your places/ })).toBeVisible()
  await page.getByRole('button', { name: 'Skip setup' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  // The date of birth was in a cookie only for signing up.
  expect((await context.cookies()).map((c) => c.name)).not.toContain('hn_age')
  // The composer is there and the account menu names them.
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeVisible()
  await page.getByLabel('Account menu').click()
  // Phones also have a Profile tab in the bottom bar; use the one in the open menu.
  await page.locator('details[open]').getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`))
})

test('refuses a wrong invite code', async ({ page }) => {
  await page.goto('/join')
  await page.getByLabel('Invite code').fill('HN-0000-0000-0000')
  await fillBirthDate(page)
  await page.getByRole('button', { name: 'Check invite code' }).click()
  // Next's route announcer is also an alert, so look for the message itself.
  await expect(page.getByText('That code is not valid')).toBeVisible()
  await expect(page).toHaveURL(/\/join/)
  // What was chosen stays chosen, so only the code needs putting right.
  await expect(page.getByLabel('Day')).toHaveValue('27')
  await expect(page.getByLabel('Month')).toHaveValue('3')
  await expect(page.getByLabel('Year')).toHaveValue('1990')
})

test('without an invite, the sign-up page sends people to join first', async ({ page }) => {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/join/)
})

test('joining needs a date of birth, confirmed as real @mobile', async ({ page }) => {
  await page.goto(`/join?code=${createInvite()}`)
  // Who may join is the API's to say: 18 during the beta, 13 once under-18 accounts open.
  await expect(page.getByText('HeyNaija is open to people aged 18 and over.')).toBeVisible()
  const confirm = page.getByLabel('This is my real date of birth')
  await expect(confirm).not.toBeChecked()
  await page.getByRole('button', { name: 'Check invite code' }).click()
  // The fields are required, so the browser keeps the form here.
  await expect(page).toHaveURL(/\/join/)
  expect(await page.getByLabel('Day').evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true)
  expect(await confirm.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true)
})

test('during the 18+ beta someone younger is refused, and stays refused for a day', async ({ page, context }) => {
  const sixteen = new Date()
  sixteen.setUTCFullYear(sixteen.getUTCFullYear() - 16)
  await page.goto(`/join?code=${createInvite()}`)
  await fillBirthDate(page, sixteen.toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'Check invite code' }).click()
  await expect(page.getByText('it is open to people aged 18 and over')).toBeVisible()
  // The date is not put back into the form, and nothing goes on to Kratos.
  await expect(page.getByLabel('Year')).toHaveValue('')
  expect((await context.cookies()).map((c) => c.name)).not.toContain('hn_age')

  // Changing the year and sending again does not work straight away.
  await fillBirthDate(page)
  await page.getByRole('button', { name: 'Check invite code' }).click()
  await expect(page.getByText('If you made a mistake with your date of birth')).toBeVisible()
  await expect(page).toHaveURL(/\/join/)
})

test('the API refuses a signup that lost its date of birth', async ({ page, context }) => {
  const handle = handleFor('underage')
  const email = `${handle}@${MARK.emailDomain}`
  await page.goto(`/join?code=${createInvite()}`)
  await fillBirthDate(page)
  await page.getByRole('button', { name: 'Check invite code' }).click()
  await page.waitForURL(/\/signup/)
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Handle').fill(handle)
  const asked = new Date()
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code from the email').fill(await codeFor(email, asked))

  // The date of birth disappears just before the account would be saved: the
  // registration webhook refuses it, and no account is created.
  await context.clearCookies({ name: 'hn_age' })
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/join/)
  await expect(page.getByLabel('Account menu')).toHaveCount(0)
  const res = await fetch(`${env.kratosAdminUrl}/admin/identities?credentials_identifier=${encodeURIComponent(email)}`)
  expect(await res.json()).toEqual([])
})

test('signs out and back in with an emailed code', async ({ page }) => {
  const handle = handleFor('returner')
  const email = await signUp(page, handle)

  await page.getByLabel('Account menu').click()
  await page.getByRole('link', { name: 'Sign out' }).click()
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  await expect(page.getByLabel('Account menu')).toHaveCount(0)

  await signIn(page, email)
})

test('a wrong sign-in code is refused', async ({ page }) => {
  const handle = handleFor('mistyper')
  const email = await signUp(page, handle)
  await page.getByLabel('Account menu').click()
  await page.getByRole('link', { name: 'Sign out' }).click()

  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  const asked = new Date()
  await page.getByRole('button', { name: 'Email me a code' }).click()
  const real = await codeFor(email, asked)
  await page.getByLabel('Code from the email').fill(real === '000000' ? '111111' : '000000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('main').getByRole('alert').first()).toBeVisible()
  await expect(page.getByLabel('Account menu')).toHaveCount(0)
})
