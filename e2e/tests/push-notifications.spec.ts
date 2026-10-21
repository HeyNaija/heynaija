import { expect, type Page, test } from '@playwright/test'
import { ageNotifications, pushSubscriptionCount, waitForEmailJob, waitForPushJob } from '../lib/db.ts'
import { countFor, emailWhere } from '../lib/mailpit.ts'
import { type Member, newMember, post, replyBox } from '../lib/members.ts'
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
