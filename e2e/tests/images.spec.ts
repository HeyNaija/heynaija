import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'
import { png } from '../lib/png.ts'

test('posts an image with a description and opens it full screen', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'snapper')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  const text = `Sunset in Lekki, from ${handle}`
  await box.fill(text)

  // The image button opens a hidden file input; set the file on it directly.
  await page.locator('#compose input[type="file"]').setInputFiles({
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

  await article.getByRole('link', { name: new RegExp(`^View image 1 of 1: ${alt}`) }).click()
  const viewer = page.getByRole('dialog', { name: 'Image' })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByRole('img', { name: alt })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()
  await context.close()
})
