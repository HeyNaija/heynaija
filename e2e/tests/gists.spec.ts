import { expect, test } from '@playwright/test'
import { MARK } from '../lib/env.ts'
import { signUpOverHttp } from '../lib/members.ts'

// Gists need a LiveKit server and an API started with the Gists switches on, so
// CI (which has neither) skips this file. To run it locally, on your own stack:
//
//   pnpm infra:livekit
//   CALLS_ENABLED=true CALLS_GISTS_ENABLED=true \
//   CALLS_MEMBERS=e2e_gist_host,e2e_gist_ear \
//   LIVEKIT_URL=ws://127.0.0.1:7880 (and the LIVEKIT_* keys from .env) pnpm dev:api
//   E2E_GISTS=1 pnpm e2e gists
//
// The allow-list takes exact handles (ADR 0017's gate is temporary), hence the
// fixed ones below. Chromium's fake-media flags stand in for a microphone.
test.skip(!process.env.E2E_GISTS, 'needs LiveKit and the API with CALLS_* set; see the comment at the top of this file')

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
  await host.getByRole('button', { name: 'Join the Gist' }).click()
  await expect(host.getByRole('button', { name: 'Microphone', exact: true, pressed: false })).toBeVisible()

  const earContext = await browser.newContext()
  const ear = await earContext.newPage()
  await signUpOverHttp(ear, EAR)
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

  // The host ends it; the listener's poll finds out.
  await host.getByRole('button', { name: 'End the Gist' }).click()
  await host.getByRole('button', { name: /Tap again to end/ }).click()
  await expect(ear.getByRole('heading', { name: 'This Gist has ended' })).toBeVisible({ timeout: 15_000 })

  await hostContext.close()
  await earContext.close()
})
