import { expect, test, type Page } from '@playwright/test'
import { createInvite } from '../lib/cli.ts'
import { env, MARK } from '../lib/env.ts'
import { googleProvider } from '../lib/google-provider.ts'
import { codeFor } from '../lib/mailpit.ts'
import { handleFor, newMember } from '../lib/members.ts'

test.describe.configure({ mode: 'serial' })
let google: Awaited<ReturnType<typeof googleProvider>>
test.beforeAll(async () => { test.setTimeout(180_000); google = await googleProvider() })
test.afterAll(async () => { test.setTimeout(60_000); await google?.close() })

async function signOut(page: Page) {
  await page.getByLabel('Account menu').click()
  await page.getByRole('link', { name: 'Sign out', exact: true }).click()
}
async function identity(id: string) {
  const response = await fetch(`${env.kratosAdminUrl}/admin/identities/${id}?include_credential=oidc`)
  expect(response.ok).toBe(true)
  return response.json() as Promise<{
    traits: { email: string }
    credentials?: { oidc?: { identifiers?: string[] } }
    verifiable_addresses?: { value: string; verified: boolean }[]
  }>
}

test('one Google authorization confirms and connects an existing email account, then signs in directly @mobile', async ({ browser }) => {
  const member = await newMember(browser, 'glink')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    await signOut(member.page)
    await member.context.clearCookies({ name: 'hn_invite' })
    await member.context.clearCookies({ name: 'hn_age' })
    google.use(member.email.toUpperCase())
    const before = google.authorizations
    await member.page.goto('/login')
    await member.page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await expect(member.page.getByText('Google confirmed your email.', { exact: false })).toBeVisible()
    await expect(member.page).toHaveURL((url) => url.pathname === '/login')
    await expect(member.page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
    await expect(member.page.getByLabel('Invite code')).toHaveCount(0)
    const asked = new Date()
    await member.page.getByRole('button', { name: 'Email me a code', exact: true }).click()
    await member.page.getByLabel('Code from the email').fill(await codeFor(member.email, asked))
    await member.page.getByRole('button', { name: 'Continue', exact: true }).click()
    await member.page.waitForURL((url) => url.pathname === '/')
    expect(google.authorizations - before).toBe(1)
    expect((await (await member.context.request.get('/api/v1/me')).json()).id).toBe(original.id)
    expect((await identity(original.id)).credentials?.oidc?.identifiers).toHaveLength(1)

    await signOut(member.page)
    await member.page.goto('/login')
    await member.page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await member.page.waitForURL((url) => url.pathname === '/')
    expect(google.authorizations - before).toBe(2)
    expect((await (await member.context.request.get('/api/v1/me')).json()).id).toBe(original.id)
  } finally { await member.context.close() }
})

test('choosing Google on signup recognizes an existing email account', async ({ browser, page }) => {
  const member = await newMember(browser, 'gsignup')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    google.use(member.email)
    const before = google.authorizations
    await page.goto(`/join?code=${createInvite()}`)
    await page.getByLabel('I am 18 or older').check()
    await page.getByRole('button', { name: 'Check invite code' }).click()
    await page.waitForURL((url) => url.pathname === '/signup')
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await expect(page.getByText('Google confirmed your email.', { exact: false })).toBeVisible()
    await expect(page).toHaveURL((url) => url.pathname === '/login')
    const asked = new Date()
    await page.getByRole('button', { name: 'Email me a code', exact: true }).click()
    await page.getByLabel('Code from the email').fill(await codeFor(member.email, asked))
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/')
    expect((await (await page.context().request.get('/api/v1/me')).json()).id).toBe(original.id)
    expect(google.authorizations - before).toBe(1)
  } finally { await member.context.close() }
})

test('Settings refuses a Google account with a different email before storing the connection', async ({ browser }) => {
  const member = await newMember(browser, 'gmismatch')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    google.use(`other_${member.handle}@${MARK.emailDomain}`)
    await member.page.goto('/settings')
    await member.page.getByRole('button', { name: 'Connect Google', exact: true }).click()
    await expect(member.page.getByText('Different email addresses cannot be connected.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).credentials?.oidc?.identifiers ?? []).toEqual([])
    expect((await (await member.context.request.get('/api/v1/me')).json()).id).toBe(original.id)
  } finally { await member.context.close() }
})

test('Settings connects a Google account with the same verified email', async ({ browser }) => {
  const member = await newMember(browser, 'gsame')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    google.use(member.email)
    await member.page.goto('/settings')
    await member.page.getByRole('button', { name: 'Connect Google', exact: true }).click()
    await expect(member.page.getByRole('button', { name: 'Disconnect Google', exact: true })).toBeVisible()
    expect((await identity(original.id)).credentials?.oidc?.identifiers).toHaveLength(1)
  } finally { await member.context.close() }
})

test('unverified Google email cannot be linked', async ({ browser }) => {
  const member = await newMember(browser, 'gunverified')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    google.use(member.email, false)
    await member.page.goto('/settings')
    await member.page.getByRole('button', { name: 'Connect Google', exact: true }).click()
    await expect(member.page.getByText('Google must verify your email address', { exact: false })).toBeVisible()
    expect((await identity(original.id)).credentials?.oidc?.identifiers ?? []).toEqual([])
  } finally { await member.context.close() }
})

test('Google disables email editing while handle updates work and tampered email changes are refused', async ({ browser }) => {
  const member = await newMember(browser, 'gemail')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    google.use(member.email)
    await member.page.goto('/settings')
    await member.page.getByRole('button', { name: 'Connect Google', exact: true }).click()
    await expect(member.page.getByRole('button', { name: 'Disconnect Google', exact: true })).toBeVisible()
    const form = member.page.locator('form').filter({ has: member.page.getByLabel('Email address', { exact: true }) })
    const email = form.getByLabel('Email address', { exact: true })
    await expect(email).toBeDisabled()
    await expect(email).toHaveValue(member.email)
    await expect(member.page.getByText('Disconnect Google in Connected accounts below to change your email address.')).toBeVisible()
    await form.getByLabel('Handle', { exact: true }).fill(handleFor('grenamed'))
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(member.page.getByText('Your changes have been saved!')).toBeVisible()
    await expect(email).toBeDisabled()
    expect((await identity(original.id)).traits.email).toBe(member.email)
    // Bypass the disabled UI and forge the submitted value: the server must
    // still enforce the Google email rule independently of the form.
    await form.locator('input[type="hidden"][name="traits.email"]').evaluate((input: HTMLInputElement, value) => { input.value = value }, `new_${member.handle}@${MARK.emailDomain}`)
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(member.page.getByText('Disconnect Google before changing your HeyNaija email address.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
  } finally { await member.context.close() }
})

test('disconnecting Google unlocks email editing and the new email signs in to the same account', async ({ browser }) => {
  const member = await newMember(browser, 'gunlock')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    google.use(member.email)
    await member.page.goto('/settings')
    const email = member.page.getByLabel('Email address', { exact: true })
    await expect(email).toBeEnabled()
    await member.page.getByRole('button', { name: 'Connect Google', exact: true }).click()
    await expect(email).toBeDisabled()
    await member.page.getByRole('button', { name: 'Disconnect Google', exact: true }).click()
    await expect(member.page.getByRole('button', { name: 'Connect Google', exact: true })).toBeVisible()
    await expect(email).toBeEnabled()
    await expect(member.page.getByText('Disconnect Google in Connected accounts below to change your email address.')).toHaveCount(0)
    const nextEmail = `new_${member.handle}@${MARK.emailDomain}`
    await email.fill(nextEmail)
    const form = member.page.locator('form').filter({ has: email })
    const sent = new Date()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(member.page.getByLabel('Code sent to your new email', { exact: true })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
    await member.page.getByLabel('Code sent to your new email', { exact: true }).fill(await codeFor(nextEmail, sent))
    await member.page.getByRole('button', { name: 'Confirm email change', exact: true }).click()
    await expect(member.page.getByText('Your changes have been saved!')).toBeVisible()
    const updated = await identity(original.id)
    expect(updated.traits.email).toBe(nextEmail)
    expect(updated.verifiable_addresses?.find((address) => address.value === nextEmail)?.verified).toBe(true)
    await signOut(member.page)
    await member.page.goto('/login')
    await member.page.getByLabel('Email address', { exact: true }).fill(nextEmail)
    const asked = new Date()
    await member.page.getByRole('button', { name: 'Email me a code', exact: true }).click()
    await member.page.getByLabel('Code from the email').fill(await codeFor(nextEmail, asked))
    await member.page.getByRole('button', { name: 'Continue', exact: true }).click()
    await member.page.waitForURL((url) => url.pathname === '/')
    expect((await (await member.context.request.get('/api/v1/me')).json()).id).toBe(original.id)
  } finally { await member.context.close() }
})

test('an already connected Google account cannot sign in after its email stops matching', async ({ browser }) => {
  const member = await newMember(browser, 'gchanged')
  try {
    google.use(member.email)
    await member.page.goto('/settings')
    await member.page.getByRole('button', { name: 'Connect Google', exact: true }).click()
    await expect(member.page.getByRole('button', { name: 'Disconnect Google', exact: true })).toBeVisible()
    await signOut(member.page)
    google.use(`changed_${member.handle}@${MARK.emailDomain}`, true, member.email)
    await member.page.goto('/login')
    await member.page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await expect(member.page.getByText('Different email addresses cannot be connected.', { exact: false })).toBeVisible()
    expect((await member.context.request.get('/api/v1/me')).status()).toBe(401)
  } finally { await member.context.close() }
})

test('a new Google account still needs an invite', async ({ page }) => {
  const email = `${handleFor('gnew')}@${MARK.emailDomain}`
  google.use(email)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await expect(page).toHaveURL((url) => url.pathname === '/join')
  const response = await fetch(`${env.kratosAdminUrl}/admin/identities?credentials_identifier=${encodeURIComponent(email)}`)
  expect(await response.json()).toEqual([])
})

test('a new invited Google member can choose a handle and create one account', async ({ page }) => {
  const handle = handleFor('gjoin')
  const email = `${handle}@${MARK.emailDomain}`
  google.use(email)
  await page.goto(`/join?code=${createInvite()}`)
  await page.getByLabel('I am 18 or older').check()
  await page.getByRole('button', { name: 'Check invite code' }).click()
  await page.waitForURL((url) => url.pathname === '/signup')
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
  await page.getByLabel('Handle').fill(handle)
  await page.locator('button[name="provider"][value="google"]').click()
  // Like any newcomer, they start on the welcome flow.
  await page.waitForURL((url) => url.pathname === '/welcome')
  const me = await (await page.context().request.get('/api/v1/me')).json()
  expect(me.handle).toBe(handle)
  expect(me.onboarded).toBe(false)
  expect((await identity(me.id)).credentials?.oidc?.identifiers).toHaveLength(1)
})

test('a colliding handle cannot connect a new Google email to another member', async ({ browser, page }) => {
  const member = await newMember(browser, 'ghandle')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    const email = `${handleFor('gcollision')}@${MARK.emailDomain}`
    google.use(email)
    await page.goto(`/join?code=${createInvite()}`)
    await page.getByLabel('I am 18 or older').check()
    await page.getByRole('button', { name: 'Check invite code' }).click()
    await page.waitForURL((url) => url.pathname === '/signup')
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await page.getByLabel('Handle').fill(member.handle)
    await page.locator('button[name="provider"][value="google"]').click()
    await expect(page.getByText('That handle is not available.', { exact: false })).toBeVisible()
    await expect(page).toHaveURL((url) => url.pathname === '/signup')
    await expect(page.getByLabel('Code from the email')).toHaveCount(0)
    expect((await identity(original.id)).credentials?.oidc?.identifiers ?? []).toEqual([])
  } finally { await member.context.close() }
})

test('changing the confirmation identifier cannot connect Google to a different account', async ({ browser }) => {
  const member = await newMember(browser, 'gbound')
  const other = await newMember(browser, 'gother')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    const target = await (await other.context.request.get('/api/v1/me')).json()
    await signOut(member.page)
    google.use(member.email)
    await member.page.goto('/login')
    await member.page.getByRole('button', { name: 'Continue with Google', exact: true }).click()
    await expect(member.page.getByText('Google confirmed your email.', { exact: false })).toBeVisible()
    await member.page.locator('input[name="identifier"]').evaluate((input: HTMLInputElement, email) => { input.value = email }, other.email)
    const asked = new Date()
    await member.page.getByRole('button', { name: 'Email me a code', exact: true }).click()
    await member.page.getByLabel('Code from the email').fill(await codeFor(other.email, asked))
    await member.page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(member.page.getByRole('main').getByRole('alert').first()).toBeVisible()
    expect((await member.context.request.get('/api/v1/me')).status()).toBe(401)
    expect((await identity(original.id)).credentials?.oidc?.identifiers ?? []).toEqual([])
    expect((await identity(target.id)).credentials?.oidc?.identifiers ?? []).toEqual([])
  } finally { await member.context.close(); await other.context.close() }
})
