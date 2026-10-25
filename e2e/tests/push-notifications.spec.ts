import { expect, type Page, test } from '@playwright/test'
import { ageNotifications, pushSubscriptionCount, waitForEmailJob, waitForPushJob } from '../lib/db.ts'
import { countFor, emailWhere } from '../lib/mailpit.ts'
import { handleFor, type Member, newMember, post, replyBox, signUpOverHttp } from '../lib/members.ts'
import { allowPush, standInPushService, waitForPushes } from '../lib/push.ts'

// See lib/push.ts: the browser's push service is a stand-in on this machine, which
// the API sends to only when PUSH_ALLOW_LOOPBACK is on (pnpm infra:env sets it).
test.skip(process.env.PUSH_ALLOW_LOOPBACK !== 'true', 'push needs pnpm infra:env, then an API restart')
test.setTimeout(240_000)

let service: Awaited<ReturnType<typeof standInPushService>>
test.beforeAll(async () => {
  service = await standInPushService()
})
test.afterAll(() => service.close())

const pushGroup = (page: Page) => page.getByRole('group', { name: 'Push notifications' })

async function open(author: Member, text: string) {
  const card = await post(author.page, text)
  await card.getByText(text).click({ position: { x: 4, y: 4 } })
  await author.page.waitForURL(/\/p\/[0-9a-f-]+$/)
  const path = new URL(author.page.url()).pathname
  return { path, id: path.split('/').pop()! }
}

test('a reply is pushed to the browser that turned push on, and is not emailed as well', async ({ browser }) => {
  const author = await newMember(browser, 'pushed')
  const fan = await newMember(browser, 'pusher')
  const phone = service.subscription(author.handle)
  await allowPush(author.context, test.info().project.use.baseURL!, phone)
  const since = new Date()

  await author.page.goto('/settings')
  const group = pushGroup(author.page)
  await expect(group).toContainText('Only the account signed in here gets them')
  await group.getByRole('button', { name: 'Turn on push notifications' }).click()
  await expect(group.getByText('On for this device.')).toBeVisible()
  await expect(group.getByRole('button', { name: 'Turn off on this device' })).toBeVisible()
  expect(await pushSubscriptionCount(author.handle)).toBe(1)
  // It stays on across visits.
  await author.page.reload()
  await expect(pushGroup(author.page).getByRole('button', { name: 'Turn off on this device' })).toBeVisible()

  const text = `Push me about this, says ${author.handle}`
  const { path, id } = await open(author, text)
  const answer = `A pushed answer from ${fan.handle}`
  await fan.page.goto(path)
  await (await replyBox(fan.page, id)).fill(answer)
  await fan.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(fan.page.locator('article', { hasText: answer })).toBeVisible()

  // Within seconds, not the minutes email waits: what the service worker shows.
  const [message] = await waitForPushes(service, phone)
  expect(message!.title).toBe(`@${fan.handle} replied to your post`)
  expect(message!.body).toBe(`“${answer}”`)
  expect(message!.url).toMatch(/^\/p\/[0-9a-f-]{36}$/)
  expect(message!.tag).toBe(`reply:${message!.url.split('/').pop()}`)

  // Email is on for a new member, and it still sends nothing for what was pushed.
  await waitForPushJob(author.handle)
  await ageNotifications(author.handle)
  await waitForEmailJob(author.handle)
  expect(await countFor(author.email, since)).toBe(0)

  // Push off again: the next like is emailed, and the pushed reply is not in it.
  await author.page.goto('/settings')
  await pushGroup(author.page).getByRole('button', { name: 'Turn off on this device' }).click()
  await expect(pushGroup(author.page).getByRole('button', { name: 'Turn on push notifications' })).toBeVisible()
  expect(await pushSubscriptionCount(author.handle)).toBe(0)
  await fan.page.goto(path)
  const focused = fan.page.locator('article', { hasText: text }).first()
  await focused.getByRole('button', { name: /^Like \(\d+ likes?\)$/ }).click()
  await expect(focused.getByRole('button', { name: /^Unlike \(\d+ likes?\)$/ })).toHaveAttribute('aria-pressed', 'true')
  await waitForPushJob(author.handle)
  await ageNotifications(author.handle)
  const mail = await emailWhere(author.email, since, /liked your post/)
  expect(mail.subject).toBe(`@${fan.handle} liked your post`)
  expect(mail.text).not.toContain(answer)
  expect(service.messagesFor(phone)).toHaveLength(1)

  await author.context.close()
  await fan.context.close()
})

test('signing out stops the pushes to that browser', async ({ browser }) => {
  const member = await newMember(browser, 'leaver')
  const laptop = service.subscription(member.handle)
  await allowPush(member.context, test.info().project.use.baseURL!, laptop)
  await member.page.goto('/settings')
  await pushGroup(member.page).getByRole('button', { name: 'Turn on push notifications' }).click()
  await expect(pushGroup(member.page).getByText('On for this device.')).toBeVisible()
  expect(await pushSubscriptionCount(member.handle)).toBe(1)

  await member.page.getByLabel('Account menu').click()
  await member.page.getByRole('link', { name: 'Sign out' }).click()
  await expect(member.page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible()
  expect(await pushSubscriptionCount(member.handle)).toBe(0)
  await member.context.close()
})

test('on an iPhone, Settings explains that push needs HeyNaija on the Home Screen', async ({ browser }) => {
  const member = await newMember(browser, 'iphone', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  })
  await member.page.goto('/settings')
  const group = pushGroup(member.page)
  await expect(group).toContainText('add HeyNaija to your Home Screen first')
  await expect(group.getByRole('button')).toHaveCount(0)
  await member.context.close()
})

test('a newcomer turns push on in the welcome flow, and lands on home', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  const handle = handleFor('welcomed')
  await allowPush(context, test.info().project.use.baseURL!, service.subscription(handle))
  await signUpOverHttp(page, handle, { welcome: 'stay' })
  await page.getByRole('link', { name: 'Skip this step' }).click()
  await page.getByRole('button', { name: 'Skip this step' }).click()

  await page.waitForURL((url) => url.searchParams.get('step') === 'notifications')
  const panel = page.getByRole('region', { name: 'Notifications on this device' })
  await expect(panel).toContainText('Only this device gets them')
  await panel.getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(panel.getByRole('status')).toHaveText('Notifications are on for this device.')
  expect(await pushSubscriptionCount(handle)).toBe(1)
  // The button is gone; the way on is focused in its place.
  await expect(panel.getByRole('link', { name: 'Continue' })).toBeFocused()
  await panel.getByRole('link', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Say hello to the town square' })).toBeVisible()
  // On in Settings too: it is the same switch.
  await page.goto('/settings')
  await expect(pushGroup(page).getByRole('button', { name: 'Turn off on this device' })).toBeVisible()
  await context.close()
})

test('on an iPhone, the welcome flow shows how to add HeyNaija to the Home Screen', async ({ browser }) => {
  const member = await newMember(browser, 'iwelcome', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  })
  await member.page.goto('/welcome?step=notifications')
  const panel = member.page.getByRole('region', { name: 'Add HeyNaija to your Home Screen' })
  await expect(panel.getByRole('listitem')).toHaveText([/Tap Share/, /Add to Home Screen/, /Open HeyNaija from your Home Screen/])
  await expect(panel.getByRole('button')).toHaveCount(0)
  await panel.getByRole('link', { name: 'Continue' }).click()
  await expect(member.page.getByRole('heading', { name: 'Say hello to the town square' })).toBeVisible()
  await member.context.close()
})

/** Makes the pages in `context` believe they are HeyNaija opened from the Home Screen, not a tab. */
async function openAsInstalledApp(context: Member['context']) {
  await context.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (query: string) =>
      query === '(display-mode: standalone)' ? ({ ...real(query), matches: true, media: query } as MediaQueryList) : real(query)
  })
}

test('the installed app offers push on the home page until it is on or put off', async ({ browser }) => {
  const card = (page: Page) => page.getByRole('region', { name: /^(Turn on notifications|Notifications are on)$/ })

  // In a browser tab, Settings has the switch and home says nothing.
  const later = await newMember(browser, 'applater')
  await allowPush(later.context, test.info().project.use.baseURL!, service.subscription(later.handle))
  await later.page.goto('/')
  await later.page.waitForLoadState('networkidle')
  await expect(card(later.page)).toHaveCount(0)
  // As the app: offered, and "Not now" holds on this device.
  await openAsInstalledApp(later.context)
  await later.page.reload()
  await card(later.page).getByRole('button', { name: 'Not now' }).click()
  await expect(card(later.page)).toHaveCount(0)
  await later.page.reload()
  await later.page.waitForLoadState('networkidle')
  await expect(card(later.page)).toHaveCount(0)
  await later.context.close()

  const now = await newMember(browser, 'appnow')
  await allowPush(now.context, test.info().project.use.baseURL!, service.subscription(now.handle))
  await openAsInstalledApp(now.context)
  await now.page.goto('/')
  await card(now.page).getByRole('button', { name: 'Turn on notifications' }).click()
  await expect(card(now.page).getByRole('heading')).toHaveText('Notifications are on')
  expect(await pushSubscriptionCount(now.handle)).toBe(1)
  await card(now.page).getByRole('button', { name: 'Done' }).click()
  await now.page.reload()
  await now.page.waitForLoadState('networkidle')
  await expect(card(now.page)).toHaveCount(0)
  await now.context.close()
})
