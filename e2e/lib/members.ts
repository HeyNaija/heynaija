// Members made the way people are: an invite, Kratos's sign-up flow, an emailed
// code. Through the pages (signUp) where the sign-up itself is being tested, and
// over HTTP (signUpOverHttp, newMember) everywhere else.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { createInvite } from './cli.ts'
import { env, MARK } from './env.ts'
import { codeFor } from './mailpit.ts'

/** Kratos's session cookie (infra/kratos/kratos.yml). */
const SESSION_COOKIE = 'hn_session'

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

/**
 * Signs a new member up through the sign-up pages in `page`. Newcomers land on
 * the welcome flow; this skips it and waits for the home page, unless `welcome`
 * is 'stay'. For a test that is not about signing up, signUpOverHttp is quicker.
 */
export async function signUp(page: Page, handle: string, { welcome = 'skip' }: { welcome?: 'skip' | 'stay' } = {}) {
  const email = await submitSignUp(page, handle)
  await page.waitForURL((url) => url.pathname === '/welcome')
  await expect(page.getByLabel('Account menu')).toBeVisible()
  if (welcome === 'skip') {
    await page.getByRole('button', { name: 'Skip setup' }).click()
    await page.waitForURL((url) => url.pathname === '/')
    await expect(page.getByLabel('Account menu')).toBeVisible()
  }
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

/**
 * Signs a new member up without the sign-up pages and gives `page`'s browser
 * their session, then opens home, or /welcome if `welcome` is 'stay'. Kratos
 * and the API do everything they do for the form (the invite and age checks,
 * spending the invite), but next dev renders one page instead of five; that
 * more than halved the CPU two sign-up-heavy specs took (docs/e2e.md).
 * auth.spec.ts covers the pages.
 */
export async function signUpOverHttp(page: Page, handle: string, { welcome = 'skip' }: { welcome?: 'skip' | 'stay' } = {}) {
  const email = `${handle}@${MARK.emailDomain}`
  const session = await register(email, handle)
  if (welcome === 'skip') {
    const res = await fetch(`${env.apiUrl}/v1/me/onboarding/skip`, {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    })
    if (!res.ok) throw new Error(`skipping ${handle}'s welcome flow: ${res.status}`)
  }
  await page.context().addCookies([{ name: SESSION_COOKIE, value: session, url: env.baseUrl, httpOnly: true, sameSite: 'Lax' }])
  await page.goto('/')
  if (welcome === 'stay') await page.waitForURL((url) => url.pathname === '/welcome')
  await expect(page.getByLabel('Account menu')).toBeVisible()
  return email
}

type KratosFlow = {
  id: string
  state?: string
  ui: { messages?: { text: string }[]; nodes: { attributes: { name?: string; value?: unknown }; messages: { text: string }[] }[] }
}

/**
 * Kratos's browser registration flow, driven with fetch the way the sign-up form
 * drives it: the invite and the age confirmation in the cookies /join sets
 * (Kratos hands them to the API's invite webhook), the traits, then the emailed
 * code. Returns the new session cookie's value.
 */
async function register(email: string, handle: string): Promise<string> {
  // Stored as acceptInvite (apps/web/app/actions.ts) stores them.
  const jar = new Map([
    ['hn_invite', createInvite().replace(/[^0-9A-Z]/g, '')],
    ['hn_age', '18-plus'],
  ])
  const call = async (path: string, body?: object) => {
    const res = await fetch(`${env.kratosPublicUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        accept: 'application/json',
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body && JSON.stringify(body),
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';')
      jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1))
    }
    return { status: res.status, flow: (await res.json()) as KratosFlow }
  }
  const said = (flow: KratosFlow) =>
    [...(flow.ui?.messages ?? []), ...(flow.ui?.nodes ?? []).flatMap((node) => node.messages)].map((m) => m.text).join(' ') ||
    JSON.stringify(flow).slice(0, 300)

  const { flow } = await call('/self-service/registration/browser')
  const csrf = flow.ui.nodes.find((node) => node.attributes.name === 'csrf_token')?.attributes.value
  const submit = (extra: object) =>
    call(`/self-service/registration?flow=${flow.id}`, { method: 'code', csrf_token: csrf, traits: { email, handle }, ...extra })

  const asked = new Date()
  const sent = await submit({})
  if (sent.flow.state !== 'sent_email') throw new Error(`no sign-up code sent to ${email}: ${said(sent.flow)}`)
  const done = await submit({ code: await codeFor(email, asked) })
  const session = jar.get(SESSION_COOKIE)
  if (done.status !== 200 || !session) throw new Error(`signing up ${handle} failed (${done.status}): ${said(done.flow)}`)
  return session
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
 * A new member signed up (over HTTP) in a browser context of their own, on the
 * home page. The context copies the running project's device and base URL,
 * which browser.newContext does not.
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
  const email = await signUpOverHttp(page, handle)
  return { handle, email, context, page }
}

/**
 * Posts `text` from the composer at the top of the home feed and waits for it to appear.
 * `find` is what to look for in the post once it is on screen, when the page shows the
 * text differently from how it was typed (an address is shown without its https://).
 */
export async function post(page: Page, text: string, community?: string, find = text) {
  await page.goto('/')
  // The textbox, not the mobile "+" link, which shares the "New post" name.
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await box.fill(text)
  if (community) await page.getByLabel('Post to').selectOption({ label: community })
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  const article = page.locator('article', { hasText: find }).first()
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
