import { expect, test } from '@playwright/test'
import { pool, seedThread } from '../lib/db.ts'
import { newMember, replyBox } from '../lib/members.ts'

test('expands, reuses and pages branches, and replies to the selected post @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'threads')
  try {
    const fixture = await seedThread(handle)
    await page.goto(`/p/${fixture.root}?replies=oldest`)
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
    await page.goto(`/p/${fixture.root}?replies=oldest`)
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

test('newest first, your new reply shows at the top and once, as more replies load', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'top')
  try {
    const fixture = await seedThread(handle)
    await page.goto(`/p/${fixture.root}`)
    await expect(page.locator('article', { hasText: 'Thread reply ' }).first()).toContainText('Thread reply 25 ')
    const text = `Newest reply from ${handle}`
    await (await replyBox(page, fixture.root)).fill(text)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    const rows = page.locator(`#replies-${fixture.root} > .thread-list > li > .thread-branch > .thread-row article`)
    await expect(rows.first()).toContainText(text)
    await page.getByRole('link', { name: 'More replies', exact: true }).click()
    await expect(page.locator('article', { hasText: 'Thread reply ' })).toHaveCount(25)
    await expect(page.locator('article', { hasText: text })).toHaveCount(1)
    await expect(rows.last()).toContainText('Thread reply 01 ')
  } finally {
    await context.close()
  }
})

test('a new reply preserves an incomplete oldest-first page and is deduplicated later', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'gap')
  try {
    const fixture = await seedThread(handle)
    await page.goto(`/p/${fixture.root}?replies=oldest`)
    const text = `Newest reply from ${handle}`
    await (await replyBox(page, fixture.root)).fill(text)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.locator('article', { hasText: text })).toBeVisible()
    await expect(page.getByText('Your reply · Some replies are not loaded yet.')).toBeVisible()
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
    await page.goto(`/p/${fixture.root}?replies=oldest`)
    const branch = page.locator(`.thread-branch[data-thread-id="${fixture.first}"]`)
    await branch.getByRole('link', { name: /^View.*replies/i }).first().click()
    await expect(branch.getByRole('link', { name: 'Continue conversation', exact: true })).toBeVisible()
    await expect(page.locator(`#post-${fixture.root}`)).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})

test("the author's own replies come first, then everyone else's newest first, and a switch reads them oldest first @mobile", async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'order')
  const other = await newMember(browser, 'other')
  await other.context.close()
  const db = pool()
  try {
    const { rows: [root] } = await db.query<{ id: string }>(
      `insert into posts (author_id, text, created_at)
       select id, 'Order fixture from ' || handle, now() - interval '1 hour' from members where handle = $1 returning id`,
      [handle],
    )
    // Alternating authors, a minute apart: the other member, then the post's author, twice.
    const replies: Record<string, string> = {}
    for (const [n, who] of [[1, other.handle], [2, handle], [3, other.handle], [4, handle]] as const) {
      const { rows: [reply] } = await db.query<{ id: string }>(
        `insert into posts (author_id, text, reply_parent_id, root_id, created_at)
         select id, $2, $3, $3, now() - interval '1 hour' + make_interval(mins => $4) from members where handle = $1 returning id`,
        [who, `Order reply ${n} from ${who}`, root!.id, n],
      )
      replies[n] = reply!.id
    }
    const order = () => page.locator(`#replies-${root!.id} > .thread-list > li > .thread-branch`)
      .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset.threadId))

    await page.goto(`/p/${root!.id}`)
    await expect(page.getByText(`@${handle}'s own replies come first, then everyone else's, newest first.`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Newest first', exact: true })).toHaveAttribute('aria-current', 'true')
    expect(await order()).toEqual([replies[4], replies[2], replies[3], replies[1]])

    await page.getByRole('link', { name: 'Oldest first', exact: true }).click()
    await expect(page).toHaveURL(/[?&]replies=oldest/)
    await expect(page.getByText(`@${handle}'s own replies come first, then everyone else's, oldest first.`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Oldest first', exact: true })).toHaveAttribute('aria-current', 'true')
    expect(await order()).toEqual([replies[2], replies[4], replies[1], replies[3]])

    // The author's new reply joins the end of their own, ahead of everyone else's.
    const text = `Author follow-up from ${handle}`
    await (await replyBox(page, root!.id)).fill(text)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.locator(`#replies-${root!.id} > .thread-list > li`).nth(2)).toContainText(text)

    await page.getByRole('link', { name: 'Newest first', exact: true }).click()
    await expect(page).not.toHaveURL(/replies=oldest/)
    await expect(page.locator(`#replies-${root!.id} > .thread-list > li`).first()).toContainText(text)
    expect((await order()).slice(1)).toEqual([replies[4], replies[2], replies[3], replies[1]])
  } finally {
    await db.end()
    await context.close()
  }
})
