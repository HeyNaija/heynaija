import { expect, type Page, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { newMember } from '../lib/members.ts'

/** Sends an idea or problem from the form; lands on its post, with the board's panel above it. */
async function send(page: Page, title: string, details = '') {
  await page.getByLabel(/in a line/).fill(title)
  if (details) await page.getByLabel(/optional/).fill(details)
  await page.getByRole('button', { name: /^Send (idea|problem report)$/ }).click()
  await expect(page).toHaveURL(/\/p\//)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

test('members suggest ideas, see similar ones first, vote, and hear when a moderator plans one', async ({ browser }) => {
  const first = await newMember(browser, 'ideator')
  const second = await newMember(browser, 'seconder')
  const moderator = await newMember(browser, 'boardmod')
  grantModerator(moderator.handle, 'building-heynaija')

  const title = `Dark mode for the composer ${first.handle}`
  await first.page.goto('/ideas')
  await first.page.getByRole('link', { name: 'Suggest an idea' }).click()
  await send(first.page, title, 'It is bright at night.')
  const panel = first.page.getByRole('region', { name: title })
  await expect(panel).toContainText('Idea')
  await expect(panel).toContainText('Under review')
  await expect(panel).toContainText('Suggested')
  await expect(panel.getByRole('button', { name: 'Take back your vote (1 vote)' })).toBeVisible()

  // Typing a title like it shows the idea already on the board.
  await second.page.goto('/ideas/new')
  await second.page.getByLabel(/in a line/).fill(`Dark mode ${first.handle}`)
  const similar = second.page.getByRole('region', { name: 'Already on the board' })
  await expect(similar.getByRole('link', { name: title })).toBeVisible()
  await second.page.screenshot({ path: test.info().outputPath('similar.png') })

  // So they vote for it on the board instead.
  await second.page.goto('/ideas?sort=new')
  const row = second.page.locator('.idea-row', { hasText: title })
  await row.getByRole('button', { name: 'Vote for this (1 vote)' }).click()
  await expect(row.getByRole('button', { name: 'Take back your vote (2 votes)' })).toBeVisible()
  await second.page.reload()
  await expect(second.page.locator('.idea-row', { hasText: title }).getByRole('button', { name: 'Take back your vote (2 votes)' })).toBeVisible()
  await second.page.screenshot({ path: test.info().outputPath('board.png') })

  // Members cannot set a status; the board's moderator can, and says why.
  await row.getByRole('link', { name: title }).click()
  await expect(second.page.getByRole('heading', { name: 'Set the status' })).toHaveCount(0)
  await moderator.page.goto(first.page.url())
  await moderator.page.getByLabel('Status').selectOption({ label: 'Planned' })
  await moderator.page.getByLabel(/A note for everyone/).fill('Coming after the pilot’s first month.')
  await moderator.page.getByRole('button', { name: 'Save and tell them' }).click()
  const planned = moderator.page.getByRole('region', { name: title })
  await expect(planned).toContainText('Planned')
  await expect(planned).toContainText('Coming after the pilot’s first month.')
  await moderator.page.screenshot({ path: test.info().outputPath('planned.png') })

  // The author and the voter are told, each in their own words.
  await first.page.goto('/notifications')
  await expect(first.page.getByText('Your idea is now planned.')).toBeVisible()
  await second.page.goto('/notifications')
  await expect(second.page.getByText('An idea you voted for is now planned.')).toBeVisible()

  // Planned is still open: it stays on the board's open list.
  await first.page.goto('/ideas?sort=new')
  await expect(first.page.locator('.idea-row', { hasText: title })).toContainText('Planned')

  for (const member of [first, second, moderator]) await member.context.close()
})

test('a problem report keeps the page it came from and the browser private to its reporter @mobile', async ({ browser }) => {
  const reporter = await newMember(browser, 'reporter')
  const reader = await newMember(browser, 'reader')

  await reporter.page.goto('/c/lagos')
  await reporter.page.getByLabel('Account menu').click()
  await reporter.page.locator('.account-menu-panel').getByRole('link', { name: 'Report a problem' }).click()
  await expect(reporter.page).toHaveURL(/kind=problem/)
  await expect(reporter.page.getByRole('radio', { name: 'A problem with HeyNaija' })).toBeChecked()
  await expect(reporter.page.getByText('The page you came from: /c/lagos')).toBeVisible()
  const title = `Images do not load on 3G ${reporter.handle}`
  await send(reporter.page, title, 'Tried twice on MTN.')

  const panel = reporter.page.getByRole('region', { name: title })
  await expect(panel).toContainText('Problem')
  await expect(panel).toContainText('Reported')
  await expect(panel).toContainText('Only the reporter and Building HeyNaija’s moderators see this')
  await expect(panel).toContainText('/c/lagos')
  await reporter.page.screenshot({ path: test.info().outputPath('problem.png') })

  // Anyone else reads the report, not where it came from.
  await reader.page.goto(reporter.page.url())
  await expect(reader.page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(reader.page.getByText('/c/lagos')).toHaveCount(0)
  const overflow = await reporter.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)

  await reporter.context.close()
  await reader.context.close()
})

test('a visitor reads the board and is asked to sign in to vote or send', async ({ page }) => {
  await page.goto('/ideas')
  await expect(page.getByRole('heading', { level: 1, name: 'Ideas and problems' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Board' }).getByRole('link', { name: 'Open' })).toHaveAttribute('aria-current', 'page')
  const vote = page.locator('.idea-row').first().getByRole('link', { name: /^Sign in to vote/ })
  if (await page.locator('.idea-row').count()) await expect(vote).toBeVisible()
  await page.goto('/ideas/new')
  await expect(page.getByText(/to suggest an idea or report a problem/)).toBeVisible()
})
