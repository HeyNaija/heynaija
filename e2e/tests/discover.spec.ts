import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

test('Home opens on Discover, which ranks recent posts by its published rules and says why each is there', async ({ browser }) => {
  const reader = await newMember(browser, 'discoverer')
  const friend = await newMember(browser, 'friend')
  const stranger = await newMember(browser, 'stranger')
  const quiet = await newMember(browser, 'quiet')

  await reader.page.goto(`/u/${friend.handle}`)
  await reader.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(reader.page.getByRole('main').getByRole('button', { name: 'Following' })).toBeVisible()

  // A stranger's post that the reader's friend reposts: 1 to start, 1 for the repost, 3 for who did it.
  const shared = `Shared in Discover by ${friend.handle}`
  await post(stranger.page, shared)
  await friend.page.goto('/?feed=latest')
  const card = friend.page.locator('article', { hasText: shared })
  await card.getByLabel('Repost or quote (0 reposts)').click()
  await card.getByRole('button', { name: 'Repost', exact: true }).click()
  await expect(card.getByLabel('Reposted. Undo or quote (1 repost)')).toBeVisible()
  // The friend's own post: 1 to start, 2 for following its author.
  const own = `From the friend ${friend.handle}`
  await post(friend.page, own)
  // Nobody the reader knows, and nobody took part: only its starting point.
  const unnoticed = `Unnoticed post by ${quiet.handle}`
  await post(quiet.page, unnoticed)

  await reader.page.goto('/')
  const feeds = reader.page.getByRole('navigation', { name: 'Feeds' })
  await expect(feeds.getByRole('link')).toHaveText(['Discover', 'Latest', 'Following', 'Ranked by published rules'])
  await expect(feeds.getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')
  const discover = reader.page.getByRole('region', { name: 'Discover: recent posts ranked by published rules' })
  const sharedCard = discover.locator('article', { hasText: shared })
  await expect(sharedCard).toContainText(`@${friend.handle} reposted`)
  await expect(discover.locator('article', { hasText: own })).toContainText(`You follow @${friend.handle}`)
  await expect(discover.locator('article', { hasText: unnoticed })).toContainText('New on HeyNaija')
  // 5 points, then 3, then 1, posted at about the same time.
  const order = await discover.locator('article').allInnerTexts()
  const at = (text: string) => order.findIndex((t) => t.includes(text))
  expect(at(shared)).toBeLessThan(at(own))
  expect(at(own)).toBeLessThan(at(unnoticed))

  // The page keeps the moment it was ranked as of, so loading it again does not reorder it.
  await expect(reader.page).toHaveURL(/[?&]feed=discover&at=/)
  await reader.page.screenshot({ path: test.info().outputPath('discover.png') })

  // The reader's own post shows at the top as soon as it is written.
  const mine = `My first word in Discover, ${reader.handle}`
  await post(reader.page, mine)
  const first = reader.page.getByRole('region', { name: 'Discover: recent posts ranked by published rules' }).locator('article').first()
  await expect(first).toContainText(mine)
  await expect(first).toContainText('Your post')

  // Choosing Latest is remembered: Home opens on it next time, and Discover is a click away.
  await feeds.getByRole('link', { name: 'Latest' }).click()
  await expect(reader.page.locator('article', { hasText: unnoticed })).toBeVisible()
  await reader.page.goto('/')
  await expect(feeds.getByRole('link', { name: 'Latest' })).toHaveAttribute('aria-current', 'page')
  await expect(feeds).toContainText('Newest first, not ranked')
  await feeds.getByRole('link', { name: 'Discover' }).click()
  await expect(reader.page).toHaveURL(/[?&]feed=discover/)
  await reader.page.goto('/')
  await expect(feeds.getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')

  // The label beside the tabs leads to the rules, with the numbers the API uses.
  await feeds.getByRole('link', { name: 'Ranked by published rules' }).click()
  await expect(reader.page.getByRole('heading', { level: 1, name: 'How Discover works' })).toBeVisible()
  await expect(reader.page.getByRole('main')).toContainText('Every post starts with 1 point')
  await expect(reader.page.getByRole('main')).toContainText('A post gets 2 points for each person, other than its author')
  await expect(reader.page.getByRole('main')).toContainText('Discover ends after 100 posts.')

  for (const member of [reader, friend, stranger, quiet]) await member.context.close()
})

test('the feed tabs fit a 320px screen with Discover chosen @mobile', async ({ browser }) => {
  const reader = await newMember(browser, 'narrow', { viewport: { width: 320, height: 640 } })
  await reader.page.goto('/')
  const feeds = reader.page.getByRole('navigation', { name: 'Feeds' })
  await expect(feeds.getByRole('link', { name: 'Ranked by published rules' })).toBeVisible()
  const overflow = await feeds.evaluate((nav) => nav.scrollWidth - nav.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  // Each tab's name stays on one line; the label beside them folds instead.
  for (const name of ['Discover', 'Latest', 'Following']) {
    expect((await feeds.getByRole('link', { name, exact: true }).boundingBox())!.height).toBeLessThanOrEqual(48)
  }
  const page = await reader.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(page).toBeLessThanOrEqual(0)
  await reader.page.screenshot({ path: test.info().outputPath('discover-320.png') })
  await reader.context.close()
})

test('a signed-out visitor opens on Discover too, can switch to Latest, and can read how Discover works', async ({ browser }) => {
  const author = await newMember(browser, 'shown')
  const text = `For visitors, from ${author.handle}`
  await post(author.page, text)

  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await visitor.newPage()
  await page.goto('/')
  const feeds = page.getByRole('navigation', { name: 'Feeds' })
  await expect(feeds.getByRole('link')).toHaveText(['Discover', 'Latest', 'Ranked by published rules'])
  await expect(page.getByRole('region', { name: 'Discover: recent posts ranked by published rules' })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('discover-visitor.png') })

  await feeds.getByRole('link', { name: 'Latest' }).click()
  await expect(page.getByRole('region', { name: 'Latest posts' }).locator('article', { hasText: text })).toBeVisible()
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Latest posts' })).toBeVisible()

  await page.goto('/about/discover')
  await expect(page.getByRole('heading', { level: 1, name: 'How Discover works' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText('If you are not signed in, only the points that are the same for everyone count')
  await visitor.close()
  await author.context.close()
})
