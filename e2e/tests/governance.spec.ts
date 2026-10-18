import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

const documents = [
  { path: '/rules', heading: 'HeyNaija rules' },
  { path: '/privacy', heading: 'Privacy policy' },
  { path: '/charter', heading: 'HeyNaija charter' },
  { path: '/licence', heading: 'Licence' },
]

test('the rules say the 18+ account rule is temporary, and voting stays 18+', async ({ page }) => {
  await page.goto('/rules#age')
  const age = page.locator('#age')
  await expect(age).toContainText('The 18+ rule is temporary, for the beta.')
  await expect(age).toContainText('voting in HeyNaija’s governance would stay 18+')
  await page.goto('/privacy#age')
  await expect(page.locator('#age')).toContainText('not treated as confirmed adults')
})

test('the governance documents are public and say they are drafts @mobile', async ({ page }) => {
  for (const doc of documents) {
    await page.goto(doc.path)
    await expect(page.getByRole('heading', { level: 1, name: doc.heading })).toBeVisible()
    await expect(page.getByRole('note')).toContainText('has not been reviewed by a lawyer')
    // Every document links to the draft constitution from its footer.
    await expect(page.locator('.policy-footer').getByRole('link', { name: 'Draft constitution' })).toBeVisible()
  }
  // The governance page lists all of them.
  await page.goto('/governance')
  const list = page.locator('#documents')
  for (const name of ['Charter', 'Rules', 'Privacy policy', 'Draft constitution', 'Licence']) {
    await expect(list.getByRole('link', { name, exact: true })).toBeVisible()
  }
})

test('the governance page says plainly what is and is not live @mobile', async ({ page }) => {
  await page.goto('/governance')
  await expect(page.getByRole('heading', { level: 1, name: 'A social network shaped by its community.' })).toBeVisible()
  await expect(page.getByRole('note').first()).toContainText(
    'Founding stage. HeyNaija is not legally community-owned yet. Governance proposals and voting rules are drafts. No binding community vote or treasury is currently live.',
  )
  await expect(page.getByText('Proposed, not yet in effect')).toBeVisible()

  // The three ways to take part are told apart.
  const participation = page.locator('#participation')
  for (const name of ['Regular account', 'NIN-verified account', 'Voting member']) {
    await expect(participation.getByRole('heading', { name })).toBeVisible()
  }

  // Empty states, not invented records.
  await expect(page.locator('#treasury')).toContainText('No treasury records')
  await expect(page.locator('#decisions')).toContainText('No decisions recorded yet')
  await expect(page.locator('#votes')).toContainText('No proposals have been submitted')

  // Ownership milestones carry their status in words, and none claims the transfer happened.
  const milestones = page.locator('#ownership .milestone')
  await expect(milestones).toHaveCount(7)
  await expect(page.locator('#ownership')).not.toContainText('Completed')

  // No feedback link that goes nowhere.
  await expect(page.getByText('Feedback channel being prepared').first()).toBeVisible()

  // Fits a phone screen without sideways scrolling.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the draft constitution is complete, versioned and marked as a draft', async ({ page }) => {
  await page.goto('/governance/constitution')
  await expect(page.getByRole('heading', { level: 1, name: 'HeyNaija Governance Constitution' })).toBeVisible()
  await expect(page.getByText(/Draft v0\.2 · Last updated 16 October 2026/)).toBeVisible()
  await expect(page.getByRole('note').first()).toContainText('Not yet adopted or legally operative')

  const contents = page.getByRole('navigation', { name: 'On this page' })
  for (let n = 1; n <= 14; n++) {
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^Article ${n} — `) })).toBeVisible()
    await expect(contents.getByRole('link', { name: new RegExp(`^Article ${n} — `) })).toHaveAttribute('href', `#article-${n}`)
  }
  for (const name of [/^Annex A/, /^Annex B/, /^Version history/]) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
  }
  await contents.getByRole('link', { name: /^Article 8 — / }).click()
  await expect(page).toHaveURL(/#article-8$/)
  await expect(page.getByRole('heading', { level: 2, name: /^Article 8 — / })).toBeInViewport()
})

test('the verification explainer asks for nothing and promises nothing it cannot do', async ({ page }) => {
  await page.goto('/governance/verification')
  await expect(page.getByRole('heading', { level: 1, name: 'Identity verification' })).toBeVisible()
  await expect(page.getByText('Coming soon; not collecting NIN details.').first()).toBeVisible()

  // No field to type a NIN into, no file upload, and no button that pretends to verify.
  const main = page.locator('main')
  await expect(main.locator('input, textarea, select')).toHaveCount(0)
  await expect(main.getByRole('button', { name: /verify/i })).toHaveCount(0)

  // Every question in the FAQ opens.
  const questions = page.locator('#faq details')
  await expect(questions).toHaveCount(10)
  await questions.filter({ hasText: 'Does NIN prove citizenship?' }).locator('summary').click()
  await expect(page.getByText('NIMC issues NINs to Nigerian citizens and to legal residents')).toBeVisible()

  // The design preview of the tick has a text name and explains itself on keyboard focus.
  const preview = page.locator('#green-tick')
  const tick = preview.getByRole('link', { name: /NIN identity verified/ }).first()
  await tick.focus()
  const tip = preview.getByRole('tooltip').first()
  await expect(tip).toBeVisible()
  await expect(tip).toHaveText('Identity was verified; this does not mean HeyNaija endorses this account or its posts.')
  await page.keyboard.press('Escape')
  await expect(tip).toBeHidden()
})

test('voting membership says registration has not opened', async ({ page }) => {
  await page.goto('/governance/membership')
  await expect(page.getByRole('heading', { level: 1, name: 'Voting membership' })).toBeVisible()
  await expect(page.getByText('Voting membership registration has not opened.')).toBeVisible()
  // Accounts and voting have different age rules, and the account one is temporary.
  const age = page.locator('section', { has: page.getByRole('heading', { name: 'Age: accounts and voting are different' }) })
  await expect(age).toContainText('temporary beta rule')
  await expect(age).toContainText('confirmed by a check')
  // The governance pages link to each other, and the current one is marked.
  const tabs = page.getByRole('navigation', { name: 'Governance pages' })
  await expect(tabs.getByRole('link', { name: 'Voting membership' })).toHaveAttribute('aria-current', 'page')
  await tabs.getByRole('link', { name: 'Draft constitution' }).click()
  await expect(page).toHaveURL(/\/governance\/constitution$/)
})

test('a member sees their real status in Settings, and no tick on their profile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'citizen')
  await page.goto('/settings')
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Identity and governance' }) })
  // They confirmed their age on /join: a stated age, not a verified one.
  await expect(section).toContainText('18 or older')
  await expect(section).toContainText('It is not a verified age.')
  await expect(section).toContainText('Not verified')
  await expect(section).toContainText('HeyNaija is not collecting NIN details.')
  await expect(section).toContainText('Not shown')
  await expect(section).toContainText('Voting membership registration has not opened.')

  await page.goto(`/u/${handle}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /NIN identity verified/ })).toHaveCount(0)
  await context.close()
})

test('a member downloads their data as JSON', async ({ browser }) => {
  const { page, handle, email, context } = await newMember(browser, 'exporter')
  const text = `Mine to keep, by ${handle}`
  await post(page, text)

  await page.goto('/settings')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download your data' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(new RegExp(`^heynaija-${handle}-\\d{4}-\\d{2}-\\d{2}\\.json$`))
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(data.format).toBe('heynaija-export/7')
  expect(data.account).toMatchObject({ handle, email })
  // They skipped the welcome flow on joining (newMember does), and the export says when.
  expect(Date.parse(data.account.onboardedAt)).not.toBeNaN()
  // They confirmed their age on /join, and that is all that is held about it.
  expect(data.age).toHaveLength(1)
  expect(data.age[0]).toMatchObject({ method: 'self_declared', band: '18_plus', withdrawnAt: null })
  expect(data.identityVerifications).toEqual([])
  expect(data.votingMembership).toBeNull()
  expect(data.posts).toContainEqual(expect.objectContaining({ text, quoteOf: null, mentions: [] }))
  expect(data.reposts).toEqual([])
  // Every kind of notification is on until they turn one off.
  expect(data.notificationPreferences).toEqual({ reply: true, like: true, repost: true, quote: true, mention: true, follow: true })
  // New members are emailed their notifications until they turn it off.
  expect(data.emailNotifications).toBe(true)
  await context.close()
})
