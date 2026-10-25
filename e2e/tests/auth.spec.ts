import { expect, test } from '@playwright/test'
import { createInvite } from '../lib/cli.ts'
import { env, MARK } from '../lib/env.ts'
import { codeFor, countFor } from '../lib/mailpit.ts'
import { handleFor, signIn, signUp } from '../lib/members.ts'

test('joins with an invite, signs up with an emailed code and lands signed in @mobile', async ({ page }) => {
  const handle = handleFor('joiner')
  await signUp(page, handle, { welcome: 'stay' })
  // Signed in as the new member, who starts on the welcome flow; skipping it leads home.
  await expect(page.getByRole('heading', { level: 1, name: /Find your places/ })).toBeVisible()
  await page.getByRole('button', { name: 'Skip setup' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  // The composer is there and the account menu names them.
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeVisible()
  await page.getByLabel('Account menu').click()
  // Phones also have a Profile tab in the bottom bar; use the one in the open menu.
  await page.locator('details[open]').getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`))
})

test('refuses a wrong invite code before any email is sent, keeping what was typed', async ({ page }) => {
  const handle = handleFor('wrongcode')
  const email = `${handle}@${MARK.emailDomain}`
  const since = new Date()
  await page.goto('/signup')
  await page.getByLabel('Invite code').fill('HN-0000-0000-0000')
  await page.getByLabel('I am 18 or older').check()
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Handle').fill(handle)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  // Next's route announcer is also an alert, so look for the message itself.
  await expect(page.getByText('That code is not valid')).toBeVisible()
  await expect(page).toHaveURL(/\/signup/)
  await expect(page.getByLabel('Invite code')).toHaveValue('HN-0000-0000-0000')
  await expect(page.getByLabel('Email address')).toHaveValue(email)
  await expect(page.getByLabel('Handle')).toHaveValue(handle)
  await expect(page.getByLabel('Code from the email')).toHaveCount(0)
  expect(await countFor(email, since)).toBe(0)
})

test('signing up is one page, and an invite link fills in its code @mobile', async ({ page }) => {
  const code = createInvite()
  await page.goto(`/join?code=${code}`)
  await expect(page).toHaveURL(/\/signup\?flow=/)
  await expect(page.getByLabel('Invite code')).toHaveValue(code)
  for (const label of ['I am 18 or older', 'Email address', 'Handle']) await expect(page.getByLabel(label)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Email me a code' })).toBeVisible()
  // Without an invite, the same page, with the box empty.
  await page.context().clearCookies()
  await page.goto('/signup')
  await expect(page).toHaveURL(/\/signup\?flow=/)
  await expect(page.getByLabel('Invite code')).toHaveValue('')
})

test('joining needs the 18+ confirmation @mobile', async ({ page }) => {
  const handle = handleFor('noage')
  await page.goto(`/join?code=${createInvite()}`)
  const adult = page.getByLabel('I am 18 or older')
  await expect(adult).not.toBeChecked()
  await page.getByLabel('Email address').fill(`${handle}@${MARK.emailDomain}`)
  await page.getByLabel('Handle').fill(handle)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  // The box is required, so the browser keeps the form here.
  await expect(page.getByLabel('Code from the email')).toHaveCount(0)
  expect(await adult.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true)
})

test('the API refuses a signup that skipped the 18+ confirmation', async ({ page, context }) => {
  const handle = handleFor('underage')
  const email = `${handle}@${MARK.emailDomain}`
  await page.goto(`/join?code=${createInvite()}`)
  await page.getByLabel('I am 18 or older').check()
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Handle').fill(handle)
  const asked = new Date()
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code from the email').fill(await codeFor(email, asked))

  // The confirmation disappears just before the account would be saved: the
  // registration webhook refuses it, and no account is created.
  await context.clearCookies({ name: 'hn_age' })
  await page.getByRole('button', { name: 'Continue' }).click()
  // The page's intro says this too; the refusal is the alert.
  await expect(page.getByRole('alert').filter({ hasText: 'open to people aged 18 or older' })).toBeVisible()
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
