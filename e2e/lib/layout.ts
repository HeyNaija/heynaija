import { expect, type Locator } from '@playwright/test'

/** Assert the whole control can be seen and its centre can actually be tapped. */
export async function expectOnScreen(control: Locator) {
  await expect(control).toBeVisible()
  await expect.poll(() => control.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return rect.left >= 0 && rect.top >= 0 && rect.right <= document.documentElement.clientWidth + 1
      && rect.bottom <= window.innerHeight + 1 && !!hit && node.contains(hit)
  })).toBe(true)
}

export async function expectNoHorizontalScroll(control: Locator) {
  await expect.poll(() => control.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
}

export async function expectQuoteFrame(quote: Locator) {
  await expect(quote.getByText('Quoted post', { exact: true })).toBeVisible()
  await expect.poll(() => quote.evaluate((node) => {
    const meta = node.querySelector('.quoted-post-meta')!.getBoundingClientRect()
    const text = node.querySelector('.quoted-post-text')!.getBoundingClientRect()
    const style = getComputedStyle(node)
    return Number.parseFloat(style.borderTopWidth) > 0 && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && text.top >= meta.bottom
  })).toBe(true)
  await expectNoHorizontalScroll(quote)
}
