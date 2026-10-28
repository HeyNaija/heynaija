import { ideaHeadline } from '../ideas/status-words.js'
import type { NotificationKind } from '../notifications/notifications.service.js'

/** What the email says about one notification. Moderation notices carry no post text at all. */
export type DigestItem = {
  kind: NotificationKind
  /** Handle of whoever did it; null for moderation notices. */
  actor: string | null
  postId: string | null
  /** A short piece of the post concerned, only for the kinds that show one. */
  excerpt: string | null
  /** moderator_granted / moderator_revoked: the community's name. */
  community: string | null
  /** idea_status: the new status, whether it was an idea or a problem, and whether the recipient sent it. */
  idea?: { status: string | null; kind: string; yours: boolean } | null
}

export type Digest = { subject: string; text: string; html: string }

/** The kinds whose email shows a piece of a post. Moderation notices never do. */
export const KINDS_WITH_EXCERPT: readonly NotificationKind[] = ['reply', 'like', 'repost', 'quote', 'mention', 'idea_status']

/** Longest piece of a post an email shows, in characters. */
export const EXCERPT_MAX = 80
/** Most entries an email lists; the rest are counted and left to the app. */
export const LINES_MAX = 8

/** One line of an email, or one push notification: `items` are the notifications it stands for, newest first. */
export type Line<T extends DigestItem = DigestItem> = { headline: string; quote: string | null; href: string; items: T[] }

/** "@a", "@a and @b", "@a, @b and 1 other", "@a, @b and 3 others". */
const names = (handles: string[]): string => {
  const shown = handles.slice(0, 2).map((h) => `@${h}`)
  const rest = handles.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`
  return shown.join(' and ')
}

/**
 * One line for each thing that happened: likes of the same post, reposts of the
 * same post and follows are rolled into one, so a burst of thirty likes is a
 * single line. Newest first. Links start with `webUrl`; an empty one makes them
 * paths on the site.
 */
export function linesFor<T extends DigestItem>(items: T[], webUrl: string): Line<T>[] {
  type Group = { items: T[]; actors: string[] }
  const keyOf = (item: DigestItem, i: number): string => {
    switch (item.kind) {
      case 'like':
      case 'repost':
      case 'idea_status':
        return `${item.kind}:${item.postId}`
      case 'follow':
        return 'follow'
      case 'reply':
      case 'quote':
      case 'mention':
        return `${item.kind}:${i}`
      case 'moderator_granted':
      case 'moderator_revoked':
        return `${item.kind}:${item.community}`
      default:
        // The other moderation notices: one line for all of a kind.
        return item.kind
    }
  }
  const groups = new Map<string, Group>()
  items.forEach((item, i) => {
    const key = keyOf(item, i)
    const group = groups.get(key) ?? { items: [], actors: [] }
    if (item.actor && !group.actors.includes(item.actor)) group.actors.push(item.actor)
    group.items.push(item)
    groups.set(key, group)
  })

  const post = (id: string | null) => (id ? `${webUrl}/p/${id}` : `${webUrl}/notifications`)
  return [...groups.values()].map(({ items, actors }) => ({ ...describe(items[0]!, actors, items.length), items }))

  function describe(item: DigestItem, actors: string[], count: number): Omit<Line, 'items'> {
    const who = names(actors)
    const quote = KINDS_WITH_EXCERPT.includes(item.kind) && item.excerpt ? item.excerpt : null
    const inApp = `${webUrl}/notifications`
    const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
    switch (item.kind) {
      case 'reply':
        return { headline: `${who} replied to your post`, quote, href: post(item.postId) }
      case 'quote':
        return { headline: `${who} quoted your post`, quote, href: post(item.postId) }
      case 'mention':
        return { headline: `${who} mentioned you`, quote, href: post(item.postId) }
      case 'like':
        return { headline: `${who} liked your post`, quote, href: post(item.postId) }
      case 'repost':
        return { headline: `${who} reposted your post`, quote, href: post(item.postId) }
      case 'follow':
        return { headline: `${who} followed you`, quote: null, href: actors.length === 1 ? `${webUrl}/u/${actors[0]}` : inApp }
      case 'post_removed':
        return { headline: `A moderator removed ${plural(count, 'one of your posts', `${count} of your posts`)}`, quote: null, href: inApp }
      case 'post_restored':
        return { headline: `A moderator restored ${plural(count, 'one of your posts', `${count} of your posts`)}`, quote: null, href: inApp }
      case 'report_resolved':
        return { headline: `A moderator reviewed ${plural(count, 'a report', `${count} reports`)} you made`, quote: null, href: inApp }
      case 'account_reinstated':
        return { headline: 'Your account has been reinstated', quote: null, href: inApp }
      case 'avatar_removed':
        return { headline: 'A moderator removed your profile photo', quote: null, href: `${webUrl}/settings` }
      case 'profile_cleared':
        return { headline: 'A moderator cleared your name and bio', quote: null, href: `${webUrl}/settings` }
      case 'moderator_granted':
        return { headline: `You are now a moderator of ${item.community ?? 'a community'}`, quote: null, href: inApp }
      case 'moderator_revoked':
        return { headline: `You are no longer a moderator of ${item.community ?? 'a community'}`, quote: null, href: inApp }
      case 'idea_status':
        // Newest first, so this is the latest status.
        return { headline: ideaHeadline(item.idea ?? { kind: 'idea', yours: false }, item.idea?.status ?? null), quote, href: post(item.postId) }
    }
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * The email for a member's waiting notifications, newest first. Written to be
 * read in a notification on a lock screen or in an inbox other people may see:
 * the subject never quotes a post, posts are quoted briefly and only where the
 * member can already see them (the caller leaves out anything blocked or taken
 * down), and a moderator's decision is stated plainly, with no post text and no
 * reason. The details are in the app.
 */
export function renderDigest(input: {
  handle: string
  items: DigestItem[]
  /** How many notifications there are in all, when `items` is only the newest of them. */
  total?: number
  webUrl: string
  unsubscribeUrl: string
}): Digest {
  const { handle, items, webUrl, unsubscribeUrl } = input
  const total = Math.max(input.total ?? items.length, items.length)
  const lines = linesFor(items, webUrl)
  const shown = lines.slice(0, LINES_MAX)
  // What is not listed, counted in notifications rather than lines.
  const hidden = total - shown.reduce((sum, line) => sum + line.items.length, 0)
  const more = hidden > 0

  const subject = total === 1 && lines[0] ? lines[0].headline : `${total} new notifications on HeyNaija`
  const settingsUrl = `${webUrl}/settings`
  const notificationsUrl = `${webUrl}/notifications`
  const why = `You are getting this because email notifications are on for @${handle} on HeyNaija.`

  const text = [
    `Here is what happened on HeyNaija, @${handle}.`,
    '',
    ...shown.flatMap((line) => [line.headline, ...(line.quote ? [`  “${line.quote}”`] : []), `  ${line.href}`, '']),
    ...(more ? [`...and ${hidden} more. See everything: ${notificationsUrl}`, ''] : []),
    '--',
    why,
    `Choose what we email you: ${settingsUrl}`,
    `Stop these emails with one click: ${unsubscribeUrl}`,
    'You will still see your notifications in HeyNaija.',
    '',
  ].join('\n')

  const rows = shown
    .map(
      (line) => `
      <tr><td style="padding:12px 0;border-bottom:1px solid #dfe7e2">
        <a href="${escapeHtml(line.href)}" style="color:#176541;font-weight:600;text-decoration:none">${escapeHtml(line.headline)}</a>${
          line.quote ? `<br><span style="color:#44565f">“${escapeHtml(line.quote)}”</span>` : ''
        }
      </td></tr>`,
    )
    .join('')
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f1f4f2">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#10212b">
    <div style="background:#ffffff;border-radius:12px;padding:24px">
      <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#176541">HeyNaija</p>
      <p style="margin:0 0 8px">Here is what happened, @${escapeHtml(handle)}.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}
      </table>${
        more
          ? `
      <p style="margin:12px 0 0;color:#44565f">...and ${hidden} more.</p>`
          : ''
      }
      <p style="margin:20px 0 0"><a href="${escapeHtml(notificationsUrl)}" style="display:inline-block;background:#258153;color:#ffffff;padding:12px 18px;border-radius:8px;font-weight:600;text-decoration:none">Open your notifications</a></p>
    </div>
    <p style="margin:16px 4px 0;font-size:13px;line-height:1.5;color:#44565f">${escapeHtml(why)}
      <a href="${escapeHtml(settingsUrl)}" style="color:#176541">Choose what we email you</a>, or
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#176541">stop these emails with one click</a>.
      You will still see your notifications in HeyNaija.</p>
  </div>
</body>
</html>
`
  return { subject, text, html }
}
