import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { seedVideoPost } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// A minute of VP8, 320x180, which every test browser can play, and a 1x1 still. It has a
// (silent) sound track: browsers pause a video with none themselves when it cannot be seen.
const clip = readFileSync(new URL('../fixtures/minute.webm', import.meta.url))
const still = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/**
 * The dev stack stores no video files, so the test serves them. The clip is served in
 * ranges, as R2 serves it: a browser seeks only in a file it can ask for part of.
 */
async function serve(page: Page, mediaId: string) {
  await page.route(`**/media/videos/${mediaId}/**`, (route) => {
    if (route.request().url().endsWith('/poster.webp')) return route.fulfill({ contentType: 'image/png', body: still })
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '')
    if (!range) return route.fulfill({ contentType: 'video/webm', body: clip, headers: { 'accept-ranges': 'bytes' } })
    const start = Number(range[1])
    const end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1
    return route.fulfill({
      status: 206,
      contentType: 'video/webm',
      body: clip.subarray(start, end + 1),
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${clip.length}` },
    })
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

/** The player around a post's video, once it has started. */
const playerOf = (page: Page, text: string) => page.locator('article').filter({ hasText: text, visible: true }).locator('.video-player')
const paused = (page: Page, text: string) => playerOf(page, text).locator('video').evaluate((v: HTMLVideoElement) => v.paused)

test('a video plays under our own controls, every one of them from the keyboard', async ({ browser }) => {
  const { page, handle } = await newMember(browser, 'keys')
  const { mediaId } = await seedVideoPost(handle, 'Keyboard video')
  await serve(page, mediaId)
  await page.goto(`/u/${handle}`)
  const post = page.locator('article').filter({ hasText: 'Keyboard video', visible: true })
  const player = playerOf(page, 'Keyboard video')
  const status = player.getByRole('status')

  // Enter on the poster plays it, and focus moves to the player's own Pause, not the browser's.
  await post.getByRole('button', { name: /^Play video/ }).focus()
  await page.keyboard.press('Enter')
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeFocused()
  await expect(player.locator('video')).not.toHaveAttribute('controls')
  await expect.poll(() => paused(page, 'Keyboard video')).toBe(false)
  // While the keyboard is in them, the controls do not fade, and focus is drawn.
  await page.waitForTimeout(3_000)
  await expect(player).not.toHaveClass(/is-resting/)
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toHaveCSS('outline-style', 'solid')

  // K pauses, and says so.
  await page.keyboard.press('k')
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeFocused()
  await expect(status).toHaveText('Paused')
  expect(await paused(page, 'Keyboard video')).toBe(true)

  // Tab reaches the seek bar, a slider that says where it is; the arrows move 5 seconds.
  await page.keyboard.press('Tab')
  const seek = player.getByRole('slider', { name: 'Seek' })
  await expect(seek).toBeFocused()
  await page.keyboard.press('Home')
  await expect(seek).toHaveAttribute('aria-valuetext', '0:00 of 1:00')
  await page.keyboard.press('ArrowRight')
  await expect(seek).toHaveAttribute('aria-valuetext', '0:05 of 1:00')
  await page.keyboard.press('ArrowUp')
  await expect(seek).toHaveAttribute('aria-valuetext', '0:10 of 1:00')
  await page.keyboard.press('ArrowLeft')
  await expect(seek).toHaveAttribute('aria-valuetext', '0:05 of 1:00')
  expect(await player.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(5, 1)
  await expect(player).toContainText('0:05 / 1:00')

  // Space plays from the seek bar, and pauses again.
  await page.keyboard.press(' ')
  await expect(status).toHaveText('Playing')
  await expect.poll(() => paused(page, 'Keyboard video')).toBe(false)
  await page.keyboard.press(' ')
  await expect(status).toHaveText('Paused')

  // M mutes and unmutes from anywhere in the player; Space on the button does it once.
  await page.keyboard.press('m')
  await expect(status).toHaveText('Muted')
  await expect(player.getByRole('button', { name: 'Unmute' })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(player.getByRole('button', { name: 'Unmute' })).toBeFocused()
  await page.keyboard.press(' ')
  await expect(player.getByRole('button', { name: 'Mute', exact: true })).toBeFocused()
  expect(await player.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false)

  // Full screen is the player, controls and all; F leaves it again.
  await page.keyboard.press('Tab')
  await expect(player.getByRole('button', { name: 'Full screen' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? '')).toContain('video-player')
  await expect(player.getByRole('button', { name: 'Exit full screen' })).toBeFocused()
  await page.keyboard.press('f')
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(player.getByRole('button', { name: 'Full screen' })).toBeVisible()
})

test('the controls fade while it plays and come back when the pointer moves; a click pauses', async ({ browser }) => {
  const { page, handle } = await newMember(browser, 'mouse')
  const { mediaId } = await seedVideoPost(handle, 'Mouse video')
  await serve(page, mediaId)
  await page.goto(`/u/${handle}`)
  const post = page.locator('article').filter({ hasText: 'Mouse video', visible: true })
  const player = playerOf(page, 'Mouse video')

  await post.getByRole('button', { name: /^Play video/ }).click()
  await expect.poll(() => paused(page, 'Mouse video')).toBe(false)
  await expect(player).toHaveClass(/is-resting/, { timeout: 6_000 })
  const bar = player.locator('.video-player-bar')
  await expect(bar).toHaveCSS('opacity', '0')

  const box = (await player.boundingBox())!
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3)
  await expect(player).not.toHaveClass(/is-resting/)
  await expect(bar).toHaveCSS('opacity', '1')

  // A click on the picture pauses it, and paused, the controls stay.
  await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3)
  await expect.poll(() => paused(page, 'Mouse video')).toBe(true)
  await page.waitForTimeout(3_000)
  await expect(player).not.toHaveClass(/is-resting/)
  // And the bar's button plays it again.
  await player.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => paused(page, 'Mouse video')).toBe(false)
})

test('on a 375px phone a tap brings the controls back, and the big button pauses', async ({ browser }) => {
  const { page, handle } = await newMember(browser, 'thumb', { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })
  const { mediaId } = await seedVideoPost(handle, 'Phone video')
  await serve(page, mediaId)
  await page.goto(`/u/${handle}`)
  const post = page.locator('article').filter({ hasText: 'Phone video', visible: true })
  const player = playerOf(page, 'Phone video')

  await post.getByRole('button', { name: /^Play video/ }).tap()
  await expect.poll(() => paused(page, 'Phone video')).toBe(false)
  await expect(player).toHaveClass(/is-resting/, { timeout: 6_000 })

  // A tap on the picture shows them; another hides them again while it plays.
  await player.tap({ position: { x: 20, y: 20 } })
  await expect(player).not.toHaveClass(/is-resting/)
  await player.tap({ position: { x: 20, y: 20 } })
  await expect(player).toHaveClass(/is-resting/)

  // Every control fits: the seek bar has its own row above the buttons, inside the player.
  await player.tap({ position: { x: 20, y: 20 } })
  const frame = (await player.boundingBox())!
  for (const control of [player.getByRole('slider', { name: 'Seek' }), ...['Pause', 'Mute', 'Full screen'].map((name) => player.getByRole('button', { name, exact: true }))]) {
    const box = (await control.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(frame.x)
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5)
  }
  const seek = (await player.getByRole('slider', { name: 'Seek' }).boundingBox())!
  const pause = (await player.getByRole('button', { name: 'Pause', exact: true }).boundingBox())!
  expect(seek.y + seek.height).toBeLessThanOrEqual(pause.y + 0.5)

  // The big button in the middle is the thumb's way to pause.
  await player.locator('.video-player-big').tap()
  await expect.poll(() => paused(page, 'Phone video')).toBe(true)
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
})
