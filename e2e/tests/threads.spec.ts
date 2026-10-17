import { expect, test } from '@playwright/test'
import { pool, seedThread } from '../lib/db.ts'
import { newMember, replyBox } from '../lib/members.ts'

test('expands, reuses and pages branches, and replies to the selected post @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'threads')
  try {
    const fixture = await seedThread(handle)
    await page.goto(`/p/${fixture.root}`)
    await expect(page.locator('article', { hasText: `Thread reply ` })).toHaveCount(20)
    await expect(page.locator(`#post-${fixture.nested[0]}`)).toHaveCount(0)
    const url = page.url()
    let actions = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action']) actions += 1
    })
    const branch = page.locator(`.thread-branch[data-thread-id="${fixture.first}"]`)
    await branch.getByRole('link', { name: /^View.*replies/i }).first().click()
    await expect(page.locator(`#post-${fixture.nested[0]}`)).toBeVisible()
    await expect(page).toHaveURL(url)
    const afterExpansion = actions
    expect(afterExpansion).toBeGreaterThan(0)
    await branch.getByRole('link', { name: /^Hide replies/i }).first().click()
    await expect(page.locator(`#post-${fixture.nested[0]}`)).toBeHidden()
    await branch.getByRole('link', { name: /^View.*replies/i }).first().click()
    await expect(page.locator(`#post-${fixture.nested[0]}`)).toBeVisible()
    expect(actions).toBe(afterExpansion)

    const draft = await replyBox(page, fixture.root)
    await draft.fill('Draft retained while a branch collapses')
    await branch.getByRole('link', { name: /^Hide replies/i }).first().click()
    await expect(draft).toHaveValue('Draft retained while a branch collapses')
    await branch.getByRole('link', { name: /^View.*replies/i }).first().click()
    await draft.fill('')

    await page.getByRole('link', { name: 'More replies', exact: true }).click()
    await expect(page.locator('article', { hasText: `Thread reply ` })).toHaveCount(25)

    await page.locator(`#post-${fixture.first}`).getByRole('link', { name: /^Reply \(/ }).click()
    await expect(page.locator('form#compose input[name="replyTo"]')).toHaveValue(fixture.first)
    const answer = `Selected branch answer from ${handle}`
    await (await replyBox(page, fixture.first)).fill(answer)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(branch.locator('article', { hasText: answer })).toBeVisible()
    await expect(page).toHaveURL(url)
    await expect(page.locator('form#compose')).toHaveCount(1)
    // Existing expanded rows survive success; no route rebuild discards them.
    await expect(page.locator(`#post-${fixture.nested[0]}`)).toBeVisible()
    const secondAnswer = `Second selected answer from ${handle}`
    await (await replyBox(page, fixture.first)).fill(secondAnswer)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(branch.locator('article', { hasText: secondAnswer })).toBeVisible()
    const db = pool()
    try {
      const { rows } = await db.query<{ reply_parent_id: string; root_id: string }>('select reply_parent_id, root_id from posts where text = $1', [answer])
      expect(rows).toEqual([{ reply_parent_id: fixture.first, root_id: fixture.root }])
    } finally {
      await db.end()
    }
    await page.setViewportSize({ width: 320, height: 740 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await context.close()
  }
})

test('keeps surviving replies reachable through consecutive unavailable posts', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'bridge')
  try {
    const fixture = await seedThread(handle)
    await page.goto(`/p/${fixture.root}`)
    const branch = page.locator(`.thread-branch[data-thread-id="${fixture.bridgeParent}"]`)
    await branch.getByRole('link', { name: /^View.*replies/i }).first().click()
    for (const id of [fixture.bridge, fixture.nextBridge]) {
      const unavailable = page.locator(`.thread-branch[data-thread-id="${id}"]`)
      await expect(unavailable.locator(`#post-${id}`)).toHaveText('This post is no longer available.')
      await unavailable.getByRole('link', { name: /^View.*replies/i }).first().click()
    }
    await expect(page.locator(`#post-${fixture.survivor}`)).toHaveText(new RegExp(fixture.survivorText))
    await expect(page.getByText('Deleted bridge content must not appear', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Moderated bridge content must not appear', { exact: true })).toHaveCount(0)
    await page.goto(`/p/${fixture.survivor}#post-${fixture.survivor}`)
    await expect(page.locator(`#post-${fixture.survivor}`)).toBeVisible()
  } finally {
    await context.close()
  }
})

test('a new reply preserves an incomplete oldest-first page and is deduplicated later', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'gap')
  try {
    const fixture = await seedThread(handle)
    await page.goto(`/p/${fixture.root}`)
    const text = `Newest reply from ${handle}`
    await (await replyBox(page, fixture.root)).fill(text)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.locator('article', { hasText: text })).toBeVisible()
    await expect(page.locator('article', { hasText: 'Thread reply ' })).toHaveCount(20)
    await expect(page.getByRole('link', { name: 'More replies', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'More replies', exact: true }).click()
    await expect(page.locator('article', { hasText: 'Thread reply ' })).toHaveCount(25)
    await expect(page.locator('article', { hasText: text })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'More replies', exact: true })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('a malformed reply cycle cannot recursively render cached branches', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'cycle')
  try {
    const fixture = await seedThread(handle)
    const db = pool()
    try {
      await db.query('update posts set reply_parent_id = $1 where id = $2', [fixture.first, fixture.root])
    } finally {
      await db.end()
    }
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`/p/${fixture.root}`)
    const branch = page.locator(`.thread-branch[data-thread-id="${fixture.first}"]`)
    await branch.getByRole('link', { name: /^View.*replies/i }).first().click()
    await expect(branch.getByRole('link', { name: 'Continue conversation', exact: true })).toBeVisible()
    await expect(page.locator(`#post-${fixture.root}`)).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
