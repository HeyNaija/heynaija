import { expect, test } from '@playwright/test'
import { pool, seedThread } from '../lib/db.ts'
import { newMember, replyBox } from '../lib/members.ts'

test('expands, reuses and pages branches, and replies to the selected post @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'threads')
  try {
    const fixture = await seedThread(handle)
    const counts = pool()
    try {
      await counts.query('update posts set like_count = 123456789, repost_count = 123456789 where id = $1', [fixture.first])
    } finally {
      await counts.end()
    }
    await page.goto(`/p/${fixture.root}?replies=oldest`)
    const composer = page.locator('form#compose')
    const photo = composer.getByRole('button', { name: 'Add images (up to 4)', exact: true })
    await expect(photo).toBeHidden()
    await expect(composer.locator('.composer-privacy')).toBeHidden()
    expect(await composer.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(64)
    await (await replyBox(page, fixture.root)).click()
    await expect(photo).toBeVisible()
    await page.getByRole('heading', { name: 'Replies', exact: true }).click()
    await expect(photo).toBeHidden()
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
    // The toggle lives in the reply's action row, so its answers sit as close to it as to each other.
    const gaps = await page.evaluate((ids) => {
      const box = (id: string) => document.getElementById(`post-${id}`)!.getBoundingClientRect()
      return [Math.round(box(ids[1]!).top - box(ids[0]!).bottom), Math.round(box(ids[2]!).top - box(ids[1]!).bottom)]
    }, [fixture.first, fixture.nested[0]!, fixture.nested[1]!])
    expect(gaps[0]).toBe(gaps[1])
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
    for (const id of [fixture.first, fixture.nested[0]]) {
      const card = page.locator(`#post-${id}`)
      await card.scrollIntoViewIfNeeded()
      expect(await card.evaluate((node) => {
        const bounds = node.getBoundingClientRect()
        return Array.from(node.querySelectorAll('.post-actions .icon-btn, .post-actions .thread-toggle')).every((control) => {
          const box = control.getBoundingClientRect()
          return box.width >= 44 && box.height >= 34 && box.left >= bounds.left && box.right <= bounds.right
        })
      })).toBe(true)
    }
    await expect(page.locator('.square-bottom-nav').getByRole('link', { name: 'Alerts (Notifications)', exact: true })).toHaveText('Alerts')
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
      await expect(unavailable.locator(`#post-${id} > p`)).toHaveText('This post is no longer available.')
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
    // Under a reply, a back-and-forth reads down the page: oldest first, whatever the order above.
    await page.locator(`.thread-branch[data-thread-id="${fixture.first}"] > .thread-row a.thread-toggle`).click()
    await expect(page.locator(`#post-${fixture.nested[1]}`)).toBeVisible()
    expect(await page.locator(`#replies-${fixture.first} > .thread-list > li > .thread-branch`)
      .evaluateAll((branches) => branches.map((row) => (row as HTMLElement).dataset.threadId))).toEqual(fixture.nested)
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
    const options = page.getByLabel('Reply options', { exact: true })
    await expect(page.locator('.thread-order-rule')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Oldest first', exact: true })).toBeHidden()
    await options.click()
    await expect(page.getByText(`@${handle}'s own replies come first, then everyone else's, newest first.`)).toBeVisible()
    await expect(page.locator(`#post-${replies[4]}`).getByText('Author', { exact: true })).toBeVisible()
    // The post in focus carries it too.
    await expect(page.locator(`#post-${root!.id}`).getByText('Author', { exact: true })).toBeVisible()
    await expect(page.locator(`#post-${replies[3]}`).getByText('Author', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Newest first', exact: true })).toHaveAttribute('aria-current', 'true')
    expect(await order()).toEqual([replies[4], replies[2], replies[3], replies[1]])

    await page.getByRole('link', { name: 'Oldest first', exact: true }).click()
    await expect(page).toHaveURL(/[?&]replies=oldest/)
    await options.click()
    await expect(page.getByText(`@${handle}'s own replies come first, then everyone else's, oldest first.`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Oldest first', exact: true })).toHaveAttribute('aria-current', 'true')
    expect(await order()).toEqual([replies[2], replies[4], replies[1], replies[3]])
    // Closed before writing, as anyone would: kept inside the screen, the open panel can sit over the editor.
    await page.keyboard.press('Escape')
    await expect(page.locator('.thread-order-rule')).toBeHidden()

    // The author's new reply joins the end of their own, ahead of everyone else's.
    const text = `Author follow-up from ${handle}`
    await (await replyBox(page, root!.id)).fill(text)
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.locator(`#replies-${root!.id} > .thread-list > li`).nth(2)).toContainText(text)
    await expect(page.locator('article', { hasText: text }).getByText('Author', { exact: true })).toBeVisible()

    await options.click()
    await page.getByRole('link', { name: 'Newest first', exact: true }).click()
    await expect(page).not.toHaveURL(/replies=oldest/)
    await expect(page.locator(`#replies-${root!.id} > .thread-list > li`).first()).toContainText(text)
    expect((await order()).slice(1)).toEqual([replies[4], replies[2], replies[3], replies[1]])
  } finally {
    await db.end()
    await context.close()
  }
})

test('replies open in place five levels deep; below that a post continues as its own conversation @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'depth')
  const db = pool()
  try {
    // A post and a chain of replies under it, one level each: level 6 is out of reach in place.
    const { rows: [member] } = await db.query<{ id: string }>('select id from members where handle = $1', [handle])
    const ids: string[] = []
    for (let level = 0; level <= 6; level++) {
      const { rows: [post] } = await db.query<{ id: string }>(
        `insert into posts (author_id, text, reply_parent_id, root_id, created_at)
         values ($1, $2, $3, $4, now() - interval '1 hour' + make_interval(secs => $5)) returning id`,
        [member!.id, `Level ${level} post`, ids[level - 1] ?? null, level ? ids[0] : null, level],
      )
      ids.push(post!.id)
    }
    const expand = (id: string) => page.locator(`.thread-branch[data-thread-id="${id}"] > .thread-row a.thread-toggle`)

    await page.goto(`/p/${ids[0]}`)
    await expect(page.locator(`#post-${ids[1]}`)).toBeVisible()
    for (const level of [1, 2, 3, 4]) {
      await expand(ids[level]!).click()
      await expect(page.locator(`#post-${ids[level + 1]}`)).toBeVisible()
    }
    // The fifth level offers the conversation, not another level.
    await expect(expand(ids[5]!)).toHaveText('Continue conversation')
    await expect(page.locator(`#post-${ids[6]}`)).toHaveCount(0)
    // Every level indents, and the fifth still has room for its text and buttons.
    const lefts = await Promise.all(ids.slice(1, 6).map((id) => page.locator(`#post-${id}`).evaluate((node) => node.getBoundingClientRect().left)))
    for (let i = 1; i < lefts.length; i++) expect(lefts[i]!).toBeGreaterThan(lefts[i - 1]!)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // Answering the fourth level adds its reply in place.
    const url = page.url()
    await page.locator(`#post-${ids[4]} .post-actions a[aria-label^="Reply"]`).click()
    await (await replyBox(page, ids[4])).fill('An answer one level down')
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.locator('article', { hasText: 'An answer one level down' })).toBeVisible()
    expect(page.url()).toBe(url)

    // Answering the fifth opens it, since a reply there would not be shown on this page.
    await page.locator(`#post-${ids[5]} .post-actions a[aria-label^="Reply"]`).click()
    await expect(page).toHaveURL(new RegExp(`/p/${ids[5]}#compose$`))
    await expect(page.locator(`#post-${ids[6]}`)).toBeVisible()
  } finally {
    await db.end()
    await context.close()
  }
})

/** A post and a chain of replies under it, one level each, all by `handle`. */
async function seedChain(handle: string, levels: number) {
  const db = pool()
  try {
    const { rows: [member] } = await db.query<{ id: string }>('select id from members where handle = $1', [handle])
    const ids: string[] = []
    for (let level = 0; level <= levels; level++) {
      const { rows: [post] } = await db.query<{ id: string }>(
        `insert into posts (author_id, text, reply_parent_id, root_id, created_at)
         values ($1, $2, $3, $4, now() - interval '1 hour' + make_interval(secs => $5)) returning id`,
        [member!.id, `Chain level ${level} post`, ids[level - 1] ?? null, level ? ids[0] : null, level],
      )
      ids.push(post!.id)
    }
    return ids
  } finally {
    await db.end()
  }
}

test('the conversation above a reply is open and joined by a line, and the reply bar sits under the focused post @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'lineage')
  try {
    const ids = await seedChain(handle, 4)
    await page.goto(`/p/${ids[3]}`)
    // Older posts are on the page, not behind a disclosure.
    await expect(page.locator('details.thread-context')).toHaveCount(0)
    for (const id of [ids[0], ids[1], ids[2]]) await expect(page.locator(`#post-${id}`)).toBeVisible()
    await expect(page.getByRole('list', { name: 'Earlier in this conversation' }).locator('> li')).toHaveCount(3)
    // The author is named on every post of theirs: ancestors, the focused post and its reply.
    for (const id of [ids[0], ids[1], ids[2], ids[3], ids[4]]) {
      await expect(page.locator(`#post-${id}`).getByText('Author', { exact: true })).toBeVisible()
    }
    // The line is decoration: a pseudo-element, so nothing for assistive technology to read.
    const line = await page.locator('.thread-chain > li').first().evaluate((node) => {
      const style = getComputedStyle(node, '::before')
      return { content: style.content, width: style.width }
    })
    expect(line.content).not.toBe('none')
    expect(line.width).toBe('2px')

    // Chain, focused post, reply bar, replies: in that order down the page.
    const top = (selector: string) => page.locator(selector).first().evaluate((node) => node.getBoundingClientRect().top)
    const order = [await top(`#post-${ids[2]}`), await top(`#post-${ids[3]}`), await top('form#compose'), await top(`#post-${ids[4]}`)]
    expect(order).toEqual([...order].sort((a, b) => a - b))

    // The bar is one line, with its Reply button in view and waiting for words.
    const reply = page.locator('form#compose').getByRole('button', { name: 'Reply', exact: true })
    await expect(page.locator('form#compose').getByRole('textbox', { name: 'Your reply' })).toHaveAttribute('placeholder', 'Post your reply')
    await expect(reply).toBeVisible()
    await expect(reply).toBeDisabled()
    await expect(page.locator('form#compose .composer-privacy')).toBeHidden()
    await (await replyBox(page, ids[3])).fill('Typed into the bar')
    await expect(reply).toBeEnabled()

    // No sideways scroll, even at the narrowest width.
    await page.setViewportSize({ width: 320, height: 740 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await context.close()
  }
})

test('on a phone the reply bar stays above the bottom tabs while the replies scroll @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'sticky')
  try {
    const fixture = await seedThread(handle)
    await page.setViewportSize({ width: 390, height: 740 })
    await page.goto(`/p/${fixture.root}`)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    const bar = page.locator('form#compose')
    await expect(bar).toBeInViewport()
    const [form, nav] = await Promise.all([
      bar.evaluate((node) => node.getBoundingClientRect().bottom),
      page.locator('.square-bottom-nav').evaluate((node) => node.getBoundingClientRect().top),
    ])
    expect(form).toBeLessThanOrEqual(nav + 1)
  } finally {
    await context.close()
  }
})

test('a signed-out visitor is asked to sign in to reply, right under the post', async ({ browser }) => {
  const author = await newMember(browser, 'ask')
  const ids = await seedChain(author.handle, 2)
  await author.context.close()
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await visitor.newPage()
  try {
    await page.goto(`/p/${ids[1]}`)
    const prompt = page.getByRole('link', { name: 'Sign in to reply', exact: true })
    await expect(prompt).toBeVisible()
    await expect(prompt).toHaveAttribute('href', '/login')
    await expect(page.locator('form#compose')).toHaveCount(0)
    // Not a notice at the foot of the page any more.
    await expect(page.locator('.notice')).toHaveCount(0)
    const top = (selector: string) => page.locator(selector).first().evaluate((node) => node.getBoundingClientRect().top)
    const focused = await top(`#post-${ids[1]}`)
    const asked = await prompt.evaluate((node) => node.getBoundingClientRect().top)
    const reply = await top(`#post-${ids[2]}`)
    expect(focused).toBeLessThan(asked)
    expect(asked).toBeLessThan(reply)
  } finally {
    await visitor.close()
  }
})
