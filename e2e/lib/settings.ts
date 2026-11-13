import type { Page } from '@playwright/test'

/**
 * Reloads Settings and waits for the form it ends on.
 *
 * A reload of Settings is two navigations, not one: the page comes back with
 * the `?flow=` it had, and once its scripts run it goes on to a fresh sign-in
 * form with a new one (apps/web/lib/auth/providers/kratos/forget-flow.tsx).
 * A test that leaves the page, or fills in a form on it, before that lands is
 * cut short (net::ERR_ABORTED), carried back to Settings, or has what it typed
 * replaced. Which one wins depends on how fast the machine is, so it shows up
 * as a test that fails now and then.
 *
 * With no `?flow=` in the address (a message was shown, so it was dropped), a
 * reload is one navigation and there is nothing more to wait for.
 *
 * Not for a page where an email change is waiting for its code: that form lives
 * in its flow, so a reload keeps the flow (provider.tsx) and this would wait for
 * a new one that never comes. Use a plain `page.reload()` there.
 */
export async function reloadSettings(page: Page): Promise<void> {
  const before = new URL(page.url()).searchParams.get('flow')
  await page.reload()
  if (before) await page.waitForURL((url) => url.searchParams.has('flow') && url.searchParams.get('flow') !== before)
}
