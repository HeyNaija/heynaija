import { expect, type Page, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

// Stories (docs/adr/0024): one author's updates to a post, in order, shown once in feeds.

/** The id of a post's card on the page. */
const idOf = async (page: Page, text: string) =>
  (await page.locator('article', { hasText: text }).first().getAttribute('id'))!.replace('post-', '')

/**
 * Writes an update in the box at the end of a story and waits for it to show
 * above the box. `?add=update` brings the box to a post that is not a story yet,
 * as its menu does.
 */
async function addUpdate(page: Page, storyId: string, text: string) {
  await page.goto(`/p/${storyId}?add=update#add-update`)
  await writeUpdate(page, text)
}

/** Posts `text` from the story's own box, already on the page. */
async function writeUpdate(page: Page, text: string) {
  const form = page.locator('#add-update')
  await form.getByRole('textbox', { name: 'Your update' }).fill(text)
  await form.getByRole('button', { name: 'Post', exact: true }).click()
  await expect(page.locator('.story-spine article', { hasText: text })).toBeVisible()
}

test('a post becomes a story with its first update, and Latest shows the story once, at its newest @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'storyteller')
  try {
    const start = `Building a darkroom, by ${handle}`
    const article = await post(page, start)
    const storyId = await idOf(page, start)

    // Add update is in the post's menu. It opens the post with a box under it, the
    // cursor in it, and says what is about to happen.
    await article.getByLabel('Post options').click()
    await article.getByRole('link', { name: 'Add update' }).click()
    await page.waitForURL((url) => url.pathname === `/p/${storyId}` && url.searchParams.get('add') === 'update')
    const box = page.locator('#add-update').getByRole('textbox', { name: 'Your update' })
    await expect(box).toBeFocused()
    await expect(box).toHaveAttribute('placeholder', 'Add update 1…')
    await expect(page.locator('.story-bar')).toContainText('New story')
    await writeUpdate(page, `Curtains up, from ${handle}`)
    await expect(page.locator('.story-bar')).toContainText('Story · 1 update')
    await expect(page.locator('.story-spine article', { hasText: `Curtains up, from ${handle}` })).toContainText('Update 1')

    // The next one is written in the same box, which stays at the end of the story.
    await expect(box).toHaveAttribute('placeholder', 'Add update 2…')
    await writeUpdate(page, `First print, from ${handle}`)
    await expect(page.locator('.story-bar')).toContainText('Story · 2 updates')
    await expect(page.locator('.story-spine > li').last()).toHaveClass(/story-add/)
    // Running on past an update, the line starts no lower than where the curve into it
    // turns away, so the curve branches off one line rather than a second one starting.
    const breaks = await page.locator('.story-spine > li:not(:last-child)').evaluateAll((items) =>
      items.filter((li) => {
        const curve = getComputedStyle(li, '::before')
        const turns = parseFloat(curve.top) + parseFloat(curve.height) - parseFloat(curve.borderBottomLeftRadius)
        return parseFloat(getComputedStyle(li, '::after').top) > turns
      }).length,
    )
    expect(breaks).toBe(0)
    // The author follows nothing of their own, and the line ends at the box.
    await expect(page.getByRole('button', { name: /Follow story/ })).toHaveCount(0)
    const lastOnward = await page.locator('.story-spine > li').last().evaluate((li) => getComputedStyle(li, '::after').content)
    expect(lastOnward).toBe('none')

    // In Latest the story is one card: the newest update, with the first post above it on one line.
    await page.goto('/?feed=latest')
    const entry = page.locator('.story-entry', { hasText: `First print, from ${handle}` })
    await expect(entry).toBeVisible()
    await expect(entry.locator('.story-start')).toContainText(start)
    await expect(entry.locator('.story-start')).toContainText('Story · 2 updates')
    await expect(page.locator('article', { hasText: `Curtains up, from ${handle}` })).toHaveCount(0)
    await expect(page.locator('article', { hasText: start })).toHaveCount(0)

    // An update's own page says where it belongs.
    const updateId = (await entry.locator('article').getAttribute('id'))!.replace('post-', '')
    await page.goto(`/p/${updateId}`)
    await expect(page.locator('.story-context')).toContainText('Update 2 of 2')
  } finally {
    await context.close()
  }
})

test('a member follows a story and is told about its next update', async ({ browser }) => {
  const author = await newMember(browser, 'story_author')
  const reader = await newMember(browser, 'story_reader')
  try {
    const start = `A trip to Obudu, by ${author.handle}`
    await post(author.page, start)
    const storyId = await idOf(author.page, start)
    await addUpdate(author.page, storyId, `Day one, from ${author.handle}`)

    await reader.page.goto(`/p/${storyId}`)
    // Only its author has a box to add to it; for everyone else the line ends at the last update.
    await expect(reader.page.locator('#add-update')).toHaveCount(0)
    const lastOnward = await reader.page.locator('.story-spine > li').last().evaluate((li) => getComputedStyle(li, '::after').content)
    expect(lastOnward).toBe('none')
    await reader.page.getByRole('button', { name: 'Follow story' }).click()
    await expect(reader.page.getByRole('button', { name: 'Following' })).toBeVisible()
    await expect(reader.page.locator('.story-bar')).toContainText('1 following')

    await addUpdate(author.page, storyId, `Day two, from ${author.handle}`)
    await reader.page.goto('/notifications')
    const row = reader.page.locator('.notification-row', { hasText: 'added to their story' })
    await expect(row).toContainText(`Day two, from ${author.handle}`)
    await expect(row).toContainText('View update')

    // Unfollowing takes it back.
    await reader.page.goto(`/p/${storyId}`)
    await reader.page.getByRole('button', { name: 'Following' }).click()
    await expect(reader.page.getByRole('button', { name: 'Follow story' })).toBeVisible()
    await reader.page.goto('/notifications')
    await expect(reader.page.locator('.notification-row', { hasText: 'added to their story' })).toHaveCount(0)
  } finally {
    await author.context.close()
    await reader.context.close()
  }
})
