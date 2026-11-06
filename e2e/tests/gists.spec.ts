import { expect, test } from '@playwright/test'
import { MARK } from '../lib/env.ts'
import { codeFor } from '../lib/mailpit.ts'
import { signUpOverHttp } from '../lib/members.ts'

// Gists need a LiveKit server and an API that knows it, so CI (which has neither)
// skips this file. To run it locally, on your own stack:
//
//   pnpm infra:livekit
//   pnpm dev:api, with the LIVEKIT_* settings `pnpm infra:env` put in .env
//   E2E_GISTS=1 pnpm e2e gists
//
// The gists flag is on for everyone in development; if it has been limited to a
// list, add the two fixed handles below to it (or set it back to the default).
// Chromium's fake-media flags stand in for a microphone.
test.skip(!process.env.E2E_GISTS, 'needs LiveKit and the API configured for it; see the comment at the top of this file')

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
})

const HOST = `${MARK.handlePrefix}gist_host`
const EAR = `${MARK.handlePrefix}gist_ear`

test('a host goes live, a listener asks to speak, and approval gives them the microphone', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const host = await hostContext.newPage()
  await signUpOverHttp(host, HOST)

  await host.getByLabel('Gist title').fill('Jollof, settled')
  await host.getByRole('button', { name: 'Go live' }).click()
  await host.waitForURL(/\/gists\/[0-9a-f-]{36}$/)
  const url = host.url()
  // Back on Home, which Next shows as it was left, the form is ready again, not stuck on Starting….
  await host.goBack()
  await expect(host.getByRole('button', { name: 'Go live' })).toBeEnabled()
  await expect(host.getByLabel('Gist title')).toHaveValue('')
  await host.goto(url)
  await host.getByRole('button', { name: 'Join the Gist' }).click()
  await expect(host.getByRole('button', { name: 'Microphone', exact: true, pressed: false })).toBeVisible()

  const earContext = await browser.newContext()
  // Headless Chromium runs audio at 16 kHz, where RNNoise cannot work; a phone or laptop runs at 48 kHz.
  await earContext.addInitScript(() => {
    const Base = window.AudioContext
    window.AudioContext = class extends Base {
      constructor(options?: AudioContextOptions) {
        super({ sampleRate: 48_000, ...options })
      }
    }
  })
  const ear = await earContext.newPage()
  const earEmail = await signUpOverHttp(ear, EAR)

  // Sent the link while signed out (another device): asked to sign in first, with
  // nothing about this Gist on the page, then brought straight back to the room.
  const phoneContext = await browser.newContext()
  const phone = await phoneContext.newPage()
  await phone.goto(url)
  await expect(phone.getByRole('heading', { name: 'Sign in to join this Gist' })).toBeVisible()
  await expect(phone.getByText('Jollof, settled')).toHaveCount(0)
  await phone.getByRole('link', { name: 'Sign in', exact: true }).click()
  await phone.getByLabel('Email address').fill(earEmail)
  const asked = new Date()
  await phone.getByRole('button', { name: 'Email me a code' }).click()
  await phone.getByLabel('Code from the email').fill(await codeFor(earEmail, asked))
  await phone.getByRole('button', { name: 'Continue' }).click()
  await phone.waitForURL(url)
  await expect(phone.getByRole('heading', { name: 'Jollof, settled' })).toBeVisible()
  await phoneContext.close()

  // The listener finds it in Home's Live now list, not from a shared link.
  await ear.goto('/')
  await ear.getByRole('link', { name: /Jollof, settled/ }).click()
  await ear.waitForURL(url)
  // Nothing is playing before the tap: no media element exists yet.
  await expect(ear.locator('audio')).toHaveCount(0)
  await expect(ear.getByText('Keep this screen open.').first()).toBeVisible()
  await ear.getByRole('button', { name: 'Join the Gist' }).click()
  await expect(ear.getByRole('heading', { name: 'On stage' })).toBeVisible()
  await expect(ear.getByRole('button', { name: 'Microphone', exact: true })).toHaveCount(0)

  await ear.getByRole('button', { name: 'Request to speak' }).click()
  await expect(ear.getByRole('button', { name: 'Cancel request' })).toBeVisible()

  // The host's poll (every 4 seconds) shows the request.
  await expect(host.getByRole('button', { name: /Let speak/ })).toBeVisible({ timeout: 15_000 })
  await host.getByRole('button', { name: /Let speak/ }).click()

  await expect(ear.getByRole('button', { name: 'Microphone', exact: true, pressed: false })).toBeVisible({ timeout: 15_000 })
  await expect(ear.getByRole('status').filter({ hasText: 'You are now a speaker' })).toBeAttached()

  // A new speaker is told about earphones until they speak. Turning the microphone on also starts
  // noise removal, which must never stop it: the button says On, and the tip has done its job.
  await expect(ear.getByText('Use earphones when you speak.')).toBeVisible()
  await ear.getByRole('button', { name: 'Microphone', exact: true }).click()
  await expect(ear.getByRole('button', { name: 'Microphone', exact: true, pressed: true })).toBeVisible()
  await expect(ear.getByText('Use earphones when you speak.')).toHaveCount(0)
  // RNNoise (fetched now, the first time) is cleaning up the microphone.
  await ear.getByRole('button', { name: 'Microphone settings' }).click()
  const micSettings = ear.getByRole('dialog', { name: 'Microphone settings' })
  await expect(micSettings.getByText('Strong noise removal is on.')).toBeVisible({ timeout: 10_000 })
  await micSettings.getByRole('button', { name: 'Close Microphone settings' }).click()
  // The Connection sheet reads the speaker's own stream and offers the figures to copy.
  await ear.getByRole('button', { name: 'Connection', exact: true }).click()
  const connection = ear.getByRole('dialog', { name: 'Connection' })
  await expect(connection.getByText('Sound lost on the way')).toBeVisible()
  await expect(connection.getByRole('button', { name: 'Copy figures' })).toBeEnabled({ timeout: 10_000 })
  await connection.getByRole('button', { name: 'Close Connection' }).click()

  // Anyone in the room but the host can report the Gist itself; the room keeps playing.
  await expect(host.getByRole('button', { name: 'Report', exact: true })).toHaveCount(0)
  await ear.getByRole('button', { name: 'Report', exact: true }).click()
  const sheet = ear.getByRole('dialog', { name: 'Report this Gist' })
  await sheet.getByRole('radio', { name: 'Harassment or bullying' }).check()
  await sheet.getByRole('button', { name: 'Send report' }).click()
  await expect(sheet.getByText('A moderator will review this Gist')).toBeVisible()
  await sheet.getByRole('button', { name: 'Back to the Gist' }).click()
  await expect(ear.getByRole('heading', { name: 'On stage' })).toBeVisible()

  // The host ends it; the listener's poll finds out.
  await host.getByRole('button', { name: 'End the Gist' }).click()
  await host.getByRole('button', { name: /Tap again to end/ }).click()
  await expect(ear.getByRole('heading', { name: 'This Gist has ended' })).toBeVisible({ timeout: 15_000 })

  await hostContext.close()
  await earContext.close()
})
