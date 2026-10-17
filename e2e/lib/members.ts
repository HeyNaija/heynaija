// Members made the way people are: an invite, the sign-up form, an emailed code.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { createInvite } from './cli.ts'
import { MARK } from './env.ts'
import { codeFor } from './mailpit.ts'

/**
 * Short and unique per run and per worker (each Playwright worker loads this
 * module separately), so handles stay within the 20-character limit.
 */
const run = `${Date.now().toString(36).slice(-4)}${process.env.TEST_WORKER_INDEX ?? '0'}`
let counter = 0

export type Member = { handle: string; email: string; context: BrowserContext; page: Page }

/** A handle for a new test member: e2e_<run><worker><n>_<role>, at most 20 characters. */
export function handleFor(role: string) {
  counter += 1
  return `${MARK.handlePrefix}${run}${counter}_${role}`.slice(0, 20).toLowerCase()
}

/** Signs a new member up through the UI in `page`. */
export async function signUp(page: Page, handle: string) {
  const email = await submitSignUp(page, handle)
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByLabel('Account menu')).toBeVisible()
  return email
}

/**
 * Goes through the whole sign-up form with a fresh invite, up to and including
 * the emailed code, without checking that it worked.
 */
export async function submitSignUp(page: Page, handle: string, email = `${handle}@${MARK.emailDomain}`) {
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
  await page.getByRole('button', { name: 'Continue' }).click()
  return email
}

/** Signs an existing member in with an emailed code. */
export async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  const asked = new Date()
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code from the email').fill(await codeFor(email, asked))
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(page.getByLabel('Account menu')).toBeVisible()
}

/**
 * A new member signed up in a browser context of their own. The context copies
 * the running project's device and base URL, which browser.newContext does not.
 */
export async function newMember(browser: Browser, role: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<Member> {
  const use = test.info().project.use
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
    javaScriptEnabled: use.javaScriptEnabled,
    ...options,
  })
  const page = await context.newPage()
  const handle = handleFor(role)
  const email = await signUp(page, handle)
  return { handle, email, context, page }
}

/** Posts `text` from the composer at the top of the home feed and waits for it to appear. */
export async function post(page: Page, text: string, community?: string) {
  await page.goto('/')
  // The textbox, not the mobile "+" link, which shares the "New post" name.
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await box.fill(text)
  if (community) await page.getByLabel('Post to').selectOption({ label: community })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  const article = page.locator('article', { hasText: text }).first()
  await expect(article).toBeVisible()
  return article
}

/**
 * A thread page's reply box, once it sits under the post it replies to (any
 * post, unless `postId` is given). It is drawn under the post in focus; choosing
 * another post to reply to moves it there, and the move replaces the textarea,
 * so text typed into the old one would be lost and Reply would stay disabled.
 */
export async function replyBox(page: Page, postId?: string) {
  const host = postId ? page.locator(`#thread-editor-${postId}`) : page.locator('[id^="thread-editor-"]')
  const box = host.getByRole('textbox', { name: 'Your reply' })
  await expect(box).toBeVisible()
  return box
}
