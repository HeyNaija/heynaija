import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

const documents = [
  { path: '/rules', heading: 'HeyNaija rules' },
  { path: '/privacy', heading: 'Privacy policy' },
  { path: '/charter', heading: 'HeyNaija charter' },
  { path: '/licence', heading: 'Licence' },
]

test('the governance documents are public and say they are drafts @mobile', async ({ page }) => {
  for (const doc of documents) {
    await page.goto(doc.path)
    await expect(page.getByRole('heading', { level: 1, name: doc.heading })).toBeVisible()
    await expect(page.getByRole('note')).toContainText('has not been reviewed by a lawyer')
  }
  // The governance page lists all four.
  await page.goto('/governance')
  const list = page.locator('#documents')
  for (const name of ['Charter', 'Rules', 'Privacy policy', 'Licence']) {
    await expect(list.getByRole('link', { name, exact: true })).toBeVisible()
  }
})

test('a member downloads their data as JSON', async ({ browser }) => {
  const { page, handle, email, context } = await newMember(browser, 'exporter')
  const text = `Mine to keep, by ${handle}`
  await post(page, text)

  await page.goto('/settings')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download your data' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(new RegExp(`^heynaija-${handle}-\\d{4}-\\d{2}-\\d{2}\\.json$`))
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(data.format).toBe('heynaija-export/1')
  expect(data.account).toMatchObject({ handle, email })
  expect(data.posts.map((p: { text: string }) => p.text)).toContain(text)
  await context.close()
})
