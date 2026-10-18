import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type DigestItem, LINES_MAX, renderDigest } from './digest.js'

const webUrl = 'https://heynaija.test'
const unsubscribeUrl = `${webUrl}/api/v1/email/unsubscribe/TOKEN`
const render = (items: DigestItem[], total?: number) =>
  renderDigest({ handle: 'ada', items, total, webUrl, unsubscribeUrl })

const item = (over: Partial<DigestItem>): DigestItem => ({ kind: 'like', actor: 'bayo', postId: 'p1', excerpt: null, community: null, ...over })

test('one notification: the subject says what happened and quotes nothing', () => {
  const mail = render([item({ kind: 'reply', excerpt: 'Jollof, obviously', postId: 'r1' })])
  assert.equal(mail.subject, '@bayo replied to your post')
  assert.match(mail.text, /@bayo replied to your post\n {2}“Jollof, obviously”\n {2}https:\/\/heynaija\.test\/p\/r1\n/)
  assert.ok(!mail.subject.includes('Jollof'))
})

test('several notifications: counted in the subject, newest first', () => {
  const mail = render([item({ kind: 'follow', actor: 'chi', postId: null }), item({ kind: 'reply', actor: 'bayo', excerpt: 'hi', postId: 'r1' })])
  assert.equal(mail.subject, '2 new notifications on HeyNaija')
  assert.ok(mail.text.indexOf('@chi followed you') < mail.text.indexOf('@bayo replied'))
  assert.match(mail.text, /@chi followed you\n {2}https:\/\/heynaija\.test\/u\/chi\n/)
})

test('thirty likes of one post are one line that names two people and counts the rest', () => {
  const likes = Array.from({ length: 30 }, (_, i) => item({ actor: `fan${i}`, excerpt: 'my post' }))
  const mail = render(likes)
  assert.equal(mail.subject, '30 new notifications on HeyNaija')
  assert.equal(mail.text.match(/liked your post/g)?.length, 1)
  assert.match(mail.text, /@fan0, @fan1 and 28 others liked your post\n {2}“my post”/)
  assert.ok(!/\.\.\.and/.test(mail.text), 'nothing was left out of the list')
})

test('likes of different posts, reposts and follows each get their own line', () => {
  const mail = render([
    item({ postId: 'p1', actor: 'a' }),
    item({ postId: 'p2', actor: 'b' }),
    item({ kind: 'repost', postId: 'p1', actor: 'c' }),
    item({ kind: 'follow', postId: null, actor: 'd' }),
    item({ kind: 'follow', postId: null, actor: 'e' }),
  ])
  assert.equal(mail.text.match(/liked your post/g)?.length, 2)
  assert.match(mail.text, /@c reposted your post/)
  assert.match(mail.text, /@d and @e followed you\n {2}https:\/\/heynaija\.test\/notifications\n/)
})

test('a long list is cut, and what was left out is counted in notifications', () => {
  const replies = Array.from({ length: 12 }, (_, i) => item({ kind: 'reply', actor: `r${i}`, postId: `p${i}`, excerpt: `reply ${i}` }))
  const mail = render(replies)
  assert.equal(mail.text.match(/replied to your post/g)?.length, LINES_MAX)
  assert.match(mail.text, /\.\.\.and 4 more\. See everything: https:\/\/heynaija\.test\/notifications/)
  assert.match(mail.html, /\.\.\.and 4 more\./)
  // When the caller only had the newest, the rest is still counted.
  assert.match(render(replies.slice(0, 3), 40).text, /\.\.\.and 37 more\./)
})

test('moderator decisions are stated plainly, with no post text and no reason', () => {
  const mail = render([
    item({ kind: 'post_removed', actor: null, postId: 'p1', excerpt: 'buy my coin' }),
    item({ kind: 'post_removed', actor: null, postId: 'p2', excerpt: 'buy my coin again' }),
    item({ kind: 'report_resolved', actor: null, postId: null }),
    item({ kind: 'moderator_granted', actor: null, postId: null, community: 'Lagos' }),
  ])
  assert.match(mail.text, /A moderator removed 2 of your posts/)
  assert.match(mail.text, /A moderator reviewed a report you made/)
  assert.match(mail.text, /You are now a moderator of Lagos/)
  assert.ok(!/buy my coin/.test(mail.text + mail.html), 'a removed post is never quoted')
  const single = render([item({ kind: 'post_removed', actor: null, excerpt: 'buy my coin' })])
  assert.equal(single.subject, 'A moderator removed one of your posts')
  assert.ok(!single.text.includes('buy my coin'))
})

test('the footer says why, how to choose and how to stop, in both parts', () => {
  const mail = render([item({ kind: 'follow', postId: null })])
  for (const part of [mail.text, mail.html]) {
    assert.match(part, /email notifications are on for @ada on HeyNaija/)
    assert.ok(part.includes(`${webUrl}/settings`))
    assert.ok(part.includes(unsubscribeUrl))
    assert.match(part, /still see your notifications in HeyNaija/)
  }
})

test('what members wrote cannot add markup or links to the HTML', () => {
  const mail = render([item({ kind: 'reply', actor: 'bayo', postId: 'r1', excerpt: '<script>alert(1)</script> & "quotes" <a href="https://evil.test">x</a>' })])
  assert.ok(!mail.html.includes('<script>'))
  assert.ok(!mail.html.includes('<a href="https://evil.test"'))
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/)
  // The text part is plain text, so it is left as written.
  assert.match(mail.text, /<script>alert\(1\)<\/script> & "quotes"/)
})
