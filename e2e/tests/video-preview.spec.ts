import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { ageAccount } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'

// A 3.5 second VP8 test pattern, 320x180, which every test browser can play.
const clip = readFileSync(new URL('../fixtures/clip.webm', import.meta.url))

// Video waits for an account to be a week old. The dev stack runs no video worker,
// so an upload that goes through stops at "Processing" (or "Ready" where one runs).
const sent = /^(Processing\.|Ready)/

test('a picked video plays in the composer from the member’s own file while it uploads', async ({ browser }) => {
  const { page, handle } = await newMember(browser, 'clipper')
  await ageAccount(handle, 8)
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  await page.locator('#compose input[type="file"][accept*="video"]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: clip })

  // Shown at once, from the device itself (an object URL), with its picture.
  const preview = page.getByLabel('Preview of clip.webm')
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => [v.src.startsWith('blob:'), v.videoWidth, v.videoHeight])).toEqual([true, 320, 180])

  // It plays under the same controls as a post's video, not the browser's, to its end,
  // where Play starts it again.
  const player = page.locator('.composer-video-preview .video-player')
  const seek = player.getByRole('slider', { name: 'Seek' })
  await expect(preview).not.toHaveAttribute('controls')
  await expect(seek).toHaveAttribute('aria-valuetext', '0:00 of 0:04')
  await player.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect(seek).toHaveAttribute('aria-valuetext', '0:04 of 0:04', { timeout: 10_000 })
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  // Its keys work there too.
  await player.getByRole('button', { name: 'Play', exact: true }).focus()
  await page.keyboard.press('m')
  await expect(player.getByRole('button', { name: 'Unmute' })).toBeVisible()
  expect(await preview.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true)

  // The upload runs alongside it, and the preview stays.
  await expect(page.getByRole('status').filter({ hasText: sent })).toBeVisible({ timeout: 45_000 })
  await expect(preview).toBeVisible()

  await page.getByRole('button', { name: 'Remove video' }).click()
  await expect(preview).toHaveCount(0)
})

test('a video this browser cannot play still uploads, and the composer says there is no preview', async ({ browser }) => {
  const { page, handle } = await newMember(browser, 'hevc')
  await ageAccount(handle, 8)
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  // Bytes no browser can decode, as an HEVC clip is to some desktop browsers.
  const unreadable = Buffer.alloc(64 * 1024, 7)
  await page.locator('#compose input[type="file"][accept*="video"]').setInputFiles({ name: 'phone.mp4', mimeType: 'video/mp4', buffer: unreadable })

  await expect(page.getByText('This browser cannot play this video, so there is no preview.')).toBeVisible()
  await expect(page.getByLabel(/^Preview of/)).toHaveCount(0)
  // A preview that fails stops nothing: the file is still sent.
  await expect(page.getByRole('status').filter({ hasText: sent })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Remove video' })).toBeVisible()
})
