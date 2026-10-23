import { expect, type Page, test } from '@playwright/test'
import { ageSignIn } from '../lib/db.ts'
import { MARK } from '../lib/env.ts'
import { codeFor } from '../lib/mailpit.ts'
import { handleFor, newMember, signUpOverHttp, submitSignUp } from '../lib/members.ts'

// A handle names one member: profiles, reports and moderation all look people up
// by it. Kratos keeps it unique (see infra/kratos/identity.schema.json), and a
// handle given up by renaming stays its owner's for 30 days.
const taken = 'An account with that email or handle already exists.'
const unavailable = 'That handle is not available.'
const saved = 'Your changes have been saved!'

/** Saves a new handle in Settings, without checking that it worked. */
async function rename(page: Page, handle: string) {
  await page.goto('/settings')
  const form = page.locator('form', { has: page.getByLabel('Handle', { exact: true }) })
  await form.getByLabel('Handle').fill(handle)
  await form.getByRole('button', { name: 'Save' }).click()
}

test('a handle someone already has is refused at sign-up', async ({ browser, page }) => {
  const owner = await newMember(browser, 'owner')

  // Someone else, with their own invite and email, asks for the same handle.
  await submitSignUp(page, owner.handle, `${handleFor('copycat')}@${MARK.emailDomain}`)
  await expect(page.getByText(taken)).toBeVisible()
  await expect(page.getByLabel('Account menu')).toHaveCount(0)

  // The handle still leads to the member who had it first.
  await owner.page.goto(`/u/${owner.handle}`)
  await expect(owner.page.getByRole('main').getByRole('link', { name: 'Edit profile' })).toBeVisible()
  await owner.context.close()
})

test('renaming to a handle someone already has is refused; a free one works', async ({ browser, page }) => {
  const owner = await newMember(browser, 'owner')
  await signUpOverHttp(page, handleFor('renamer'))

  await rename(page, owner.handle)
  await expect(page.getByText(taken)).toBeVisible()
  // The message is shown once; a reload starts over instead of repeating it.
  await expect(page).toHaveURL((url) => url.pathname === '/settings' && !url.searchParams.has('flow'))
  await page.reload()
  await expect(page.getByLabel('Handle', { exact: true })).toBeVisible()
  await expect(page.getByText(taken)).toHaveCount(0)

  const renamed = handleFor('renamed')
  await rename(page, renamed)
  await expect(page.getByText(saved)).toBeVisible()
  await page.goto(`/u/${renamed}`)
  await expect(page.getByRole('main').getByRole('link', { name: 'Edit profile' })).toBeVisible()

  await owner.context.close()
})

test('a handle given up by renaming stays its owner’s, and its old link leads to them', async ({ browser, page }) => {
  // The API learns of a rename when its 30-second cache of the member's session runs out.
  test.slow()
  const mover = await newMember(browser, 'mover')
  const old = mover.handle
  const moved = handleFor('moved')
  await rename(mover.page, moved)
  await expect(mover.page.getByText(saved)).toBeVisible()

  // Nobody else can sign up with the old handle, or rename to it.
  await submitSignUp(page, old, `${handleFor('squatter')}@${MARK.emailDomain}`)
  await expect(page.getByText(unavailable)).toBeVisible()
  await expect(page.getByLabel('Account menu')).toHaveCount(0)
  const other = await newMember(browser, 'other')
  await rename(other.page, old)
  await expect(other.page.getByText(unavailable)).toBeVisible()

  // The old profile link leads to the new handle.
  await expect(async () => {
    await mover.page.goto('/')
    await other.page.goto(`/u/${old}`)
    await expect(other.page).toHaveURL(new RegExp(`/u/${moved}$`), { timeout: 2_000 })
  }).toPass({ timeout: 60_000 })

  // Its owner can take it back.
  await rename(mover.page, old)
  await expect(mover.page.getByText(saved)).toBeVisible()

  await mover.context.close()
  await other.context.close()
})

test('a change Kratos cannot replay after verifying again says so in plain words', async ({ browser }) => {
  const member = await newMember(browser, 'replay')
  const { page, context } = member
  await ageSignIn(member.handle, 20)

  // Saving now needs a fresh sign-in first. Kratos remembers the change in a
  // cookie and replays it afterwards; when that cookie is lost on the way (as can
  // happen through a Google sign-in), the replay fails with an internal error.
  await rename(page, handleFor('later'))
  await page.waitForURL((url) => url.pathname === '/login')
  await context.clearCookies({ name: /continuity/ })
  // Only their own address will do, so it is already there and cannot be changed.
  const email = page.getByLabel('Email address')
  await expect(email).toHaveValue(member.email)
  await expect(email).toHaveAttribute('readonly', '')
  await expect(page.getByRole('link', { name: 'Sign out' })).toBeVisible()
  const asked = new Date()
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code from the email').fill(await codeFor(member.email, asked))
  await page.getByRole('button', { name: 'Continue' }).click()

  await page.waitForURL((url) => url.pathname === '/settings')
  await expect(page.getByText('Your change was not saved. Make it again and press Save.')).toBeVisible()
  await expect(page.getByText(/decode body|HTTP Request/)).toHaveCount(0)
  // The notice is streamed before hydration clears the URL. Reload only once
  // that cleanup has finished, otherwise this repeats the same old flow.
  await expect(page).toHaveURL((url) => url.pathname === '/settings' && !url.searchParams.has('flow'))
  await page.reload()
  await expect(page.getByLabel('Handle', { exact: true })).toBeVisible()
  await expect(page.getByText('Your change was not saved.', { exact: false })).toHaveCount(0)
  await context.close()
})
