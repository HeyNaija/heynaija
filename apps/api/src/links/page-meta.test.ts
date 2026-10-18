import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeEntities, decodePage, readPageMeta } from './page-meta.js'

const page = new URL('https://www.example.com/news/story')

test('reads the Open Graph tags', () => {
  const meta = readPageMeta(
    `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Lagos &amp; beyond">
      <meta property="og:description" content="A short   description
        over two lines.">
      <meta property="og:site_name" content="The Example">
      <meta property="og:image" content="/img/cover.jpg">
    </head><body>hi</body></html>`,
    page,
  )
  assert.deepEqual(meta, {
    title: 'Lagos & beyond',
    description: 'A short description over two lines.',
    siteName: 'The Example',
    image: 'https://www.example.com/img/cover.jpg',
  })
})

test('falls back to the title, the plain description and the site name', () => {
  const meta = readPageMeta(`<head><TITLE> Plain
    title </TITLE><meta name="description" content='single quotes'></head>`, page)
  assert.deepEqual(meta, { title: 'Plain title', description: 'single quotes', siteName: 'example.com', image: null })
})

test('Twitter tags are used when there are no Open Graph ones', () => {
  const meta = readPageMeta(
    `<meta name="twitter:title" content="T"><meta name="twitter:description" content="D"><meta name="twitter:image" content="https://cdn.example.net/a.png">`,
    page,
  )
  assert.equal(meta.title, 'T')
  assert.equal(meta.description, 'D')
  assert.equal(meta.image, 'https://cdn.example.net/a.png')
})

test('tags inside scripts, comments and the body are not the page\'s own', () => {
  const meta = readPageMeta(
    `<head><!-- <meta property="og:title" content="commented"> -->
     <script>var s = '<meta property="og:title" content="scripted">'</script>
     <title>Real</title></head>
     <body><meta property="og:title" content="in the body"></body>`,
    page,
  )
  assert.equal(meta.title, 'Real')
})

test('an image that is not a web address is dropped', () => {
  for (const image of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
    assert.equal(readPageMeta(`<meta property="og:image" content="${image}">`, page).image, null, image)
  }
})

test('long text is cut at a word, and control characters are removed', () => {
  const long = `${'word '.repeat(100)}end`
  const meta = readPageMeta(`<meta property="og:title" content="${long}"><meta property="og:description" content="a‮b\u0000c">`, page)
  assert.ok(meta.title!.length <= 160)
  assert.ok(meta.title!.endsWith('word…'))
  assert.equal(meta.description, 'abc')
})

test('a page with nothing to say gives nothing', () => {
  assert.deepEqual(readPageMeta('<html><body>just text</body></html>', page), {
    title: null,
    description: null,
    siteName: 'example.com',
    image: null,
  })
})

test('entities decode, but only real ones', () => {
  assert.equal(decodeEntities('a &amp; b &lt;i&gt; &#39;x&#39; &#x1F600; &nbsp;|'), "a & b <i> 'x' 😀  |")
  assert.equal(decodeEntities('&bogus; &#0; &#xD800; &#99999999;'), '&bogus; &#0; &#xD800; &#99999999;')
})

test('pages are decoded in the character set they declare', () => {
  const latin1 = Buffer.from('<meta charset="iso-8859-1"><title>café</title>', 'latin1')
  assert.match(decodePage(latin1), /café/)
  assert.match(decodePage(Buffer.from('<title>café</title>', 'utf8'), 'text/html; charset=UTF-8'), /café/)
  assert.match(decodePage(Buffer.from('<title>x</title>'), 'text/html; charset=nonsense'), /x/)
})
