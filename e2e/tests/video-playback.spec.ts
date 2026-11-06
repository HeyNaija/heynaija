import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { seedVideoPost } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// A minute of VP8, 320x180, which every test browser can play, and a 1x1 still. It has a
// (silent) sound track: browsers pause a video with none themselves when it cannot be seen.
const clip = readFileSync(new URL('../fixtures/minute.webm', import.meta.url))
const still = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/** The dev stack stores no video files, so the test serves them. */
async function serve(page: Page, mediaId: string) {
  await page.route(`**/media/videos/${mediaId}/**`, (route) =>
    route.request().url().endsWith('/poster.webp')
      ? route.fulfill({ contentType: 'image/png', body: still })
      : route.fulfill({ contentType: 'video/webm', body: clip }),
  )
}

/**
 * Every video that is playing, hidden ones too, by whether it can be seen. Next keeps a
 * page the member has left mounted but hidden, so Back is instant, and a hidden video
 * would play on.
 */
const playing = (page: Page) =>
  page.locator('video').evaluateAll((all: HTMLVideoElement[]) => all.filter((v) => !v.paused).map((v) => (v.checkVisibility() ? 'shown' : 'hidden')))

test('only one video plays at a time, and leaving its page stops it', async ({ browser }) => {
  const { page, handle } = await newMember(browser, 'watcher')
  const first = await seedVideoPost(handle, 'First video')
  const second = await seedVideoPost(handle, 'Second video')
  await serve(page, first.mediaId)
  await serve(page, second.mediaId)
  await page.goto(`/u/${handle}`)
  // The page left behind is still there, hidden, with the same posts.
  const post = (text: string) => page.locator('article').filter({ hasText: text, visible: true })

  await post('First video').getByRole('button', { name: /^Play video/ }).click()
  await expect.poll(() => playing(page)).toEqual(['shown'])
  // Starting another puts the first one's poster back.
  await post('Second video').getByRole('button', { name: /^Play video/ }).click()
  await expect(post('First video').getByRole('button', { name: /^Play video/ })).toBeVisible()
  await expect.poll(() => playing(page)).toEqual(['shown'])

  // Onto the post's own page: the profile, hidden behind it, falls silent.
  await post('Second video').getByText('Second video').click()
  await expect(page).toHaveURL(new RegExp(`/p/${second.postId}`))
  await expect.poll(() => playing(page)).toEqual([])
  await page.getByRole('button', { name: /^Play video/ }).click()
  await expect.poll(() => playing(page)).toEqual(['shown'])

  // And back: the post's page, now hidden, stops too.
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/u/${handle}$`))
  await expect(post('Second video')).toBeVisible()
  await expect.poll(() => playing(page)).toEqual([])
})
