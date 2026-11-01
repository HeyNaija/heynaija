import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'
import { png } from '../lib/png.ts'
import { expectNoHorizontalScroll, expectOnScreen, expectQuoteFrame } from '../lib/layout.ts'

test('posts an image with a description and opens it full screen @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'snapper')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  const text = `Sunset in Lekki, from ${handle}`
  await box.fill(text)

  // The image button opens a hidden file input; set the file on it directly.
  await page.locator('#compose input[type="file"]:not([accept*="video"])').setInputFiles({
    name: 'sunset.png',
    mimeType: 'image/png',
    buffer: png(),
  })
  const alt = 'Green and pale green halves, a stand-in for a sunset'
  await page.getByLabel('Description of image 1').fill(alt)

  // The image uploads and is processed in a background job; Post waits for it.
  const submit = page.getByRole('button', { name: 'Post', exact: true })
  await expect(submit).toBeEnabled({ timeout: 45_000 })
  await submit.click()

  const article = page.locator('article', { hasText: text }).first()
  await expect(article.getByRole('img', { name: alt })).toBeVisible({ timeout: 30_000 })

  const url = page.url()
  await article.getByRole('link', { name: new RegExp(`^View image 1 of 1: ${alt}`) }).click()
  const viewer = page.getByRole('dialog', { name: 'Image' })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByRole('img', { name: alt })).toBeVisible()
  await expectOnScreen(viewer.getByRole('button', { name: 'Close', exact: true }))
  await expect(page).toHaveURL(url)
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(page).toHaveURL(url)
  await context.close()
})

for (const count of [2, 3, 4]) {
  test(`${count} mixed-shape images tile correctly and the viewer stays usable @mobile`, async ({ browser }) => {
    const { page, handle, context } = await newMember(browser, `pics${count}`)
    try {
      await page.goto('/')
      const text = `${count} photos from ${handle}`
      await page.getByRole('textbox', { name: 'New post' }).fill(text)
      const shapes = [[400, 1000], [1280, 360], [600, 600], [360, 900]]
      await page.locator('#compose input[type="file"]:not([accept*="video"])').setInputFiles(shapes.slice(0, count).map(([width, height], i) => ({
        name: `photo-${i}.png`, mimeType: 'image/png', buffer: png(width, height),
      })))
      const alts = Array.from({ length: count }, (_, i) => i === 0 ? 'Portrait photo. '.repeat(60) : `Photo ${i + 1}`)
      for (let i = 0; i < count; i++) await page.getByLabel(`Description of image ${i + 1}`).fill(alts[i]!)
      await expectNoHorizontalScroll(page.locator('#compose'))
      const submit = page.getByRole('button', { name: 'Post', exact: true })
      await expect(submit).toBeEnabled({ timeout: 45_000 })
      await submit.click()

      const article = page.locator('article', { hasText: text }).first()
      await expect(article).toBeVisible()
      const id = (await article.getAttribute('id'))!.replace('post-', '')
      const grid = article.locator('.post-images')
      await grid.scrollIntoViewIfNeeded()
      await expect(grid.locator('.post-image')).toHaveCount(count)
      const bounds = (await grid.boundingBox())!
      expect(Math.abs(bounds.width / bounds.height - 16 / 9)).toBeLessThan(0.05)
      for (const tile of await grid.locator('.post-image').all()) {
        const box = (await tile.boundingBox())!
        expect(box.width).toBeGreaterThan(20)
        expect(box.height).toBeGreaterThan(20)
        expect(box.x).toBeGreaterThanOrEqual(bounds.x)
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
        expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1)
      }
      await expectNoHorizontalScroll(grid)

      // The feed used to override these buttons' positions and scroll the dialog.
      await grid.getByRole('link').first().click()
      const viewer = page.getByRole('dialog')
      await expect(viewer).toHaveAccessibleName(`Image 1 of ${count}`)
      for (const label of ['Close', 'Previous image', 'Next image']) {
        await expectOnScreen(viewer.getByRole('button', { name: label, exact: true }))
      }
      await expect.poll(() => viewer.evaluate((node) => node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth)).toBe(true)
      await expectOnScreen(viewer.getByRole('img', { name: alts[0], exact: true }))
      await viewer.getByRole('button', { name: 'Previous image' }).click()
      await expect(viewer).toHaveAccessibleName(`Image ${count} of ${count}`)
      await viewer.getByRole('button', { name: 'Next image' }).click()
      await expect(viewer).toHaveAccessibleName(`Image 1 of ${count}`)

      const stage = (await viewer.locator('.image-viewer-stage').boundingBox())!
      const x = stage.x + stage.width / 2
      const y = stage.y + stage.height / 2
      await page.mouse.move(x + 80, y)
      await page.mouse.down()
      await page.mouse.move(x - 80, y, { steps: 10 })
      await page.mouse.up()
      await expect(viewer).toHaveAccessibleName(`Image 2 of ${count}`)
      await page.keyboard.press('ArrowLeft')
      await expect(viewer).toHaveAccessibleName(`Image 1 of ${count}`)
      await viewer.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(viewer).toBeHidden()

      // The same images also work on the focused post, outside the feed layout.
      await page.goto(`/p/${id}`)
      await page.getByRole('link', { name: new RegExp(`^View image ${count} of ${count}`) }).click()
      await expect(page.getByRole('dialog')).toHaveAccessibleName(`Image ${count} of ${count}`)
      await expectOnScreen(page.getByRole('button', { name: 'Close', exact: true }))
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()

      if (count === 4) {
        await page.locator(`#post-${id}`).getByLabel('Repost or quote (0 reposts)', { exact: true }).click()
        await page.getByRole('link', { name: 'Quote', exact: true }).click()
        const preview = page.locator('#compose .quoted-post')
        await expectQuoteFrame(preview)
        await expect(preview.locator('.quoted-post-images img')).toHaveCount(4)
        const frame = (await preview.locator('.quoted-post-images').boundingBox())!
        for (const image of await preview.locator('.quoted-post-images img').all()) {
          const tile = (await image.boundingBox())!
          expect(tile.width).toBeGreaterThan(20)
          expect(tile.x + tile.width).toBeLessThanOrEqual(frame.x + frame.width + 1)
          expect(tile.y + tile.height).toBeLessThanOrEqual(frame.y + frame.height + 1)
        }
        await page.getByRole('textbox', { name: 'New post' }).fill(`Four photos quoted by ${handle}`)
        await page.getByRole('button', { name: 'Post', exact: true }).click()
        await page.waitForURL(/\/p\/[0-9a-f-]+$/)
        await expectQuoteFrame(page.locator('article.is-focused .quoted-post'))
        await expect(page.locator('article.is-focused .quoted-post-images img')).toHaveCount(4)
      }
    } finally {
      await context.close()
    }
  })
}
