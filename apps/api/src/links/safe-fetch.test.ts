import assert from 'node:assert/strict'
import http from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { FetchRefused, isPublicAddress, SafeFetcher } from './safe-fetch.js'

test('only public addresses may be contacted', () => {
  for (const address of ['8.8.8.8', '41.58.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(address), true, address)
  }
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1', // IPv4 loopback dressed as IPv6
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1', // NAT64 for 127.0.0.1
    '2002:7f00:1::', // 6to4 for 127.0.0.1
    'not an address',
    '',
  ]) {
    assert.equal(isPublicAddress(address), false, address)
  }
})

let server: http.Server
let origin: string
let port: number
const hits: string[] = []

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? '')
    const send = (status: number, type: string, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers })
      res.end(body)
    }
    switch (req.url) {
      case '/page':
        return send(200, 'text/html; charset=utf-8', '<title>Hello</title>')
      case '/moved':
        return send(302, 'text/plain', '', { location: '/page' })
      case '/loop':
        return send(302, 'text/plain', '', { location: '/loop' })
      case '/inward':
        return send(302, 'text/plain', '', { location: 'http://10.0.0.1/secret' })
      case '/json':
        return send(200, 'application/json', '{}')
      case '/gone':
        return send(404, 'text/html', 'no')
      case '/zipped':
        return send(200, 'text/html', 'x', { 'content-encoding': 'gzip' })
      case '/big':
        return send(200, 'text/html', 'a'.repeat(100_000))
      case '/slow':
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('<title>')
        return // never finishes
      default:
        return send(404, 'text/plain', '')
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  port = (server.address() as AddressInfo).port
  origin = `http://127.0.0.1:${port}`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

const html = { accept: ['text/html'], maxBytes: 2048, partial: true }
// The test server is on loopback, which the real policy forbids: this one allows it.
const open = () => new SafeFetcher({ allowed: () => true, ports: [port] })

test('reads a page', async () => {
  const page = await open().get(`${origin}/page`, html)
  assert.equal(page.body.toString(), '<title>Hello</title>')
  assert.equal(page.contentType, 'text/html')
})

test('follows a redirect and reports where it ended', async () => {
  const page = await open().get(`${origin}/moved`, html)
  assert.equal(page.url.pathname, '/page')
})

test('stops following redirects after a few', async () => {
  await assert.rejects(open().get(`${origin}/loop`, html), FetchRefused)
})

test('a redirect to a private address is refused, as is the first request', async () => {
  const fetcher = new SafeFetcher({ allowed: (a) => !a.startsWith('10.'), ports: [port, 80] })
  await assert.rejects(fetcher.get(`${origin}/inward`, html), /private address/)
  await assert.rejects(fetcher.get('http://10.0.0.1/', html), /private address/)
})

test('by default nothing on this machine can be reached, by number or by name', async () => {
  const strict = new SafeFetcher()
  hits.length = 0
  for (const url of [`${origin}/page`, `http://localhost:${port}/page`, 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://0x7f.1/', 'http://2130706433/']) {
    await assert.rejects(strict.get(url, html), FetchRefused, url)
  }
  assert.deepEqual(hits, [], 'nothing reached the server')
})

test('only ports 80 and 443 and only web schemes', async () => {
  const strict = new SafeFetcher()
  await assert.rejects(strict.get('http://example.com:6379/', html), /unusual port/)
  await assert.rejects(strict.get('file:///etc/passwd', html), /not a web address/)
  await assert.rejects(strict.get('ftp://example.com/', html), /not a web address/)
  await assert.rejects(strict.get('http://user:pw@example.com/', html), /login/)
  await assert.rejects(strict.get('nonsense', html), /not an address/)
})

test('refuses what is not the kind of page asked for', async () => {
  await assert.rejects(open().get(`${origin}/json`, html), /not a kind of page/)
  await assert.rejects(open().get(`${origin}/gone`, html), /answered 404/)
  await assert.rejects(open().get(`${origin}/zipped`, html), /compressed/)
})

test('a page is read as far as the limit and no further, while anything else over it is refused', async () => {
  const page = await open().get(`${origin}/big`, html)
  assert.equal(page.body.length, 2048)
  await assert.rejects(open().get(`${origin}/big`, { ...html, partial: false }), /too large/)
})

test('gives up on a page that never finishes', async () => {
  await assert.rejects(open().get(`${origin}/slow`, { ...html, timeoutMs: 300 }), /timed out/)
})

// A server that accepts, then trickles a response header one byte at a time and never ends it.
// Each byte arrives inside the socket's idle interval, so only a whole-fetch deadline stops it.
async function dripServer(): Promise<{ origin: string; port: number; close: () => void }> {
  const sockets = new Set<net.Socket>()
  const intervals = new Set<NodeJS.Timeout>()
  const dripping = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('data', (request) => {
      if (request.toString().startsWith('GET /hop ')) {
        socket.end('HTTP/1.1 302 Found\r\nLocation: /drip\r\nContent-Length: 0\r\n\r\n')
        return
      }
      socket.write('HTTP/1.1 200 OK\r\nX-A: ')
      const timer = setInterval(() => socket.write('a'), 200)
      intervals.add(timer)
      socket.on('close', () => clearInterval(timer))
    })
  })
  await new Promise<void>((done) => dripping.listen(0, '127.0.0.1', done))
  const dripPort = (dripping.address() as AddressInfo).port
  return {
    origin: `http://127.0.0.1:${dripPort}`,
    port: dripPort,
    close: () => {
      for (const timer of intervals) clearInterval(timer)
      for (const socket of sockets) socket.destroy()
      dripping.close()
    },
  }
}

test('gives up on a server that drips its response headers and never finishes them', async () => {
  const drip = await dripServer()
  try {
    const started = Date.now()
    await assert.rejects(
      new SafeFetcher({ allowed: () => true, ports: [drip.port] }).get(`${drip.origin}/drip`, { ...html, timeoutMs: 1500 }),
      /timed out/,
    )
    assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms`)
  } finally {
    drip.close()
  }
})

test('the deadline covers a redirect whose next hop drips its headers', async () => {
  const drip = await dripServer()
  try {
    const started = Date.now()
    await assert.rejects(
      new SafeFetcher({ allowed: () => true, ports: [drip.port] }).get(`${drip.origin}/hop`, { ...html, timeoutMs: 1500 }),
      /timed out/,
    )
    assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms`)
  } finally {
    drip.close()
  }
})
