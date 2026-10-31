import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'

// Meetings (docs/adr/0017 stage 2) ship dark, behind the same switch as calls. This file runs only
// with E2E_CALLS=1, so the default and CI runs skip it. What it checks needs no media server: that a
// member who is not on the CALLS_MEMBERS allow-list sees nothing of meetings, whatever the API's
// CALLS_ENABLED says. Inviting, joining, host controls and real audio between two browsers are NOT
// covered: they need LiveKit and allow-listed handles, and are a manual device check (see docs/adr/0017 section 6).
test.skip(!process.env.E2E_CALLS, 'set E2E_CALLS=1 to run the meetings checks')

test('a member who is not on the calls list sees no meetings: pages and endpoints are the normal 404, no alert, no link', async ({ browser }) => {
  const member = await newMember(browser, 'nomeet')
  const id = '11111111-1111-4111-8111-111111111111'

  // The pages are the same not-found page as any missing URL.
  expect((await member.page.goto(`/meetings/${id}`))?.status()).toBe(404)
  expect((await member.page.goto('/meetings/new'))?.status()).toBe(404)
  expect((await member.page.goto('/nonexistent-meetings-check'))?.status()).toBe(404)

  // The API answers 404 in the words of a missing route, signed in or not.
  expect((await member.page.request.get('/api/v1/meetings/incoming')).status()).toBe(404)
  expect((await member.page.request.get(`/api/v1/meetings/${id}`)).status()).toBe(404)
  expect((await member.page.request.get(`/api/v1/meetings/${id}/invitable?q=a`)).status()).toBe(404)
  expect((await member.page.request.post('/api/v1/meetings', { data: { memberIds: [] } })).status()).toBe(404)
  expect((await member.page.request.post(`/api/v1/meetings/${id}/token`)).status()).toBe(404)

  // No "Start a meeting" link in Settings and no invitation alert anywhere.
  await member.page.goto('/settings')
  await expect(member.page.getByRole('link', { name: 'Start a meeting' })).toHaveCount(0)
  await expect(member.page.getByRole('alertdialog')).toHaveCount(0)

  // A signed-out visitor gets the same 404 for the page.
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  expect((await (await visitor.newPage()).goto(`/meetings/${id}`))?.status()).toBe(404)
  await visitor.close()
})
