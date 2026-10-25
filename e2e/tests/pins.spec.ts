import { expect, type Locator, type Page, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { communityPin, setCommunityPin } from '../lib/db.ts'
import { newMember, post } from '../lib/members.ts'

/** Opens a post's menu and chooses `item`. */
async function choose(article: Locator, item: string | RegExp) {
  await article.getByLabel('Post options').click()
  await article.getByRole('button', { name: item }).click()
}

/** The post shown above the list, marked as pinned. */
const pinnedCard = (page: Page) => page.locator('article', { has: page.locator('.post-context', { hasText: /^Pinned/ }) })

test('a member pins a post to the top of their profile, then changes and removes it', async ({ browser }) => {
  const member = await newMember(browser, 'pinner')
  const first = `My introduction, from ${member.handle}`
  const second = `Something newer from ${member.handle}`
  await post(member.page, first)
  await post(member.page, second)

  // Pinned from the home feed, it is above the list on the profile, and still in its place below.
  await choose(member.page.locator('article', { hasText: first }).first(), 'Pin to your profile')
  await member.page.goto(`/u/${member.handle}`)
  await expect(pinnedCard(member.page)).toHaveCount(1)
  await expect(pinnedCard(member.page)).toContainText(first)
  await expect(member.page.locator('article', { hasText: first })).toHaveCount(2)

  // A visitor sees it pinned too.
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await visitor.newPage()
  await page.goto(`/u/${member.handle}`)
  await expect(pinnedCard(page)).toContainText(first)
  // Only on Posts: the replies list has no pin.
  await page.goto(`/u/${member.handle}?tab=replies`)
  await expect(pinnedCard(page)).toHaveCount(0)

  // Pinning another replaces it.
  await choose(member.page.locator('article', { hasText: second }).last(), 'Pin to your profile')
  await expect(pinnedCard(member.page)).toContainText(second)
  await expect(pinnedCard(member.page)).toHaveCount(1)

  // Unpinned, nothing is above the list.
  await choose(pinnedCard(member.page), 'Unpin from your profile')
  await expect(pinnedCard(member.page)).toHaveCount(0)
  await expect(member.page.locator('article', { hasText: second })).toHaveCount(1)

  await visitor.close()
  await member.context.close()
})

test("a community's moderator pins a welcome post above its conversations; members cannot", async ({ browser }) => {
  const before = await communityPin('lagos')
  const moderator = await newMember(browser, 'lagosmod')
  const member = await newMember(browser, 'lagosian')
  grantModerator(moderator.handle, 'lagos')
  try {
    const welcome = `Welcome to Lagos! Read the rules first. ${moderator.handle}`
    await post(moderator.page, welcome, 'Lagos')
    await moderator.page.goto('/c/lagos')
    await choose(moderator.page.locator('article', { hasText: welcome }).first(), 'Pin to the top of Lagos')
    const pinned = moderator.page.getByRole('region', { name: 'Pinned by the moderators' })
    await expect(pinned).toContainText(welcome)
    await expect(pinned.locator('.post-context')).toHaveText('Pinned by the moderators')

    // A member sees it pinned, and their menu offers no pinning.
    await member.page.goto('/c/lagos')
    const seen = member.page.getByRole('region', { name: 'Pinned by the moderators' }).locator('article')
    await expect(seen).toContainText(welcome)
    await seen.getByLabel('Post options').click()
    await expect(seen.getByRole('link', { name: 'Report post' })).toBeVisible()
    await expect(seen.getByRole('button', { name: /Pin to the top|Unpin from/ })).toHaveCount(0)

    // The moderator unpins it.
    await choose(pinned.locator('article'), 'Unpin from Lagos')
    await expect(moderator.page.getByRole('region', { name: 'Pinned by the moderators' })).toHaveCount(0)
  } finally {
    // Put back whatever this machine's Lagos had pinned before.
    await setCommunityPin('lagos', before)
    await moderator.context.close()
    await member.context.close()
  }
})
