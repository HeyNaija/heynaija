import { expect, test } from '@playwright/test'
import { gif } from '../lib/gif.ts'
import { expectOnScreen } from '../lib/layout.ts'
import { newMember } from '../lib/members.ts'

/** Writes a post with one GIF attached and waits for it to appear in the feed. */
async function postGif(page: import('@playwright/test').Page, text: string, alt: string) {
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  await box.fill(text)
  await page.locator('#compose input[type="file"]').setInputFiles({ name: 'dance.gif', mimeType: 'image/gif', buffer: gif() })
  await page.getByLabel('Description of GIF 1').fill(alt)
  const submit = page.getByRole('button', { name: 'Post', exact: true })
  await expect(submit).toBeEnabled({ timeout: 45_000 })
  await submit.click()
  const article = page.locator('article', { hasText: text }).first()
  await expect(article.getByRole('img', { name: alt })).toBeVisible({ timeout: 30_000 })
  return article
}

test('a GIF plays in the post, can be paused and played, and opens full screen @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'gifter')
  const alt = 'Two colours swapping sides'
  const article = await postGif(page, `Dancing colours from ${handle}`, alt)
  const picture = article.getByRole('img', { name: alt })

  await expect(picture).toHaveAttribute('src', /\/640\.webp$/)
  const pause = article.getByRole('button', { name: 'Pause GIF' })
  await expect(pause).toBeVisible()
  // Centred, so the phone's bottom bar is not over it.
  await pause.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await expectOnScreen(pause)

  await pause.click()
  await expect(picture).toHaveAttribute('src', /\/still\.webp$/)
  await expect(article.getByRole('button', { name: 'Play GIF' })).toBeVisible()
  await article.getByRole('button', { name: 'Play GIF' }).click()
  await expect(picture).toHaveAttribute('src', /\/640\.webp$/)

  // The stored picture really is an animation, and the still beside it is one frame.
  const src = (await picture.getAttribute('src'))!
  const moving = await page.request.get(src)
  expect(moving.headers()['content-type']).toContain('image/webp')
  expect((await moving.body()).includes(Buffer.from('ANIM'))).toBe(true)
  const still = await page.request.get(src.replace('640.webp', 'still.webp'))
  expect((await still.body()).includes(Buffer.from('ANIM'))).toBe(false)

  await article.getByRole('link', { name: new RegExp(`^View GIF 1 of 1: ${alt}`) }).click()
  const viewer = page.getByRole('dialog', { name: 'Image' })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByRole('img', { name: alt })).toHaveAttribute('src', /\/1600\.webp$/)
  await viewer.getByRole('button', { name: 'Pause GIF' }).click()
  await expect(viewer.getByRole('img', { name: alt })).toHaveAttribute('src', /\/still\.webp$/)
  await expectOnScreen(viewer.getByRole('button', { name: 'Play GIF' }))
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await context.close()
})

test('a reader who asks for less motion gets the still, and can still play it', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'calm', { reducedMotion: 'reduce' })
  const alt = 'A calm GIF'
  const article = await postGif(page, `Gentle one from ${handle}`, alt)
  const picture = article.getByRole('img', { name: alt })
  await expect(picture).toHaveAttribute('src', /\/still\.webp$/)
  await article.getByRole('button', { name: 'Play GIF' }).click()
  await expect(picture).toHaveAttribute('src', /\/640\.webp$/)
  await context.close()
})

test('a quote of a GIF shows its first frame, which never moves', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'quoter')
  const alt = 'Swapping colours again'
  const article = await postGif(page, `Original GIF by ${handle}`, alt)
  const id = (await article.getAttribute('id'))!.replace('post-', '')
  await page.goto(`/p/${id}/quote`)
  await page.getByRole('textbox', { name: 'New post' }).fill(`Quoting ${handle}`)
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await page.waitForURL(/\/p\/[0-9a-f-]+$/)
  const quoted = page.locator('article', { hasText: `Quoting ${handle}` }).first().locator('.quoted-post')
  await expect(quoted.getByRole('img', { name: alt })).toHaveAttribute('src', /\/still\.webp$/)
  await context.close()
})

test('a GIF over 10 MB is refused before it is sent', async ({ browser }) => {
  const { page, context } = await newMember(browser, 'bigif')
  await page.goto('/')
  await page.getByRole('textbox', { name: 'New post' }).click()
  await page.locator('#compose input[type="file"]').setInputFiles({
    name: 'huge.gif',
    mimeType: 'image/gif',
    buffer: Buffer.concat([gif(), Buffer.alloc(10 * 1024 * 1024)]),
  })
  await expect(page.getByRole('alert').filter({ hasText: 'That GIF is too large' })).toBeVisible()
  await context.close()
})
