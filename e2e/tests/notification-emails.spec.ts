import { expect, type Page, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { ageNotifications, waitForEmailJob, waitForPushJob } from '../lib/db.ts'
import { countFor, emailWhere } from '../lib/mailpit.ts'
import { type Member, newMember, post, replyBox } from '../lib/members.ts'

// Notification emails wait a few minutes in real life, so that a burst becomes one
// email. These tests age the notifications (ageNotifications) rather than wait, and
// then wait for the email job, which looks every few seconds to a minute.
test.setTimeout(240_000)

const emailBox = (page: Page) =>
  page
    .locator('section', { has: page.getByRole('heading', { name: 'Notifications', exact: true }) })
    .getByLabel('Email me my notifications')

/** The post's page path, reached by opening it from the feed. */
async function open(author: Member, text: string) {
  const card = await post(author.page, text)
  await card.getByText(text).click({ position: { x: 4, y: 4 } })
  await author.page.waitForURL(/\/p\/[0-9a-f-]+$/)
  const path = new URL(author.page.url()).pathname
  return { path, id: path.split('/').pop()! }
}

async function reply(fan: Member, path: string, id: string, text: string) {
  await fan.page.goto(path)
  await (await replyBox(fan.page, id)).fill(text)
  await fan.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(fan.page.locator('article', { hasText: text })).toBeVisible()
}

async function like(fan: Member, path: string, text: string) {
  await fan.page.goto(path)
  const focused = fan.page.locator('article', { hasText: text }).first()
  await focused.getByRole('button', { name: /^Like \(\d+ likes?\)$/ }).click()
  await expect(focused.getByRole('button', { name: /^Unlike \(\d+ likes?\)$/ })).toHaveAttribute('aria-pressed', 'true')
}

test('a reply is emailed with a link that turns email off, and nothing is emailed after that', async ({ browser }) => {
  const author = await newMember(browser, 'mailed')
  const fan = await newMember(browser, 'replier')
  const since = new Date()

  const text = `Email me about this, says ${author.handle}`
  const { path, id } = await open(author, text)
  const answer = `Here is an answer from ${fan.handle}`
  await reply(fan, path, id, answer)

  // The notification is in the app at once; the email waits for company. (Opening
  // Notifications would mark it read, and what has been read is not emailed.)
  expect(await countFor(author.email, since)).toBe(0)
  await ageNotifications(author.handle)

  const mail = await emailWhere(author.email, since, /replied to your post/)
  expect(mail.subject).toBe(`@${fan.handle} replied to your post`)
  expect(mail.text).toContain(answer)
  expect(mail.text).toContain(`/p/`)
  // Why it was sent, and where to change it.
  expect(mail.text).toContain(`email notifications are on for @${author.handle} on HeyNaija`)
  expect(mail.text).toMatch(/\/settings/)
  expect(mail.html).toContain('Open your notifications')

  // The header a mail program's Unsubscribe button uses, and the same link in the body.
  const header = mail.headers['List-Unsubscribe']?.[0] ?? ''
  const link = header.match(/^<(https?:\/\/[^>]+)>$/)?.[1]
  expect(link, `List-Unsubscribe was ${header}`).toBeTruthy()
  expect(mail.headers['List-Unsubscribe-Post']?.[0]).toBe('List-Unsubscribe=One-Click')
  expect(mail.text).toContain(link!)
  expect(link).toMatch(/\/api\/v1\/email\/unsubscribe\/[0-9a-f-]{36}\.[\w-]+$/)

  // Following it needs no login: a browser that is signed in as nobody.
  const stranger = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await stranger.newPage()
  await page.goto(new URL(link!).pathname)
  await expect(page).toHaveURL(/\/email-off$/)
  await expect(page.getByRole('heading', { name: 'Email notifications are off' })).toBeVisible()
  await expect(page.getByText('You will still see them in HeyNaija')).toBeVisible()
  await stranger.close()

  // Email is off in Settings, and only email: every kind is still on.
  await author.page.goto('/settings')
  await expect(emailBox(author.page)).not.toBeChecked()
  const section = author.page.locator('section', { has: author.page.getByRole('heading', { name: 'Notifications', exact: true }) })
  for (const label of ['replies to your post', 'mentions you', 'likes your post', 'reposts your post', 'quotes your post', 'follows you']) {
    await expect(section.getByLabel(new RegExp(`^Someone ${label}$`))).toBeChecked()
  }

  // A tampered link changes nothing and says so.
  const bad = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const badPage = await bad.newPage()
  await badPage.goto(`${new URL(link!).pathname.slice(0, -4)}AAAA`)
  await expect(badPage.getByRole('heading', { name: 'That link did not work' })).toBeVisible()
  await bad.close()

  // New activity is still a notification in the app, and no email follows it.
  const after = new Date()
  await reply(fan, path, id, `And another from ${fan.handle}`)
  await ageNotifications(author.handle)
  await waitForEmailJob(author.handle)
  expect(await countFor(author.email, after)).toBe(0)
  await author.page.goto('/notifications')
  await expect(author.page.getByText(`@${fan.handle} replied to your post`)).toHaveCount(2)

  await author.context.close()
  await fan.context.close()
})

test('a burst of activity is one email, and the one-click unsubscribe of mail programs works', async ({ browser, request }) => {
  const author = await newMember(browser, 'burst')
  const first = await newMember(browser, 'fan1')
  const second = await newMember(browser, 'fan2')
  const since = new Date()

  const text = `Likes welcome, says ${author.handle}`
  const { path } = await open(author, text)
  await like(first, path, text)
  await like(second, path, text)
  await second.page.goto(`/u/${author.handle}`)
  await second.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(second.page.getByRole('main').getByRole('button', { name: 'Following' })).toBeVisible()

  // An email takes only what the push job has finished with. Aged before it reaches
  // the follow, the likes would go out alone and the follow in a second email.
  await waitForPushJob(author.handle)
  await ageNotifications(author.handle)
  const mail = await emailWhere(author.email, since, /new notifications/)
  expect(mail.subject).toBe('3 new notifications on HeyNaija')
  expect(mail.text).toMatch(new RegExp(`@(${first.handle}|${second.handle}) and @(${first.handle}|${second.handle}) liked your post`))
  expect(mail.text).toContain(`@${second.handle} followed you`)
  expect(mail.text).toContain(text)

  // Nothing else follows it, however long the job keeps looking.
  await waitForEmailJob(author.handle)
  await new Promise((r) => setTimeout(r, 12_000))
  expect(await countFor(author.email, since)).toBe(1)

  // What a mail program does for its Unsubscribe button: a POST with no login and no page.
  const link = new URL(mail.headers['List-Unsubscribe']![0]!.slice(1, -1)).pathname
  const res = await request.post(link, { form: { 'List-Unsubscribe': 'One-Click' } })
  expect(res.status()).toBe(204)
  await author.page.goto('/settings')
  await expect(emailBox(author.page)).not.toBeChecked()
  // Again is harmless, and a forged one is refused.
  expect((await request.post(link, { form: { 'List-Unsubscribe': 'One-Click' } })).status()).toBe(204)
  expect((await request.post(`${link.slice(0, -4)}AAAA`, { form: { 'List-Unsubscribe': 'One-Click' } })).status()).toBe(400)

  await Promise.all([author, first, second].map((m) => m.context.close()))
})

test('email is a setting: it is kept, and the kinds a member turned off stay out of their email', async ({ browser }) => {
  const author = await newMember(browser, 'chooser')
  const fan = await newMember(browser, 'doer')

  // Off in Settings, and still off after a reload.
  await author.page.goto('/settings')
  await expect(emailBox(author.page)).toBeChecked()
  const section = author.page.locator('section', { has: author.page.getByRole('heading', { name: 'Notifications', exact: true }) })
  await emailBox(author.page).uncheck()
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(section.getByRole('status')).toHaveText('Saved.')
  await author.page.reload()
  await expect(emailBox(author.page)).not.toBeChecked()

  const text = `A post to answer, from ${author.handle}`
  const { path, id } = await open(author, text)
  const quiet = new Date()
  await reply(fan, path, id, `Reply while email is off, ${fan.handle}`)
  await ageNotifications(author.handle)
  await waitForEmailJob(author.handle)
  expect(await countFor(author.email, quiet)).toBe(0)

  // On again, with likes off: the reply is emailed, the like is not even a notification.
  await author.page.goto('/settings')
  await emailBox(author.page).check()
  await section.getByLabel('Someone likes your post').uncheck()
  await section.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(section.getByRole('status')).toHaveText('Saved.')
  await author.page.reload()
  await expect(emailBox(author.page)).toBeChecked()
  await expect(section.getByLabel('Someone likes your post')).not.toBeChecked()

  const since = new Date()
  await like(fan, path, text)
  const answer = `Reply while email is on, ${fan.handle}`
  await reply(fan, path, id, answer)
  await ageNotifications(author.handle)
  const mail = await emailWhere(author.email, since, /replied to your post/)
  expect(mail.subject).toBe(`@${fan.handle} replied to your post`)
  expect(mail.text).toContain(answer)
  expect(mail.text).not.toContain('liked your post')
  // The reply from before email was on is not sent now.
  expect(mail.text).not.toContain('while email is off')

  await author.context.close()
  await fan.context.close()
})

test('a moderator’s decision is emailed in general words, with nothing from the post', async ({ browser }) => {
  const author = await newMember(browser, 'removed')
  const reporter = await newMember(browser, 'reporter')
  const moderator = await newMember(browser, 'judge')
  grantModerator(moderator.handle)
  const since = new Date()

  const text = `Buy followers cheap, from ${author.handle}`
  await post(author.page, text)
  await reporter.page.goto('/?feed=latest')
  const article = reporter.page.locator('article', { hasText: text })
  await article.getByLabel('Post options').click()
  await article.getByRole('link', { name: 'Report post' }).click()
  await reporter.page.getByLabel('Spam').check()
  await reporter.page.getByRole('button', { name: 'Send report' }).click()
  await expect(reporter.page.getByRole('button', { name: 'Send report' })).toHaveCount(0)

  await moderator.page.goto('/mod')
  const item = moderator.page.locator('form', { hasText: text })
  await item.getByRole('button', { name: 'Remove post' }).click()
  await expect(moderator.page.locator('form', { hasText: text })).toHaveCount(0)

  await ageNotifications(author.handle)
  await ageNotifications(reporter.handle)
  const removed = await emailWhere(author.email, since, /removed one of your posts/)
  expect(removed.subject).toBe('A moderator removed one of your posts')
  for (const part of [removed.subject, removed.text, removed.html]) {
    expect(part).not.toContain('Buy followers')
    expect(part).not.toMatch(/spam/i)
  }
  const reviewed = await emailWhere(reporter.email, since, /reviewed a report you made/)
  expect(reviewed.text).toContain('A moderator reviewed a report you made')

  await Promise.all([author, reporter, moderator].map((m) => m.context.close()))
})
