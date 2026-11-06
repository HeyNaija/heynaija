import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { seedVideoPost } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// A minute of video, 320x180, as the worker leaves it: HLS, made from minute.webm with the
// worker's settings (ADR 0021 section 3), which the test's Chromium plays itself. And a 1x1
// still. It has a (silent) sound track: browsers pause a video with none themselves when it
// cannot be seen.
const hls = new URL('../fixtures/minute-hls/', import.meta.url)
const still = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4' }

/** The dev stack stores no video files, so the test serves them: the poster, and the playlists and pieces under `hls/`. */
async function serve(page: Page, mediaId: string) {
  await page.route(`**/media/videos/${mediaId}/**`, (route) => {
    const path = new URL(route.request().url()).pathname.split(`/videos/${mediaId}/`)[1] ?? ''
    if (path === 'poster.webp') return route.fulfill({ contentType: 'image/png', body: still })
    if (!path.startsWith('hls/')) return route.fulfill({ status: 404 })
    return route.fulfill({ contentType: TYPES[extname(path)] ?? 'application/octet-stream', body: readFileSync(new URL(path.slice('hls/'.length), hls)) })
  })
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
