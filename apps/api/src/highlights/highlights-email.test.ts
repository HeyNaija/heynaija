import assert from 'node:assert/strict'
import { test } from 'node:test'
import { excerpt } from '../notifications/notifications.service.js'
import { activityLine, type Highlight, highlightsPush, reasonLine, renderHighlights } from './highlights-email.js'

const webUrl = 'https://heynaija.test'
const unsubscribeUrl = `${webUrl}/api/v1/highlights/unsubscribe/TOKEN`
const render = (highlights: Highlight[]) => renderHighlights({ handle: 'kemi', highlights, webUrl, unsubscribeUrl })

const highlight = (over: Partial<Highlight> = {}): Highlight => ({
  postId: 'p1',
  author: 'ada',
  community: null,
  excerpt: 'Third Mainland Bridge closes this weekend',
  reason: { kind: 'active' },
  people: 0,
  likes: 0,
  ...over,
})

test('the subject counts the conversations and never quotes a post', () => {
  const mail = render([highlight(), highlight({ postId: 'p2', author: 'bayo', excerpt: 'Jollof wars' })])
  assert.equal(mail.subject, '2 conversations you missed on HeyNaija')
  assert.equal(render([highlight()]).subject, '1 conversation you missed on HeyNaija')
  assert.ok(!mail.subject.includes('Jollof') && !mail.subject.includes('Bridge'))
})

test('each conversation says who started it and where, how it begins, why it was chosen, and links to it', () => {
  const mail = render([
    highlight({ community: 'Lagos', reason: { kind: 'community' }, people: 4, likes: 12 }),
    highlight({ postId: 'p2', author: 'bayo', excerpt: 'Jollof wars', reason: { kind: 'following' }, likes: 1 }),
  ])
  assert.match(
    mail.text,
    /@ada in Lagos\n {2}“Third Mainland Bridge closes this weekend”\n {2}From Lagos, which you joined · 4 people in the conversation · 12 likes\n {2}https:\/\/heynaija\.test\/p\/p1\n/,
  )
  assert.match(mail.text, /@bayo\n {2}“Jollof wars”\n {2}You follow @bayo · 1 like\n {2}https:\/\/heynaija\.test\/p\/p2\n/)
  assert.ok(mail.html.includes('href="https://heynaija.test/p/p1"'))
  assert.ok(mail.html.includes('From Lagos, which you joined · 4 people in the conversation · 12 likes'))
})

test('the reasons are Discover’s words', () => {
  assert.equal(reasonLine(highlight({ reason: { kind: 'network', handle: 'bayo', action: 'replied', others: 0 } })), '@bayo, who you follow, replied')
  assert.equal(
    reasonLine(highlight({ reason: { kind: 'network', handle: 'bayo', action: 'quoted', others: 2 } })),
    '@bayo, who you follow, quoted, and 2 others you follow joined in',
  )
  assert.equal(reasonLine(highlight({ reason: { kind: 'network', handle: 'bayo', action: 'reposted', others: 1 } })), '@bayo, who you follow, reposted, and 1 other you follow joined in')
  assert.equal(reasonLine(highlight({ reason: { kind: 'following' } })), 'You follow @ada')
  assert.equal(reasonLine(highlight({ reason: { kind: 'community' }, community: 'Tech & Careers' })), 'From Tech & Careers, which you joined')
  assert.equal(reasonLine(highlight()), 'Active on HeyNaija')
})

test('activity is the counts anyone can see, and says nothing when there is none', () => {
  assert.equal(activityLine(highlight({ people: 1, likes: 1 })), '1 person in the conversation · 1 like')
  assert.equal(activityLine(highlight({ people: 3 })), '3 people in the conversation')
  assert.equal(activityLine(highlight({ likes: 7 })), '7 likes')
  assert.equal(activityLine(highlight()), '')
  // With no activity the line is the reason alone, with no stray separator.
  assert.match(render([highlight({ reason: { kind: 'following' } })]).text, / {2}You follow @ada\n/)
})

test('a post with only pictures or a video is described, not quoted as empty', () => {
  const mail = render([highlight({ excerpt: '' })])
  assert.match(mail.text, /@ada\n {2}A post with pictures or a video\n/)
  assert.ok(!mail.text.includes('“”') && !mail.html.includes('“”'))
})

test('the footer says why it came, how they are chosen, and how to stop them with one click', () => {
  const mail = render([highlight()])
  assert.match(mail.text, /You are getting this because weekly highlights are on for @kemi and you have not opened HeyNaija for a few days\. We send at most one a week\./)
  assert.ok(mail.text.includes(`How these are chosen: ${webUrl}/about/highlights`))
  assert.ok(mail.text.includes(`Choose what we send you: ${webUrl}/settings`))
  assert.ok(mail.text.includes(`Stop weekly highlights with one click: ${unsubscribeUrl}`))
  assert.ok(mail.html.includes(`href="${unsubscribeUrl}"`))
  assert.ok(mail.html.includes(`href="${webUrl}/about/highlights"`))
})

test('the preview line names who started them', () => {
  const four = [highlight(), highlight({ author: 'bayo' }), highlight({ author: 'chi' }), highlight({ author: 'dayo' })]
  assert.ok(render(four).html.includes('From @ada, @bayo and 2 others.'))
  assert.ok(render(four.slice(0, 2)).html.includes('From @ada and @bayo.'))
  assert.ok(render(four.slice(0, 1)).html.includes('From @ada.'))
})

test('what a post says cannot break out of the email', () => {
  const mail = render([highlight({ excerpt: '<script>alert(1)</script> & "quotes"', community: 'A <b>bold</b> place' })])
  assert.ok(!mail.html.includes('<script>'))
  assert.ok(mail.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'))
  assert.ok(mail.html.includes('A &lt;b&gt;bold&lt;/b&gt; place'))
})

test('no pictures and nothing that tracks an open or a click', () => {
  const mail = render([highlight(), highlight({ postId: 'p2' })])
  assert.ok(!/<img/i.test(mail.html))
  const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!)
  assert.ok(links.length > 0)
  for (const href of links) assert.ok(href.startsWith(`${webUrl}/`), href)
})

test('the push notification is the first conversation and how many more there are', () => {
  const long = 'x'.repeat(200)
  assert.deepEqual(highlightsPush([highlight(), highlight({ postId: 'p2' }), highlight({ postId: 'p3' })], excerpt), {
    title: 'While you were away on HeyNaija',
    body: '@ada: “Third Mainland Bridge closes this weekend” and 2 more conversations',
    url: '/p/p1',
    tag: 'highlights',
  })
  assert.equal(highlightsPush([highlight(), highlight({ postId: 'p2' })], excerpt)!.body, '@ada: “Third Mainland Bridge closes this weekend” and 1 more conversation')
  assert.equal(highlightsPush([highlight({ excerpt: '' }), highlight({ postId: 'p2' })], excerpt)!.body, '@ada posted and 1 more conversation')
  assert.ok(highlightsPush([highlight({ excerpt: long })], excerpt)!.body.length < 100)
  assert.equal(highlightsPush([], excerpt), null)
})
