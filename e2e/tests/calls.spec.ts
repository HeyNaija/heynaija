import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// 1:1 calls (docs/adr/0017 stage 1) ship dark. This file runs only with E2E_CALLS=1, so the
// default and CI runs skip it. What it checks needs no media server: that a member who is not
// on the CALLS_MEMBERS allow-list sees nothing of calls, whatever the API's CALLS_ENABLED says.
// Ringing between two real browsers and real audio are NOT covered: that needs LiveKit and two
// allow-listed handles, and is a manual device check (see docs/adr/0017 section 6).
test.skip(!process.env.E2E_CALLS, 'set E2E_CALLS=1 to run the calls checks')

test('a member who is not on the calls list sees no calls: pages and endpoints are the normal 404, no Call button, no alert', async ({ browser }) => {
  const caller = await newMember(browser, 'nocall')
  const other = await newMember(browser, 'nocalled')
  const id = '11111111-1111-4111-8111-111111111111'

  // The page is the same not-found page as any missing URL.
  const page = await caller.page.goto(`/calls/${id}`)
  expect(page?.status()).toBe(404)
  const missing = await caller.page.goto('/nonexistent-calls-check')
  expect(missing?.status()).toBe(404)

  // The API answers 404 in the words of a missing route, signed in or not.
  const incoming = await caller.page.request.get('/api/v1/calls/incoming')
  expect(incoming.status()).toBe(404)
  const canCall = await caller.page.request.get(`/api/v1/calls/can-call/${id}`)
  expect(canCall.status()).toBe(404)
  const start = await caller.page.request.post('/api/v1/calls', { data: { memberId: id } })
  expect(start.status()).toBe(404)

  // The profile has no Call button and the app has no incoming-call alert.
  await caller.page.goto(`/u/${other.handle}`)
  await expect(caller.page.getByRole('button', { name: /^Call/ })).toHaveCount(0)
  await expect(caller.page.getByRole('alertdialog')).toHaveCount(0)
  await caller.page.goto('/settings')
  await expect(caller.page.getByLabel('Allow calls')).toHaveCount(0)

  // A signed-out visitor gets the same 404 for the page.
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const anonymous = await (await visitor.newPage()).goto(`/calls/${id}`)
  expect(anonymous?.status()).toBe(404)
  await visitor.close()
})
