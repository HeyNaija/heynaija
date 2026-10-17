import { expect, test, type Page } from '@playwright/test'
import pg from 'pg'
import { ageSignIn } from '../lib/db.ts'
import { assertLocal, env, MARK } from '../lib/env.ts'
import { codeFor, messagesFor } from '../lib/mailpit.ts'
import { newMember, signIn } from '../lib/members.ts'

async function identity(id: string) {
  const response = await fetch(`${env.kratosAdminUrl}/admin/identities/${id}`)
  expect(response.ok).toBe(true)
  return response.json() as Promise<{ traits: { email: string }; verifiable_addresses: { value: string; verified: boolean }[] }>
}
async function signOut(page: Page) {
  await page.getByLabel('Account menu').click()
  await page.getByRole('link', { name: 'Sign out', exact: true }).click()
}
async function begin(page: Page, email: string) {
  await page.goto('/settings')
  const form = page.locator('form').filter({ has: page.getByLabel('Email address', { exact: true }) })
  await form.getByLabel('Email address', { exact: true }).fill(email)
  const sent = new Date()
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByLabel('Code sent to your new email', { exact: true })).toBeVisible()
  return codeFor(email, sent)
}
async function confirm(page: Page, code: string) {
  await page.getByLabel('Code sent to your new email', { exact: true }).fill(code)
  await page.getByRole('button', { name: 'Confirm email change', exact: true }).click()
}
async function alterPending(id: string, operation: 'expire' | 'resend') {
  assertLocal()
  const client = new pg.Client({ connectionString: env.databaseUrl!.replace(/\/[^/?]+(\?|$)/, '/kratos$1') })
  await client.connect()
  try {
    const path = operation === 'expire' ? '{heynaija_email_change,expires}' : '{heynaija_email_sent_at}'
    const at = new Date(Date.now() - 20 * 60_000).toISOString()
    const result = await client.query(`update selfservice_settings_flows set internal_context = jsonb_set(internal_context, $2::text[], to_jsonb($3::text))
      where identity_id = $1 and internal_context ? 'heynaija_email_change'`, [id, path, at])
    expect(result.rowCount).toBeGreaterThan(0)
  } finally { await client.end() }
}

test('the old email stays active until the new email code is confirmed @mobile', async ({ browser }) => {
  const member = await newMember(browser, 'email')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    const next = `new_${member.handle}@${MARK.emailDomain}`
    const asked = new Date()
    const code = await begin(member.page, next)
    await expect(member.page.getByText('stays active until you confirm the change.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
    // The new address is asked to confirm an email change, not to "verify your account".
    expect((await messagesFor(next, asked)).map((m) => m.Subject)).toContain(`Your HeyNaija email change code: ${code}`)
    await member.page.reload()
    await expect(member.page.getByLabel('Code sent to your new email', { exact: true })).toBeVisible()
    await confirm(member.page, code === '000000' ? '111111' : '000000')
    await expect(member.page.getByText('That code is not correct.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
    // Nothing is said to the old address until the change is saved.
    expect((await messagesFor(member.email, asked)).map((m) => m.Subject)).not.toContain('Your HeyNaija email address was changed')
    await confirm(member.page, code)
    await expect(member.page.getByText('Your changes have been saved!')).toBeVisible()
    const updated = await identity(original.id)
    expect(updated.traits.email).toBe(next)
    expect(updated.verifiable_addresses.find((address) => address.value === next)?.verified).toBe(true)
    await expect.poll(async () => (await messagesFor(member.email, asked)).map((m) => m.Subject), { timeout: 30_000 })
      .toContain('Your HeyNaija email address was changed')
    const notice = (await messagesFor(member.email, asked)).find((m) => m.Subject === 'Your HeyNaija email address was changed')!
    expect(notice.Snippet).toContain(`@${member.handle} was changed from ${member.email} to ${next}`)
    await signOut(member.page)
    await signIn(member.page, next)
    expect((await (await member.context.request.get('/api/v1/me')).json()).id).toBe(original.id)
  } finally { await member.context.close() }
})

test('an address another account signs in with is refused before any code is sent', async ({ browser }) => {
  const member = await newMember(browser, 'taken')
  const owner = await newMember(browser, 'owner')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    await member.page.goto('/settings')
    const form = member.page.locator('form').filter({ has: member.page.getByLabel('Email address', { exact: true }) })
    await form.getByLabel('Email address', { exact: true }).fill(owner.email.toUpperCase())
    const asked = new Date()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(member.page.getByText('That email address already belongs to another HeyNaija account.', { exact: false })).toBeVisible()
    await expect(member.page.getByLabel('Code sent to your new email', { exact: true })).toHaveCount(0)
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    expect(await messagesFor(owner.email, asked)).toHaveLength(0)
    expect((await identity(original.id)).traits.email).toBe(member.email)
    // A free address still works from the same page.
    const next = `new_${member.handle}@${MARK.emailDomain}`
    await form.getByLabel('Email address', { exact: true }).fill(next)
    const sent = new Date()
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await confirm(member.page, await codeFor(next, sent))
    await expect(member.page.getByText('Your changes have been saved!')).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(next)
  } finally {
    await member.context.close()
    await owner.context.close()
  }
})

test('cancelling a change preserves the original email and its sign-in', async ({ browser }) => {
  const member = await newMember(browser, 'cancel')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    await begin(member.page, `typo_${member.handle}@${MARK.emailDomain}`)
    await member.page.getByRole('button', { name: 'Cancel email change', exact: true }).click()
    await expect(member.page.getByLabel('Code sent to your new email', { exact: true })).toHaveCount(0)
    await expect(member.page.getByLabel('Email address', { exact: true })).toHaveValue(member.email)
    expect((await identity(original.id)).traits.email).toBe(member.email)
    await signOut(member.page)
    await signIn(member.page, member.email)
    expect((await (await member.context.request.get('/api/v1/me')).json()).id).toBe(original.id)
  } finally { await member.context.close() }
})

test('abandoning a change leaves the original email working for sign-in', async ({ browser }) => {
  const member = await newMember(browser, 'abandon')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    await begin(member.page, `typo_${member.handle}@${MARK.emailDomain}`)
    await signOut(member.page)
    await signIn(member.page, member.email)
    expect((await (await member.context.request.get('/api/v1/me')).json()).id).toBe(original.id)
    expect((await identity(original.id)).traits.email).toBe(member.email)
  } finally { await member.context.close() }
})

test('concurrent code guesses cannot bypass the attempt limit', async ({ browser }) => {
  const member = await newMember(browser, 'parallel')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    const code = await begin(member.page, `new_${member.handle}@${MARK.emailDomain}`)
    const pending = member.page.url()
    const form = member.page.locator('form').filter({ has: member.page.getByLabel('Code sent to your new email', { exact: true }) })
    const request = await form.evaluate((element: HTMLFormElement) => {
      const values: Record<string, string> = {}
      new FormData(element).forEach((value, key) => { values[key] = String(value) })
      return { action: element.action, values }
    })
    const wrong = code === '000000' ? '111111' : '000000'
    const responses = await Promise.all(Array.from({ length: 8 }, () => member.context.request.post(request.action, {
      form: { ...request.values, email_change_code: wrong, email_change_action: 'confirm' }, maxRedirects: 0,
    })))
    for (const response of responses) expect(response.status()).toBeLessThan(500)
    await member.page.goto(pending)
    await confirm(member.page, code)
    await expect(member.page.getByText('Too many code attempts.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
  } finally { await member.context.close() }
})

test('an expired code cannot replace the email', async ({ browser }) => {
  const member = await newMember(browser, 'expired')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    const code = await begin(member.page, `new_${member.handle}@${MARK.emailDomain}`)
    await alterPending(original.id, 'expire')
    await confirm(member.page, code)
    await expect(member.page.getByText('This code has expired or does not match this email change.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
  } finally { await member.context.close() }
})

test('a code cannot approve a different email, and repeated guessing is limited', async ({ browser }) => {
  const member = await newMember(browser, 'bound')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    const code = await begin(member.page, `new_${member.handle}@${MARK.emailDomain}`)
    await member.page.getByLabel('Email address', { exact: true }).fill(`other_${member.handle}@${MARK.emailDomain}`)
    await confirm(member.page, code)
    await expect(member.page.getByText('does not match this email change.', { exact: false })).toBeVisible()
    for (let attempt = 0; attempt < 5; attempt++) await confirm(member.page, '000000')
    await expect(member.page.getByText('Too many code attempts.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
  } finally { await member.context.close() }
})

test('resending is throttled and invalidates the previous code', async ({ browser }) => {
  const member = await newMember(browser, 'resend')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    const next = `new_${member.handle}@${MARK.emailDomain}`
    const first = await begin(member.page, next)
    await member.page.getByRole('button', { name: 'Send a new code', exact: true }).click()
    await expect(member.page.getByText('Please wait a minute', { exact: false })).toBeVisible()
    await alterPending(original.id, 'resend')
    const sent = new Date()
    await member.page.getByRole('button', { name: 'Send a new code', exact: true }).click()
    let second = ''
    await expect(async () => { second = await codeFor(next, sent); expect(second).not.toBe(first) }).toPass({ timeout: 30_000 })
    await confirm(member.page, first)
    await expect(member.page.getByText('That code is not correct.', { exact: false })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
    await confirm(member.page, second)
    await expect(member.page.getByText('Your changes have been saved!')).toBeVisible()
  } finally { await member.context.close() }
})

test('changing email requires reauthentication when the current sign-in is old', async ({ browser }) => {
  const member = await newMember(browser, 'fresh')
  try {
    const original = await (await member.context.request.get('/api/v1/me')).json()
    await ageSignIn(member.handle, 20)
    await member.page.goto('/settings')
    const form = member.page.locator('form').filter({ has: member.page.getByLabel('Email address', { exact: true }) })
    await form.getByLabel('Email address', { exact: true }).fill(`new_${member.handle}@${MARK.emailDomain}`)
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await member.page.waitForURL((url) => url.pathname === '/login')
    expect((await identity(original.id)).traits.email).toBe(member.email)
    const asked = new Date()
    await member.page.getByRole('button', { name: 'Email me a code', exact: true }).click()
    await member.page.getByLabel('Code from the email').fill(await codeFor(member.email, asked))
    const sent = new Date()
    await member.page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(member.page.getByLabel('Code sent to your new email', { exact: true })).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(member.email)
    const next = `new_${member.handle}@${MARK.emailDomain}`
    await confirm(member.page, await codeFor(next, sent))
    await expect(member.page.getByText('Your changes have been saved!')).toBeVisible()
    expect((await identity(original.id)).traits.email).toBe(next)
  } finally { await member.context.close() }
})
