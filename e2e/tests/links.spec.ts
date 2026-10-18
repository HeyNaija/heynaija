import { expect, test } from '@playwright/test'
import { seedLinkPreview } from '../lib/db.ts'
import { expectNoHorizontalScroll } from '../lib/layout.ts'
import { newMember, post } from '../lib/members.ts'

test('a web address in a post is a link, and the rest of the post still opens it @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'linker')
  const address = 'https://links.e2e.test/story?a=1'
  const text = `Worth a read (${address}), says ${handle}.`
  const article = await post(page, text, undefined, `says ${handle}`)

  // The brackets and the comma are the sentence's, not the address's.
  const link = article.locator('a.post-link')
  await expect(link).toHaveAttribute('href', address)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /nofollow/)
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link.locator('[aria-hidden="true"]')).toHaveText('links.e2e.test/story?a=1')
  await expect(article).toContainText('Worth a read (')
  await expect(article).toContainText(`), says ${handle}.`)

  // The text beside the address opens the post, as in any other post.
  await article.getByText('Worth a read').click()
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}/)
  await expect(page.locator('article').first().locator('a.post-link')).toBeVisible()
  await context.close()
})

test('a long address is shortened on screen and read out in full @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'longlink')
  const address = `https://www.links.e2e.test/${'a-very-long-section/'.repeat(5)}end`
  const article = await post(page, `see ${address} from ${handle}`, undefined, `from ${handle}`)
  const link = article.locator('a.post-link')
  await expect(link.locator('[aria-hidden="true"]')).toHaveText(/^links\.e2e\.test\/a-very-long-sect…$/)
  await expect(link.locator('.sr-only')).toHaveText(address)
  await expect(link).toHaveAttribute('href', address)
  await expectNoHorizontalScroll(article)
  await context.close()
})

test('a post whose page has been read shows a card for it, which opens the page in a new tab @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'carder')
  const address = `https://links.e2e.test/card-${Date.now()}/story`
  await seedLinkPreview(address, { title: 'Lagos clears its drains', description: 'Residents say the rains will tell. '.repeat(8) })

  const article = await post(page, `Good news ${address} from ${handle}`, undefined, `Good news`)
  const card = article.getByRole('link', { name: /Lagos clears its drains/ })
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('href', address)
  await expect(card).toHaveAttribute('target', '_blank')
  await expect(card).toContainText('links.e2e.test') // the real host, in the card itself
  await expect(card).toContainText('opens in a new tab')
  await expect(card.locator('.link-card-text')).toBeVisible()
  await expectNoHorizontalScroll(card)
  // A long description is cut, not allowed to stretch the card.
  expect((await card.boundingBox())!.height).toBeLessThan(200)

  // The card is on the post's own page too, and the post is not duplicated into the page's link.
  await article.getByText('Good news').click()
  await expect(page).toHaveURL(/\/p\//)
  await expect(page.getByRole('link', { name: /Lagos clears its drains/ })).toBeVisible()
  await context.close()
})

test('an address nobody has read yet shows no card, only the link', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'nocard')
  // The API refuses to read pages from this machine, so this one stays unread.
  const article = await post(page, `no preview for https://links.e2e.test/unread-${Date.now()} from ${handle}`, undefined, `no preview for`)
  await expect(article.locator('a.post-link')).toBeVisible()
  await expect(article.locator('.link-card')).toHaveCount(0)
  await context.close()
})
