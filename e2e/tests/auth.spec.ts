import { expect, test } from '@playwright/test'
import { createInvite } from '../lib/cli.ts'
import { env, MARK } from '../lib/env.ts'
import { codeFor } from '../lib/mailpit.ts'
import { handleFor, signIn, signUp } from '../lib/members.ts'

test('joins with an invite, signs up with an emailed code and lands signed in @mobile', async ({ page }) => {
  const handle = handleFor('joiner')
  await signUp(page, handle)
  // Signed in as the new member: the composer is there and the account menu names them.
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeVisible()
  await page.getByLabel('Account menu').click()
  // Phones also have a Profile tab in the bottom bar; use the one in the open menu.
  await page.locator('details[open]').getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`))
})

test('refuses a wrong invite code', async ({ page }) => {
  await page.goto('/join')
  await page.getByLabel('Invite code').fill('HN-0000-0000-0000')
  await page.getByLabel('I am 18 or older').check()
  await page.getByRole('button', { name: 'Check invite code' }).click()
  // Next's route announcer is also an alert, so look for the message itself.
  await expect(page.getByText('That code is not valid')).toBeVisible()
  await expect(page).toHaveURL(/\/join/)
})

test('without an invite, the sign-up page sends people to join first', async ({ page }) => {
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/join/)
})

test('joining needs the 18+ confirmation @mobile', async ({ page }) => {
  await page.goto(`/join?code=${createInvite()}`)
  const adult = page.getByLabel('I am 18 or older')
  await expect(adult).not.toBeChecked()
  await page.getByRole('button', { name: 'Check invite code' }).click()
  // The box is required, so the browser keeps the form here.
  await expect(page).toHaveURL(/\/join/)
  expect(await adult.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true)
})

test('the API refuses a signup that skipped the 18+ confirmation', async ({ page, context }) => {
  const handle = handleFor('underage')
  const email = `${handle}@${MARK.emailDomain}`
  await page.goto(`/join?code=${createInvite()}`)
  await page.getByLabel('I am 18 or older').check()
  await page.getByRole('button', { name: 'Check invite code' }).click()
  await page.waitForURL(/\/signup/)
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Handle').fill(handle)
  await page.getByRole('button', { name: 'Sign up' }).click()
  const asked = new Date()
  await page.getByRole('button', { name: 'Send sign up code' }).click()
  await page.getByLabel('Code from the email').fill(await codeFor(email, asked))

  // The confirmation disappears just before the account would be saved: the
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
