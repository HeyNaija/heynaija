import { expect, test } from '@playwright/test'
import { MARK } from '../lib/env.ts'
import { signUpOverHttp } from '../lib/members.ts'

// Spaces need a LiveKit server and an API started with the Spaces switches on, so
// CI (which has neither) skips this file. To run it locally, on your own stack:
//
//   pnpm infra:livekit
//   CALLS_ENABLED=true CALLS_SPACES_ENABLED=true \
//   CALLS_MEMBERS=e2e_space_host,e2e_space_ear \
//   LIVEKIT_URL=ws://127.0.0.1:7880 (and the LIVEKIT_* keys from .env) pnpm dev:api
//   E2E_SPACES=1 pnpm e2e spaces
//
// The allow-list takes exact handles (ADR 0017's gate is temporary), hence the
// fixed ones below. Chromium's fake-media flags stand in for a microphone.
test.skip(!process.env.E2E_SPACES, 'needs LiveKit and the API with CALLS_* set; see the comment at the top of this file')

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
})

const HOST = `${MARK.handlePrefix}space_host`
const EAR = `${MARK.handlePrefix}space_ear`

test('a host goes live, a listener asks to speak, and approval gives them the microphone', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const host = await hostContext.newPage()
  await signUpOverHttp(host, HOST)

  await host.getByLabel('Space title').fill('Jollof, settled')
  await host.getByRole('button', { name: 'Go live' }).click()
  await host.waitForURL(/\/spaces\/[0-9a-f-]{36}$/)
  const url = host.url()
  await host.getByRole('button', { name: 'Join the Space' }).click()
  await expect(host.getByRole('button', { name: 'Microphone', exact: true, pressed: false })).toBeVisible()

  const earContext = await browser.newContext()
  const ear = await earContext.newPage()
  await signUpOverHttp(ear, EAR)
  await ear.goto(url)
  // Nothing is playing before the tap: no media element exists yet.
  await expect(ear.locator('audio')).toHaveCount(0)
  await expect(ear.getByText('Keep this screen open.').first()).toBeVisible()
  await ear.getByRole('button', { name: 'Join the Space' }).click()
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
  await host.getByRole('button', { name: 'End the Space' }).click()
  await host.getByRole('button', { name: /Tap again to end/ }).click()
  await expect(ear.getByRole('heading', { name: 'This Space has ended' })).toBeVisible({ timeout: 15_000 })

  await hostContext.close()
  await earContext.close()
})

test('a member who is not on the list gets the normal not-found page', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signUpOverHttp(page, `${MARK.handlePrefix}space_out`)
  // The proxy answers a member who is not on the list exactly as it answers a missing URL.
  const res = await page.goto('/spaces/00000000-0000-4000-8000-000000000000')
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
  await context.close()
})
