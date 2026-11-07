import { expect, test, type Locator } from '@playwright/test'
import { makeMinor } from '../lib/db.ts'
import { newMember, post, replyBox } from '../lib/members.ts'

const postId = async (article: Locator) =>
  (await article.getAttribute('id'))!.replace('post-', '')

test('creates a multiple-choice poll with no expiry and exposes each public ballot', async ({ browser }) => {
  const creator = await newMember(browser, 'poller')
  const voter = await newMember(browser, 'voter')
  const question = `What should @${creator.handle} cook?`

  await creator.page.goto('/')
  await creator.page.getByRole('textbox', { name: 'New post' }).fill(question)
  await creator.page.getByRole('button', { name: 'Poll', exact: true }).click()
  await creator.page.getByLabel('Choice 1').fill('Jollof rice')
  await creator.page.getByLabel('Choice 2').fill('jollof rice')
  await creator.page.getByLabel('Voting').selectOption('1')
  await creator.page.getByLabel('Ends').selectOption('never')
  // Refused, as the choices differ only in case; what was picked stays picked for the retry.
  await creator.page.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(creator.page.getByText('Check the poll question and its choices.')).toBeVisible()
  await expect(creator.page.getByLabel('Voting')).toHaveValue('1')
  await expect(creator.page.getByLabel('Ends')).toHaveValue('never')
  await creator.page.getByLabel('Choice 2').fill('Fried rice')
  await creator.page.getByRole('button', { name: 'Add choice' }).click()
  await creator.page.getByRole('textbox', { name: 'Choice 3', exact: true }).fill('Beans')
  await creator.page.getByRole('button', { name: 'Post', exact: true }).click()
  const article = creator.page.locator('article', { hasText: question }).first()
  await expect(article.getByText('No expiry')).toBeVisible()
  const id = await postId(article)

  await voter.page.goto(`/p/${id}`)
  const poll = voter.page.getByRole('region', { name: 'Multiple-choice poll' })
  await poll.getByLabel('Jollof rice').check()
  await poll.getByLabel('Beans').check()
  await poll.getByRole('button', { name: 'Vote', exact: true }).click()
  await expect(poll.getByRole('link', { name: '1 public voter' })).toBeVisible()
  await poll.getByRole('link', { name: '1 public voter' }).click()
  await expect(voter.page.getByRole('heading', { name: 'Public poll votes' })).toBeVisible()
  await expect(voter.page.getByRole('link', { name: `@${voter.handle}`, exact: true })).toBeVisible()
  await expect(voter.page.getByText('Jollof rice, Beans')).toBeVisible()

  await creator.context.close()
  await voter.context.close()
})

test('mentioned-only control admits the mentioned member and blocks the whole nested conversation for others', async ({ browser, page }) => {
  const creator = await newMember(browser, 'boundary')
  const invited = await newMember(browser, 'invited')
  const outsider = await newMember(browser, 'outsider')
  const question = `A question for @${invited.handle}`

  await creator.page.goto('/')
  await creator.page.getByRole('textbox', { name: 'New post' }).fill(question)
  await creator.page.getByLabel('Who can reply').selectOption('mentioned')
  await creator.page.getByRole('button', { name: 'Post', exact: true }).click()
  const article = creator.page.locator('article', { hasText: question }).first()
  await expect(article.locator('.reply-audience-note')).toHaveText('Only people mentioned can reply')
  const id = await postId(article)

  await invited.page.goto(`/p/${id}`)
  const answer = `Answer from ${invited.handle}`
  await (await replyBox(invited.page)).fill(answer)
  await invited.page.getByRole('button', { name: 'Reply', exact: true }).click()
  const reply = invited.page.locator('article', { hasText: answer })
  await expect(reply).toBeVisible()
  const replyId = await postId(reply)

  for (const path of [`/p/${id}`, `/p/${replyId}`]) {
    await outsider.page.goto(path)
    await expect(outsider.page.getByText('The conversation author has limited who can reply.')).toBeVisible()
    await expect(outsider.page.getByRole('textbox', { name: 'Your reply' })).toHaveCount(0)
    await expect(outsider.page.locator('article', { hasText: answer }).getByRole('link', { name: /^Reply \(/ }))
      .toHaveAttribute('aria-disabled', 'true')
  }

  // A visitor is not left out: the reply button still leads to the reply, which asks them to sign in.
  await page.goto(`/p/${id}`)
  await page.locator('article', { hasText: answer }).getByRole('link', { name: /^Reply \(/ }).click()
  await expect(page).toHaveURL(new RegExp(`/p/${replyId}`))
  // The conversation's page stays mounted, hidden, after the client-side navigation.
  // The ask is the reply bar's place under the post now, not a notice at the foot of the page.
  await expect(page.getByRole('link', { name: 'Sign in to reply', exact: true }).filter({ visible: true })).toBeVisible()

  await creator.context.close()
  await invited.context.close()
  await outsider.context.close()
})

test('a member under 18 starts conversations only people they follow can join, and a stranger\u2019s @mention of them stays plain text', async ({ browser }) => {
  const minor = await newMember(browser, 'minor')
  const friend = await newMember(browser, 'friend')
  const stranger = await newMember(browser, 'stranger')
  await makeMinor(minor.handle)

  await minor.page.goto(`/u/${friend.handle}`)
  await minor.page.getByRole('main').getByRole('button', { name: 'Follow', exact: true }).click()
  await expect(minor.page.getByRole('main').getByRole('button', { name: 'Following' })).toBeVisible()

  // The composer offers no "Everyone can reply", and starts on the people they follow.
  await minor.page.goto('/')
  const choice = minor.page.getByLabel('Who can reply')
  await expect(choice).toHaveValue('following')
  await expect(choice.locator('option')).toHaveText(['People you follow', 'Only people mentioned'])
  const text = `A first post from ${minor.handle}`
  const article = await post(minor.page, text)
  await expect(article.locator('.reply-audience-note')).toHaveText('People you follow can reply')
  const id = await postId(article)

  await stranger.page.goto(`/p/${id}`)
  await expect(stranger.page.getByText('The conversation author has limited who can reply.')).toBeVisible()
  await expect(stranger.page.getByRole('textbox', { name: 'Your reply' })).toHaveCount(0)

  await friend.page.goto(`/p/${id}`)
  const answer = `Hello from ${friend.handle}`
  await (await replyBox(friend.page)).fill(answer)
  await friend.page.getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(friend.page.locator('article', { hasText: answer })).toBeVisible()

  // Named by someone they do not follow, they are not linked, and not told.
  const mention = await post(stranger.page, `Hi @${minor.handle} and @${friend.handle}`)
  await expect(mention.getByRole('link', { name: `@${friend.handle}`, exact: true })).toBeVisible()
  await expect(mention.getByRole('link', { name: `@${minor.handle}`, exact: true })).toHaveCount(0)
  await minor.page.goto('/notifications')
  await expect(minor.page.getByText('mentioned you')).toHaveCount(0)

  await minor.context.close()
  await friend.context.close()
  await stranger.context.close()
})
