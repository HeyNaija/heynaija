import { expect, test } from '@playwright/test'
import { newMember, post, replyBox } from '../lib/members.ts'

test('a hashtag opens a page of every post and reply with it, however it is spelled', async ({ browser }) => {
  const author = await newMember(browser, 'tagger')
  const replier = await newMember(browser, 'tagreply')

  // A tag of this run's own, so earlier runs' posts are not on its page.
  const tag = `JollofWars${Date.now().toString(36)}`
  const text = `Ghana or Naija? #${tag} is back. Rate: #1`
  const card = await post(author.page, text)
  const link = card.getByRole('link', { name: `#${tag}`, exact: true })
  await expect(link).toHaveAttribute('href', `/hashtag/${tag}`)
  // A number is not a hashtag.
  await expect(card.locator('.post-hashtag')).toHaveCount(1)

  // Someone else answers with it in lower case.
  await card.getByText('Ghana or Naija?').click({ position: { x: 4, y: 4 } })
  await author.page.waitForURL(/\/p\/[0-9a-f-]+$/)
  const reply = `Naija, no contest. #${tag.toLowerCase()}`
  await replier.page.goto(author.page.url())
  await (await replyBox(replier.page)).fill(reply)
  await replier.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(replier.page.locator('article', { hasText: reply })).toBeVisible()

  // The tag in the post opens the page, which has both, newest first.
  await author.page.goto('/')
  await author.page.locator('article', { hasText: text }).first().getByRole('link', { name: `#${tag}`, exact: true }).click()
  await author.page.waitForURL((url) => url.pathname === `/hashtag/${tag}`)
  await expect(author.page.getByRole('heading', { level: 1, name: `#${tag}` })).toBeVisible()
  await expect(author.page).toHaveTitle(new RegExp(`#${tag}`))
  const listed = author.page.getByRole('region', { name: `Posts with #${tag}` }).locator('article')
  await expect(listed).toHaveCount(2)
  await expect(listed.nth(0)).toContainText(reply)
  await expect(listed.nth(1)).toContainText(text)

  // Searching for the hashtag offers its page.
  await replier.page.goto(`/search?q=${encodeURIComponent(`#${tag}`)}`)
  await replier.page.getByRole('region', { name: 'Hashtag' }).getByRole('link', { name: new RegExp(`#${tag}`) }).click()
  await replier.page.waitForURL((url) => url.pathname === `/hashtag/${tag}`)
  await expect(replier.page.getByRole('region', { name: `Posts with #${tag}` }).locator('article')).toHaveCount(2)

  // The page is public, under any spelling, and says when a hashtag has nothing yet.
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await visitor.newPage()
  await page.goto(`/hashtag/${tag.toUpperCase()}`)
  await expect(page.getByRole('heading', { level: 1, name: `#${tag.toUpperCase()}` })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(2)
  await page.goto(`/hashtag/nothing${Date.now().toString(36)}`)
  await expect(page.getByText(/^Nothing about #nothing/)).toBeVisible()
  // What could never be a hashtag is not a page.
  await page.goto('/hashtag/2027')
  await expect(page.getByRole('heading', { level: 1, name: 'Nothing here' })).toBeVisible()

  await visitor.close()
  await author.context.close()
  await replier.context.close()
})
