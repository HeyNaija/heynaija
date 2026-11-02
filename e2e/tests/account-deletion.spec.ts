import { expect, type Page, test } from '@playwright/test'
import { eraseNow } from '../lib/cli.ts'
import { ageSignIn, pool } from '../lib/db.ts'
import { env } from '../lib/env.ts'
import { codeFor, emailWhere } from '../lib/mailpit.ts'
import { newMember, post, replyBox, signIn } from '../lib/members.ts'

// Deleting your own account (docs/adr/0016). Most of this stops at the grace
// period, which erasing waits for; the last test has the operator's command
// bring the erase forward.

/** Where the member's deletion stands in the database. */
async function deletionOf(handle: string) {
  const db = pool()
  try {
    const { rows } = await db.query<{ active: boolean; scheduled: boolean }>(
      `select active, deletion_scheduled_for is not null as scheduled from members where handle = $1`,
      [handle],
    )
    return rows[0]
  } finally {
    await db.end()
  }
}

async function likeCountOf(postId: string) {
  const db = pool()
  try {
    const { rows } = await db.query<{ like_count: number }>(`select like_count from posts where id = $1`, [postId])
    return rows[0]?.like_count
  } finally {
    await db.end()
  }
}

/** The browser's session no longer opens the account: the API says nobody is signed in. */
async function expectSignedOut(page: Page) {
  expect((await page.request.get('/api/v1/me')).status()).toBe(401)
}

/** Waits for the API's worker to erase the member. */
async function waitForErasure(memberId: string, timeoutMs = 60_000) {
  const db = pool()
  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const { rows } = await db.query<{ erased: boolean }>(`select deleted_at is not null as erased from members where id = $1`, [memberId])
      if (rows[0]?.erased) return
      await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(`member ${memberId} was not erased within ${timeoutMs / 1000}s; is the API running with its worker?`)
  } finally {
    await db.end()
  }
}

/** Opens the post with `text` from the page it is on, and returns its address and id. */
async function openPost(page: Page, text: string) {
  // From one post's page to another's the address matches before and after, so wait for it to change.
  const before = page.url()
  await page.locator('article', { hasText: text }).first().getByText(text).click({ position: { x: 4, y: 4 } })
  await page.waitForURL((url) => /^\/p\/[0-9a-f-]+$/.test(url.pathname) && url.href !== before)
  const path = new URL(page.url()).pathname
  return { path, id: path.split('/').pop()! }
}

async function confirm(page: Page, typed: string) {
  await page.getByLabel('Type your handle to confirm').fill(typed)
  await page.getByRole('button', { name: 'Delete my account' }).click()
}

test('a member deletes their account from Settings, is signed out, and keeps it by signing back in', async ({ browser }) => {
  const { handle, email, page, context } = await newMember(browser, 'leaver')
  const since = new Date()
  await page.goto('/settings')
  // Settings sends the browser on to Kratos and back with ?flow= for its sign-in form; a click before then is lost.
  await page.waitForURL((url) => url.searchParams.has('flow'))
  await page.getByRole('link', { name: 'Delete your account' }).click()
  await page.waitForURL((url) => url.pathname === '/settings/delete')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Delete your account')
  await expect(page.getByRole('listitem').filter({ hasText: 'nothing is erased' })).toContainText('For 14 days')
  await expect(page.getByRole('link', { name: 'Download your data' })).toHaveAttribute('href', '/settings/export')

  await confirm(page, 'someone_else')
  await expect(page.getByText('That is not your handle.')).toBeVisible()
  expect(await deletionOf(handle)).toEqual({ active: true, scheduled: false })

  await confirm(page, `@${handle.toUpperCase()}`)
  await page.waitForURL((url) => url.pathname === '/settings/delete/scheduled')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account will be deleted')
  await expect(page.getByRole('main')).toContainText('It will be erased on')
  expect(await deletionOf(handle)).toEqual({ active: false, scheduled: true })
  await expectSignedOut(page)
  await emailWhere(email, since, /^Your HeyNaija account will be deleted on /)

  // Back during the grace period: the date and the choice, instead of the feed.
  await signIn(page, email)
  await expect(page.getByRole('heading', { name: 'Your account is being deleted' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'New post' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Keep my account' }).click()
  await expect(page.getByRole('textbox', { name: 'New post' })).toBeVisible()
  expect(await deletionOf(handle)).toEqual({ active: true, scheduled: false })
  await context.close()
})

test('a sign-in older than 15 minutes is confirmed again before the account is deleted', async ({ browser }) => {
  const { handle, email, page, context } = await newMember(browser, 'stale')
  await ageSignIn(handle, 20)
  await page.goto('/settings/delete')
  await confirm(page, handle)

  // Kratos's own "is it you?" sign-in, which keeps the session.
  await page.waitForURL((url) => url.pathname === '/login')
  expect(await deletionOf(handle)).toEqual({ active: true, scheduled: false })
  const asked = new Date()
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click()
  await page.getByLabel('Code from the email').fill(await codeFor(email, asked))
  await page.getByRole('button', { name: 'Continue', exact: true }).click()

  await page.waitForURL((url) => url.pathname === '/settings/delete')
  await expect(page.getByText('You signed in again.')).toBeVisible()
  await confirm(page, handle)
  await page.waitForURL((url) => url.pathname === '/settings/delete/scheduled')
  expect(await deletionOf(handle)).toEqual({ active: false, scheduled: true })
  await context.close()
})

test('without JavaScript, the account is deleted and the browser signed out', async ({ browser }) => {
  const { handle, context } = await newMember(browser, 'plainleaver')
  const state = await context.storageState()
  await context.close()

  const plain = await browser.newContext({ baseURL: test.info().project.use.baseURL, javaScriptEnabled: false, storageState: state })
  const page = await plain.newPage()
  await page.goto('/settings/delete')
  // A wrong handle changes nothing, and leads to the page that says why.
  await confirm(page, 'someone_else')
  await page.waitForURL((url) => url.pathname === '/settings/delete/refused/handle')
  await expect(page.getByText('That is not your handle.')).toBeVisible()
  expect(await deletionOf(handle)).toEqual({ active: true, scheduled: false })

  await confirm(page, handle)
  await page.waitForURL((url) => url.pathname === '/settings/delete/scheduled')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account will be deleted')
  expect(await deletionOf(handle)).toEqual({ active: false, scheduled: true })
  await expectSignedOut(page)
  await plain.close()
})

test('an erased account is gone for good, while other members’ conversations keep their place', async ({ browser }) => {
  const leaver = await newMember(browser, 'erased')
  const neighbour = await newMember(browser, 'stays')

  // The leaver posts, the neighbour replies and posts, and the leaver likes the neighbour's post.
  const original = `Soon to be gone, says ${leaver.handle}`
  await post(leaver.page, original)
  const { path } = await openPost(leaver.page, original)
  const answer = `Still here, replies ${neighbour.handle}`
  await neighbour.page.goto(path)
  await (await replyBox(neighbour.page)).fill(answer)
  await neighbour.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(neighbour.page.locator('article', { hasText: answer })).toBeVisible()
  const reply = await openPost(neighbour.page, answer)

  const kept = `Liked by someone who left, says ${neighbour.handle}`
  await post(neighbour.page, kept)
  const { path: keptPath, id: keptId } = await openPost(neighbour.page, kept)
  await leaver.page.goto(keptPath)
  const liked = leaver.page.locator('article', { hasText: kept }).first()
  await liked.getByRole('button', { name: /^Like \(0 likes\)$/ }).click()
  await expect(liked.getByRole('button', { name: /^Unlike \(1 like\)$/ })).toHaveAttribute('aria-pressed', 'true')
  // The button changes before the like is saved; another browser sees it only once it is.
  await expect.poll(() => likeCountOf(keptId)).toBe(1)
  await neighbour.page.reload()
  await expect(neighbour.page.locator('article', { hasText: kept }).first().getByRole('button', { name: /^Like \(1 like\)$/ })).toBeVisible()

  const since = new Date()
  const { memberId } = eraseNow(leaver.handle)
  await waitForErasure(memberId)

  // The profile is gone, and the address does not bounce to somewhere else.
  await neighbour.page.goto(`/u/${leaver.handle}`)
  await expect(neighbour.page.getByRole('heading', { level: 1 })).toHaveText('Nothing here')
  expect(new URL(neighbour.page.url()).pathname).toBe(`/u/${leaver.handle}`)

  // The old handle is held for 30 days, so nobody can take it straight away.
  const db = pool()
  try {
    const { rows } = await db.query(`select 1 from released_handles where handle = $1 and member_id = $2`, [leaver.handle, memberId])
    expect(rows).toHaveLength(1)
  } finally {
    await db.end()
  }

  // Their post is no longer available (its own page no longer opens), and the reply to it stays.
  await neighbour.page.goto(path)
  await expect(neighbour.page.getByRole('heading', { level: 1 })).toHaveText('Nothing here')
  await neighbour.page.goto(reply.path)
  await expect(neighbour.page.locator('article', { hasText: answer }).first()).toBeVisible()
  await expect(neighbour.page.getByText('This post is no longer available.')).toBeVisible()
  await expect(neighbour.page.getByText(original)).toHaveCount(0)

  // Their like is gone from the count.
  await neighbour.page.goto(keptPath)
  await expect(neighbour.page.locator('article', { hasText: kept }).first().getByRole('button', { name: /^Like \(0 likes\)$/ })).toBeVisible()

  // Kratos has forgotten the identity, and the member was told.
  const identity = await fetch(`${env.kratosAdminUrl}/admin/identities/${memberId}`)
  expect(identity.status).toBe(404)
  await emailWhere(leaver.email, since, /^Your HeyNaija account has been deleted$/)

  await leaver.context.close()
  await neighbour.context.close()
})
