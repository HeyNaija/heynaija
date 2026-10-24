import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

test('a hashtag three members use trends, and the topics page says why', async ({ browser }) => {
  // The ranking may be up to a minute old, so this waits for the next one.
  test.setTimeout(180_000)
  const tag = `Owambe${Date.now().toString(36)}`
  const members = [await newMember(browser, 'topic1'), await newMember(browser, 'topic2'), await newMember(browser, 'topic3')]
  for (const [i, member] of members.entries()) await post(member.page, `Saturday plans ${i}: #${tag}`)

  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await visitor.newPage()
  const topic = page.getByRole('region', { name: 'This week' }).getByRole('link', { name: new RegExp(`^\\d+ #${tag} `) })
  await expect(async () => {
    await page.goto('/topics')
    await expect(topic).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 90_000, intervals: [3_000] })
  await expect(topic).toContainText('3 members · 3 posts this week')

  // The rules are on the same page, with the numbers the ranking used.
  const rules = page.getByRole('region', { name: 'How topics are chosen' })
  await expect(rules).toContainText('at least 3 different members')
  await expect(rules).toContainText('in the last 7 days')

  // A topic opens its hashtag page.
  await topic.click()
  await page.waitForURL((url) => url.pathname === `/hashtag/${tag}`)
  await expect(page.locator('article')).toHaveCount(3)

  // Search offers the topics before anything is typed.
  await page.goto('/search')
  await expect(page.getByRole('region', { name: 'Trending topics' }).getByRole('link', { name: new RegExp(`#${tag} `) })).toBeVisible()

  await visitor.close()
  for (const member of members) await member.context.close()
})
