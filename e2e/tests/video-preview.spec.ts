import { closeSync, ftruncateSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { ageAccount, videoUploadCount } from '../lib/db.ts'
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

test('a member saving data is asked before a video is sent, with its size; Send video sends it', async ({ browser, baseURL }) => {
  const { page, handle } = await newMember(browser, 'saver')
  await ageAccount(handle, 8)
  await page.context().addCookies([{ name: 'hn_data', value: 'saver', url: baseURL! }])
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  await page.locator('#compose input[type="file"][accept*="video"]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: clip })

  // The preview plays from the device, which costs no data; nothing goes until the member says so.
  await expect(page.getByLabel('Preview of clip.webm')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^You are saving data, and this video is \d+\.\d MB\. Send it\?$/ })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  expect(await videoUploadCount(handle)).toBe(0)

  await page.getByRole('button', { name: 'Send video' }).click()
  await expect(page.getByRole('status').filter({ hasText: sent })).toBeVisible({ timeout: 45_000 })
  expect(await videoUploadCount(handle)).toBe(1)
})

test('a video over 200 MB shows its size and waits; removing it sends nothing', async ({ browser }) => {
  const { page, handle } = await newMember(browser, 'bigclip')
  await ageAccount(handle, 8)
  // 250 MB of nothing, sparse on disk: the composer asks before it reads a byte to send.
  const dir = mkdtempSync(join(tmpdir(), 'e2e-big-video-'))
  const big = join(dir, 'concert.mp4')
  const fd = openSync(big, 'w')
  ftruncateSync(fd, 250_000_000)
  closeSync(fd)
  try {
    await page.goto('/')
    await page.getByRole('textbox', { name: 'New post' }).click()
    await page.locator('#compose input[type="file"][accept*="video"]').setInputFiles(big)

    await expect(page.getByRole('status').filter({ hasText: 'This video is 250.0 MB, so sending it uses that much data. Send it?' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Send video' })).toBeVisible()
    await expect(page.locator('#compose').getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
    expect(await videoUploadCount(handle)).toBe(0)

    await page.getByRole('button', { name: 'Remove video' }).click()
    await expect(page.getByRole('button', { name: 'Send video' })).toHaveCount(0)
    expect(await videoUploadCount(handle)).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
