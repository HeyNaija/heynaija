import { expect, type Locator, type Page, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'
import { png } from '../lib/png.ts'

// Posts marked sensitive (ADR 0020), the way X does it: a small switch under the
// attached pictures, an adult sees them blurred behind "Sensitive content" until
// Show, nothing says 18+, and someone who is not signed in never sees the post.
// Its pictures leave the public bucket and are reached only by signed URLs that
// the API gives those who may see it (ADR 0025).

const PRIVATE = /^\/api\/v1\/media\/private\/\d+\/[\w-]{43}\/posts\/([0-9a-f-]{36})\/640\.webp$/

/**
 * The `src` of a post's picture once the files have moved for its mark: the move is
 * a queued job, so the page is loaded again until the picture comes from `expected`.
 */
async function pictureFrom(page: Page, picture: Locator, expected: RegExp): Promise<string> {
  await expect(async () => {
    await page.reload()
    expect(await picture.getAttribute('src')).toMatch(expected)
  }).toPass({ timeout: 30_000 })
  return (await picture.getAttribute('src'))!
}

/** True once the browser has drawn the picture: it really loaded from wherever its `src` leads. */
const drawn = (picture: Locator) => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)

test('a post marked sensitive: covered for an adult until Show, never shown signed out @mobile', async ({ browser }) => {
  const author = await newMember(browser, 'marker')
  const reader = await newMember(browser, 'reader')
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  try {
    const { page } = author
    await page.goto('/')
    const box = page.getByRole('textbox', { name: 'New post' })
    await box.click()
    const text = `Accident on the bridge, from ${author.handle}`
    await box.fill(text)
    // Offered only once there is something to cover.
    await expect(page.getByRole('button', { name: 'Mark as sensitive' })).toHaveCount(0)
    await page.locator('#compose input[type="file"]:not([accept*="video"])').setInputFiles({ name: 'scene.png', mimeType: 'image/png', buffer: png() })
    const alt = 'The scene on the bridge'
    await page.getByLabel('Description of image 1').fill(alt)
    const mark = page.getByRole('button', { name: 'Mark as sensitive' })
    await mark.click()
    await expect(page.getByRole('button', { name: 'Marked sensitive' })).toHaveAttribute('aria-pressed', 'true')
    const submit = page.getByRole('button', { name: 'Post', exact: true })
    await expect(submit).toBeEnabled({ timeout: 45_000 })
    await submit.click()

    // The author sees their own pictures as they are.
    const own = page.locator('article', { hasText: text }).first()
    await expect(own.getByRole('img', { name: alt })).toBeVisible({ timeout: 30_000 })
    await expect(own.getByText('Sensitive content')).toHaveCount(0)
    const id = (await own.getAttribute('id'))!.replace('post-', '')

    // Its picture has left the public bucket: on the post's page it comes from a
    // signed address, and loads from there.
    await page.goto(`/p/${id}`)
    const ownPicture = page.locator(`#post-${id}`).getByRole('img', { name: alt })
    const signed = await pictureFrom(page, ownPicture, PRIVATE)
    await expect.poll(() => drawn(ownPicture)).toBe(true)
    const mediaId = PRIVATE.exec(signed)![1]!
    // The address it used to have finds nothing now.
    expect((await page.request.get(`/media/posts/${mediaId}/640.webp`)).ok()).toBe(false)
    // The signed address sends the browser on to storage, and nothing may keep that but the browser.
    const hop = await page.request.get(signed, { maxRedirects: 0 })
    expect(hop.status()).toBe(302)
    expect(hop.headers()['cache-control']).toMatch(/^private, max-age=\d+$/)
    // A forged signature is refused, and that answer is kept by nobody.
    const forged = await page.request.get(signed.replace(/\/[\w-]{43}\//, `/${'A'.repeat(43)}/`), { maxRedirects: 0 })
    expect(forged.status()).toBe(404)
    expect(forged.headers()['cache-control']).toBe('private, no-store')

    // Another adult reads the words, with the picture covered until they ask, and no "18+".
    await reader.page.goto(`/p/${id}`)
    const post = reader.page.locator(`#post-${id}`)
    await expect(post.getByText(text)).toBeVisible()
    // The picture is under the cover, out of reach: blurred and inert until Show.
    const cover = post.locator('.media-cover')
    await expect(cover.getByText('Sensitive content')).toBeVisible()
    await expect(cover.locator('.media-cover-content')).toHaveAttribute('inert', '')
    await expect(post.getByText('18+')).toHaveCount(0)
    await post.getByRole('button', { name: 'Show' }).click()
    await expect(cover).toHaveCount(0)
    await expect(post.getByRole('img', { name: alt })).toBeVisible()
    // Signed for them too, and it loads.
    expect(await post.getByRole('img', { name: alt }).getAttribute('src')).toMatch(PRIVATE)
    await expect.poll(() => drawn(post.getByRole('img', { name: alt }))).toBe(true)

    // Settings can show such pictures straight away.
    await reader.page.goto('/settings')
    const settings = reader.page.getByRole('region', { name: 'Sensitive content' })
    await settings.getByLabel('Show sensitive pictures and video without a warning').check()
    await settings.getByRole('button', { name: 'Save' }).click()
    await expect(settings.getByText('Saved.')).toBeVisible()
    await reader.page.goto(`/p/${id}`)
    await expect(post.getByRole('img', { name: alt })).toBeVisible()
    await expect(cover).toHaveCount(0)

    // Signed out, it is not there at all: not on its page, not in the feed.
    const page2 = await visitor.newPage()
    await page2.goto(`/p/${id}`)
    await expect(page2.getByText(text)).toHaveCount(0)
    await page2.goto('/')
    await expect(page2.getByText(text)).toHaveCount(0)

    // The author can take their own mark off from the post's menu.
    await page.goto(`/p/${id}`)
    const mine = page.locator(`#post-${id}`)
    await mine.getByLabel('Post options').click()
    await mine.getByRole('button', { name: 'Remove sensitive mark' }).click()
    await mine.getByLabel('Post options').click()
    await expect(mine.getByRole('button', { name: 'Mark as sensitive' })).toBeVisible()
    await page2.goto(`/p/${id}`)
    await expect(page2.getByText(text)).toBeVisible()
    // Its picture is back on the public path, for everyone, and loads there.
    const publicPicture = page2.locator(`#post-${id}`).getByRole('img', { name: alt })
    await pictureFrom(page2, publicPicture, new RegExp(`^/media/posts/${mediaId}/640\\.webp$`))
    await expect.poll(() => drawn(publicPicture)).toBe(true)
  } finally {
    await visitor.close()
    await author.context.close()
    await reader.context.close()
  }
})
