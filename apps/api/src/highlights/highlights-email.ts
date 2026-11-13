import { button, COLOR, emailFrame, escapeHtml, link, paragraph } from '../email/layout.js'
import type { PushMessage } from '../push/push-sender.js'

/**
 * Why a conversation is among a member's highlights: the first of these that is
 * true, in Discover's words (ADR 0014). 'network' names the person they follow
 * who replied, quoted or reposted last.
 */
export type HighlightReason =
  | { kind: 'network'; handle: string; action: 'replied' | 'quoted' | 'reposted'; others: number }
  | { kind: 'following' }
  | { kind: 'community' }
  | { kind: 'active' }

/** One conversation in a member's highlights. Everything here is public: what anyone signed in can see on the post. */
export type Highlight = {
  postId: string
  /** The author's handle. */
  author: string
  /** The community it was posted in, by name. */
  community: string | null
  /** The start of the post, or empty for a post that is only pictures or a video. */
  excerpt: string
  reason: HighlightReason
  /** Different members, other than the author, who replied anywhere in it or quoted it. */
  people: number
  /** The public like count. Who liked it is not public, and is never used. */
  likes: number
}

export type HighlightsEmail = { subject: string; text: string; html: string }

/** Longest piece of a post the email shows, in characters. Longer than a notification's: these posts are public and are the whole point. */
export const HIGHLIGHT_EXCERPT_MAX = 140
/** And the push notification, which a lock screen cuts short anyway. */
export const PUSH_EXCERPT_MAX = 80

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "@ada", "@ada and @bayo", "@ada, @bayo and 2 others". */
const names = (handles: string[]): string => {
  const shown = handles.slice(0, 2).map((h) => `@${h}`)
  const rest = handles.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${count(rest, 'other', 'others')}`
  return shown.join(' and ')
}

/** The line that says why a conversation was chosen. */
export function reasonLine(highlight: Highlight): string {
  const { reason } = highlight
  switch (reason.kind) {
    case 'network':
      return `@${reason.handle}, who you follow, ${reason.action}${reason.others ? `, and ${count(reason.others, 'other', 'others')} you follow joined in` : ''}`
    case 'following':
      return `You follow @${highlight.author}`
    case 'community':
      return `From ${highlight.community ?? 'a community'}, which you joined`
    case 'active':
      return 'Active on HeyNaija'
  }
}

/** How much went on in it, from the counts on the post: "4 people in the conversation · 12 likes". Empty when nothing has yet. */
export function activityLine(highlight: Highlight): string {
  return [
    highlight.people ? `${count(highlight.people, 'person', 'people')} in the conversation` : '',
    highlight.likes ? count(highlight.likes, 'like', 'likes') : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

const byline = (highlight: Highlight) => `@${highlight.author}${highlight.community ? ` in ${highlight.community}` : ''}`
const NO_WORDS = 'A post with pictures or a video'

/**
 * The weekly highlights email (ADR 0027): a few conversations from the week,
 * each with who started it, how it begins, why it was chosen and how much went
 * on in it. The subject never quotes a post, as in every HeyNaija email (ADR 0009).
 * No pictures, no tracking of opens or clicks: the links are plain links.
 */
export function renderHighlights(input: {
  handle: string
  highlights: Highlight[]
  webUrl: string
  unsubscribeUrl: string
}): HighlightsEmail {
  const { handle, highlights, webUrl, unsubscribeUrl } = input
  const subject = `${count(highlights.length, 'conversation', 'conversations')} you missed on HeyNaija`
  const authors = [...new Set(highlights.map((h) => h.author))]
  const preheader = `From ${names(authors)}.`
  const settingsUrl = `${webUrl}/settings`
  const rulesUrl = `${webUrl}/about/highlights`
  const why = `You are getting this because weekly highlights are on for @${handle} and you have not opened HeyNaija for a few days. We send at most one a week.`
  const href = (h: Highlight) => `${webUrl}/p/${h.postId}`
  const notes = (h: Highlight) => [reasonLine(h), activityLine(h)].filter(Boolean).join(' · ')

  const text = [
    `Here is what people talked about while you were away, @${handle}.`,
    '',
    ...highlights.flatMap((h) => [byline(h), `  ${h.excerpt ? `“${h.excerpt}”` : NO_WORDS}`, `  ${notes(h)}`, `  ${href(h)}`, '']),
    `Open HeyNaija: ${webUrl}/`,
    '',
    '--',
    why,
    `How these are chosen: ${rulesUrl}`,
    `Choose what we send you: ${settingsUrl}`,
    `Stop weekly highlights with one click: ${unsubscribeUrl}`,
    '',
  ].join('\n')

  const rows = highlights
    .map(
      (h, i) => `
      <tr><td${i < highlights.length - 1 ? ` class="hn-rule" style="padding:14px 0;border-bottom:1px solid ${COLOR.hairline}"` : ' style="padding:14px 0 0"'}>
        <a class="hn-link" href="${escapeHtml(href(h))}" style="color:${COLOR.greenDeep};font-weight:600;text-decoration:none">${escapeHtml(byline(h))}</a><br>
        <a class="hn-ink" href="${escapeHtml(href(h))}" style="color:${COLOR.ink};text-decoration:none">${escapeHtml(h.excerpt ? `“${h.excerpt}”` : NO_WORDS)}</a><br>
        <span class="hn-muted" style="color:${COLOR.muted};font-size:13px">${escapeHtml(notes(h))}</span>
      </td></tr>`,
    )
    .join('')
  const body = [
    paragraph(`Here is what people talked about while you were away, @${escapeHtml(handle)}.`, 'font-size:17px;font-weight:600'),
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-top:1px solid ${COLOR.hairline}" class="hn-rule">${rows}
      </table>`,
    button('Open HeyNaija', `${webUrl}/`),
  ].join('\n')
  const footer = `${escapeHtml(why)} ${link('How these are chosen', rulesUrl)}. ${link('Choose what we send you', settingsUrl)}, or ${link('stop weekly highlights with one click', unsubscribeUrl)}.`
  return { subject, text, html: emailFrame({ title: subject, preheader, body, footer }) }
}

/**
 * The same highlights as one push notification: the first conversation, and how
 * many more there are. Tapping it opens that conversation.
 */
export function highlightsPush(highlights: Highlight[], cut: (text: string, max: number) => string): PushMessage | null {
  const [first, ...rest] = highlights
  if (!first) return null
  const start = first.excerpt ? `@${first.author}: “${cut(first.excerpt, PUSH_EXCERPT_MAX)}”` : `@${first.author} posted`
  return {
    title: 'While you were away on HeyNaija',
    body: rest.length ? `${start} and ${count(rest.length, 'more conversation', 'more conversations')}` : start,
    url: `/p/${first.postId}`,
    tag: 'highlights',
  }
}
