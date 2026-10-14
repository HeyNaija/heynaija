import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

test('a followed member’s post shows in Following, saying why', async ({ browser }) => {
  const author = await newMember(browser, 'author')
  const reader = await newMember(browser, 'reader')

  await reader.page.goto(`/u/${author.handle}`)
  await reader.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(reader.page.getByRole('main').getByRole('button', { name: 'Following' })).toBeVisible()

  const text = `News from ${author.handle}`
  await post(author.page, text)

  await reader.page.goto('/?feed=following')
  const article = reader.page.locator('article', { hasText: text })
  await expect(article).toBeVisible()
  await expect(article).toContainText(`You follow @${author.handle}`)

  await author.context.close()
  await reader.context.close()
})

test('muting hides a member’s posts from Latest', async ({ browser }) => {
  const noisy = await newMember(browser, 'noisy')
  const reader = await newMember(browser, 'muter')
  const text = `Loud take from ${noisy.handle}`
  await post(noisy.page, text)

  await reader.page.goto('/')
  const article = reader.page.locator('article', { hasText: text })
  await article.getByLabel('Post options').click()
  await article.getByRole('button', { name: `Mute @${noisy.handle}` }).click()
  await expect(reader.page.locator('article', { hasText: text })).toHaveCount(0)
  await reader.page.reload()
  await expect(reader.page.locator('article', { hasText: text })).toHaveCount(0)

  await noisy.context.close()
  await reader.context.close()
})

test('blocking hides posts both ways', async ({ browser }) => {
  const rude = await newMember(browser, 'rude')
  const victim = await newMember(browser, 'blocker')
  const rudeText = `Rude post from ${rude.handle}`
  const victimText = `Calm post from ${victim.handle}`
  await post(rude.page, rudeText)
  await post(victim.page, victimText)

  await victim.page.goto('/')
  victim.page.once('dialog', (dialog) => dialog.accept())
  const article = victim.page.locator('article', { hasText: rudeText })
  await article.getByLabel('Post options').click()
  await article.getByRole('button', { name: `Block @${rude.handle}` }).click()
  await expect(victim.page.locator('article', { hasText: rudeText })).toHaveCount(0)

  // The blocked member no longer sees the blocker's posts either.
  await rude.page.goto('/')
  await expect(rude.page.locator('article', { hasText: victimText })).toHaveCount(0)

  await rude.context.close()
  await victim.context.close()
})
