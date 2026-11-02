import { expect, test } from '@playwright/test'
import { newMember, post } from '../lib/members.ts'

test('a mention links to the member and tells them, and the notification leads back to the post', async ({ browser }) => {
  const author = await newMember(browser, 'mentioner')
  const named = await newMember(browser, 'named')

  // A handle nobody has stays plain text; the author's own is a link but tells nobody.
  const nobody = `zz${Date.now().toString(36)}`
  const text = `Suya tonight? @${named.handle} knows the spot, @${nobody} does not. Signed, @${author.handle}`
  const card = await post(author.page, text)
  await expect(card.getByRole('link', { name: `@${named.handle}`, exact: true })).toHaveAttribute('href', `/u/${named.handle}`)
  await expect(card.getByRole('link', { name: `@${nobody}` })).toHaveCount(0)
  await expect(card.locator('.post-mention')).toHaveCount(2)

  // The text around a mention still opens the post, as on any card.
  await card.getByText('Suya tonight?').click({ position: { x: 4, y: 4 } })
  await author.page.waitForURL(/\/p\/[0-9a-f-]+$/)
  const postPath = new URL(author.page.url()).pathname

  // The member mentioned hears about it, and the notification opens the post.
  await named.page.goto('/notifications')
  const row = named.page.locator('.notification-row', { hasText: `@${author.handle} mentioned you` })
  await expect(row).toBeVisible()
  await expect(row).toContainText(text)
  await row.click()
  await named.page.waitForURL((url) => url.pathname === postPath)

  // On the post itself the mention leads to their profile.
  const focused = named.page.locator('article', { hasText: text })
  await focused.getByRole('link', { name: `@${named.handle}`, exact: true }).click()
  await named.page.waitForURL((url) => url.pathname === `/u/${named.handle}`)
  await expect(named.page.getByRole('heading', { level: 1 })).toBeVisible()

  // Nobody is told they mentioned themselves.
  await author.page.goto('/notifications')
  await expect(author.page.getByText('mentioned you')).toHaveCount(0)

  await author.context.close()
  await named.context.close()
})

test('typing @ and part of a handle offers members to mention, and picking one fills it in', async ({ browser }) => {
  const author = await newMember(browser, 'suggester')
  const named = await newMember(browser, 'suggested')

  await author.page.goto('/')
  const box = author.page.getByRole('textbox', { name: 'New post' })
  await box.click()

  // A bare @ offers nothing yet.
  await box.pressSequentially('Ask @')
  const list = author.page.getByRole('listbox', { name: 'Members to mention' })
  await expect(list).toHaveCount(0)

  // The rest of the handle narrows it to the member, picked with the keyboard.
  await box.pressSequentially(named.handle)
  await expect(list.getByRole('option', { name: `@${named.handle}` })).toBeVisible()
  await box.press('Enter')
  await expect(box).toHaveValue(`Ask @${named.handle} `)
  await expect(list).toHaveCount(0)

  // Escape closes the list without changing the text.
  await box.pressSequentially(`and @${named.handle.slice(0, 6)}`)
  await expect(list).toBeVisible()
  await box.press('Escape')
  await expect(list).toHaveCount(0)

  // Clicking a member fills them in and leaves the caret in the box.
  await box.fill('Ask ')
  await box.pressSequentially(`@${named.handle}`)
  await list.getByRole('option', { name: `@${named.handle}` }).click()
  await expect(box).toHaveValue(`Ask @${named.handle} `)
  await expect(box).toBeFocused()
  await box.pressSequentially('about suya')

  await author.page.getByRole('button', { name: 'Post', exact: true }).click()
  const card = author.page.locator('article', { hasText: 'about suya' }).first()
  await expect(card.getByRole('link', { name: `@${named.handle}`, exact: true })).toHaveAttribute('href', `/u/${named.handle}`)

  await author.context.close()
  await named.context.close()
})
