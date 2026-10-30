import { expect, test } from '@playwright/test'
import { newMember } from '../lib/members.ts'
import { png } from '../lib/png.ts'

test('a member saving data gets placeholders for pictures and loads one by tapping @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'saver')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  const text = `Danfo at dusk, from ${handle}`
  await box.fill(text)
  await page.locator('#compose input[type="file"]').setInputFiles({ name: 'danfo.png', mimeType: 'image/png', buffer: png() })
  const alt = 'A yellow bus, in two greens'
  await page.getByLabel('Description of image 1').fill(alt)
  const submit = page.getByRole('button', { name: 'Post', exact: true })
  await expect(submit).toBeEnabled({ timeout: 45_000 })
  await submit.click()
  await expect(page.locator('article', { hasText: text }).getByRole('img', { name: alt })).toBeVisible({ timeout: 30_000 })

  // By default (no choice, no Save-Data hint) pictures load.
  await page.goto('/settings')
  const dataUse = page.getByRole('group', { name: 'Data use' })
  await expect(dataUse.getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true')

  // Choosing Save data is remembered across a reload.
  await dataUse.getByRole('button', { name: 'Save data' }).click()
  await expect(dataUse.getByRole('button', { name: 'Save data' })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(dataUse.getByRole('button', { name: 'Save data' })).toHaveAttribute('aria-pressed', 'true')

  // The profile (a feed of this member's posts) holds the picture back: no request for it, a placeholder in its place.
  const requested: string[] = []
  page.on('request', (request) => {
    if (/\/(640|1600|still)\.webp$/.test(request.url())) requested.push(request.url())
  })
  await page.goto(`/u/${handle}`)
  const article = page.locator('article', { hasText: text }).first()
  const held = article.getByRole('link', { name: new RegExp(`^Load image 1 of 1: ${alt}`) })
  await expect(held).toBeVisible({ timeout: 30_000 })
  await expect(article.getByRole('img', { name: alt })).toHaveCount(0)
  expect(requested).toEqual([])

  // Tapping loads that one picture, the small version.
  await held.click()
  const picture = article.getByRole('img', { name: alt })
  await expect(picture).toBeVisible()
  await expect(picture).toHaveAttribute('src', /\/640\.webp$/)
  await expect(picture).not.toHaveAttribute('srcset', /.+/)

  // Without JavaScript the page itself carries no picture, only the placeholder link to the small version.
  const html = await (await page.request.get(`/u/${handle}`)).text()
  expect(html).toContain('Tap to load image')
  expect(html).not.toMatch(/<img[^>]+\.webp/)

  await context.close()
})

test('the browser Save-Data hint is the default until the member chooses @mobile', async ({ browser }) => {
  const { page, handle, context } = await newMember(browser, 'hinted')
  await page.goto('/')
  const box = page.getByRole('textbox', { name: 'New post' })
  await box.click()
  const text = `Okada ride, from ${handle}`
  await box.fill(text)
  await page.locator('#compose input[type="file"]').setInputFiles({ name: 'okada.png', mimeType: 'image/png', buffer: png() })
  const submit = page.getByRole('button', { name: 'Post', exact: true })
  await expect(submit).toBeEnabled({ timeout: 45_000 })
  await submit.click()
  await expect(page.locator('article', { hasText: text }).locator('img[src$="640.webp"]')).toBeVisible({ timeout: 30_000 })
  const state = await context.storageState()
  await context.close()

  const hinted = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    storageState: state,
    extraHTTPHeaders: { 'Save-Data': 'on' },
  })
  const phone = await hinted.newPage()
  await phone.goto(`/u/${handle}`)
  const article = phone.locator('article', { hasText: text }).first()
  await expect(article.getByRole('link', { name: /^Load image 1 of 1/ })).toBeVisible({ timeout: 30_000 })
  await expect(article.locator('img[src$=".webp"]')).toHaveCount(0)

  // An explicit "Always load" beats the hint.
  await phone.goto('/settings')
  await phone.getByRole('group', { name: 'Data use' }).getByRole('button', { name: 'Always load' }).click()
  await phone.goto(`/u/${handle}`)
  await expect(phone.locator('article', { hasText: text }).locator('img[src$="640.webp"]')).toBeVisible({ timeout: 30_000 })
  await hinted.close()
})
