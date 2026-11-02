import { expect, test } from '@playwright/test'
import { grantModerator } from '../lib/cli.ts'
import { createCommunity } from '../lib/db.ts'
import { newMember } from '../lib/members.ts'
import { png } from '../lib/png.ts'

/** A community only this test knows about, so no real community's photo changes. */
async function newCommunity(label: string) {
  const slug = `e2e-${label}-${Date.now().toString(36)}`
  const name = `E2E ${label} ${slug.slice(-6)}`
  await createCommunity(slug, name)
  return { slug, name }
}

test('a community moderator adds a photo that everyone sees, then removes it', async ({ browser }) => {
  const { slug, name } = await newCommunity('photo')
  const mod = await newMember(browser, 'cmod')
  grantModerator(mod.handle, slug)
  const visitor = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const guest = await visitor.newPage()

  // With no photo it shows the subject icon, not an image.
  await guest.goto(`/c/${slug}`)
  const header = guest.locator('.community-header .community-mark')
  await expect(header).toBeVisible()
  await expect(header.locator('img')).toHaveCount(0)
  // Visitors are offered no way to change it.
  await expect(guest.getByRole('button', { name: /community photo/i })).toHaveCount(0)

  await mod.page.goto(`/c/${slug}`)
  // The control is disabled until the page has hydrated; a file chosen before then goes nowhere.
  await expect(mod.page.getByRole('button', { name: 'Add a community photo' })).toBeEnabled()
  await mod.page.getByLabel('Community photo').setInputFiles({ name: 'lagos.png', mimeType: 'image/png', buffer: png(600, 400) })
  const photo = mod.page.locator('.community-header .community-mark img')
  await expect(photo).toBeVisible({ timeout: 30_000 })
  await expect(mod.page.getByRole('button', { name: 'Change community photo' })).toBeVisible()

  // Anyone sees it, and it is a small processed square from our own media path.
  await guest.reload()
  const shown = guest.locator('.community-header .community-mark img')
  await expect(shown).toHaveAttribute('src', /^\/media\/community-photos\/[0-9a-f-]+\/256\.webp$/)
  // The browser picks the 96px or 256px file for the screen, and whichever it loaded is a
  // square of that size. The srcset scales naturalWidth to the 52px tile, so the file is
  // measured on its own.
  await expect.poll(() => shown.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBeGreaterThan(0)
  const file = await shown.evaluate(async (img: HTMLImageElement) => {
    const alone = new Image()
    alone.src = img.currentSrc
    await alone.decode()
    return [img.currentSrc.split('/').pop(), alone.naturalWidth, alone.naturalHeight]
  })
  expect([['96.webp', 96, 96], ['256.webp', 256, 256]]).toContainEqual(file)
  await guest.goto('/c')
  await expect(guest.locator('li.community-card', { hasText: name }).locator('.community-mark img')).toHaveAttribute('src', /^\/media\/community-photos\/[0-9a-f-]+\/256\.webp$/)

  // Removing it brings the icon back.
  await mod.page.getByRole('button', { name: 'Remove photo' }).click()
  await expect(mod.page.locator('.community-header .community-mark img')).toHaveCount(0)
  await expect(mod.page.getByRole('button', { name: 'Add a community photo' })).toBeVisible()

  await visitor.close()
  await mod.context.close()
})

test('only that community\'s moderators can change its photo', async ({ browser }) => {
  const { slug } = await newCommunity('perm')
  const other = await newCommunity('other')
  const member = await newMember(browser, 'plain')
  const elsewhere = await newMember(browser, 'elsewhere')
  grantModerator(elsewhere.handle, other.slug)

  for (const who of [member, elsewhere]) {
    await who.page.goto(`/c/${slug}`)
    await expect(who.page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(who.page.getByLabel('Community photo')).toHaveCount(0)
    await expect(who.page.getByRole('button', { name: /community photo/i })).toHaveCount(0)

    // Nor does going round the page work.
    const res = await who.page.request.post(`/api/v1/communities/${slug}/photo/upload`, {
      data: { contentType: 'image/png', bytes: 1000 },
    })
    expect(res.status()).toBe(403)
    const del = await who.page.request.delete(`/api/v1/communities/${slug}/photo`)
    expect(del.status()).toBe(403)
  }
  await Promise.all([member, elsewhere].map((m) => m.context.close()))
})
