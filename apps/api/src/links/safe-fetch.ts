import { lookup as resolve } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

/** The address is not one we will fetch, or the page misbehaved. Nothing here is the member's fault. */
export class FetchRefused extends Error {}

// Anything on the machine or the networks around it. A link in a post is written
// by a stranger, so fetching it must never reach our database, our storage, the
// cloud provider's metadata service (169.254.169.254) or a neighbour on the LAN.
const PRIVATE = new net.BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast, and 240.0.0.0/4 reserved (with broadcast)
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 96], // unspecified, loopback, and the old IPv4-compatible form
  ['64:ff9b::', 96], // NAT64: carries an IPv4 address inside
  ['100::', 64],
  ['2001::', 23], // protocol assignments, including Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4: carries an IPv4 address inside
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10],
  ['ff00::', 8], // multicast
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6')
}

/** True for an address on the public internet. IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is judged as the IPv4 address. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 0) return false
  const mapped = family === 6 ? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address) : null
  if (mapped) return isPublicAddress(mapped[1]!)
  return !PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

export type Fetched = {
  /** After any redirects. */
  url: URL
  contentType: string
  body: Buffer
}

export type GetOptions = {
  /** Media types we will read, e.g. `['text/html']` or `['image/']` (matched at the start). */
  accept: string[]
  /** The most we will read. */
  maxBytes: number
  /**
   * Reading a page only as far as `maxBytes` is fine, since its head comes first.
   * Otherwise (an image, which is useless cut short) anything larger is refused.
   */
  partial?: boolean
  /** For the whole thing, redirects included. */
  timeoutMs?: number
  maxRedirects?: number
}

/** What the link service needs to read a page; tests supply their own. */
export interface PageFetcher {
  get(url: string, options: GetOptions): Promise<Fetched>
}

export const USER_AGENT = 'HeyNaijaBot/1.0 (link previews; +https://heynaija.ng)'

type Policy = {
  /** Whether an address may be connected to. Always `isPublicAddress` outside tests. */
  allowed(address: string): boolean
  /** Ports we will contact; a link to port 6379 is not a link to a web page. */
  ports: number[]
}

const PUBLIC_ONLY: Policy = { allowed: isPublicAddress, ports: [80, 443] }

/**
 * Fetches pages for previews. Every connection, including each redirect, goes to
 * an address checked at the moment of connecting (not looked up once and trusted,
 * which a hostile name server could change in between), and nothing is read
 * beyond a size and time limit.
 */
export class SafeFetcher implements PageFetcher {
  constructor(private readonly policy: Policy = PUBLIC_ONLY) {}

  async get(rawUrl: string, { accept, maxBytes, partial = false, timeoutMs = 6000, maxRedirects = 3 }: GetOptions): Promise<Fetched> {
    const deadline = Date.now() + timeoutMs
    let url = this.check(rawUrl)
    for (let hop = 0; ; hop++) {
      const response = await this.once(url, accept, deadline)
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        if (hop >= maxRedirects) throw new FetchRefused('too many redirects')
        url = this.check(new URL(response.headers.location, url).href)
        continue
      }
      if (status < 200 || status >= 300) {
        response.resume()
        throw new FetchRefused(`the site answered ${status}`)
      }
      const contentType = String(response.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
      if (!accept.some((type) => contentType.startsWith(type))) {
        response.resume()
        throw new FetchRefused(`not a kind of page we read (${contentType || 'unknown'})`)
      }
      // Asked for without compression, so a small download cannot unpack into a large one.
      const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase()
      if (encoding !== 'identity') {
        response.resume()
        throw new FetchRefused('the site compressed its answer anyway')
      }
      const declared = Number(response.headers['content-length'])
      if (!partial && Number.isFinite(declared) && declared > maxBytes) {
        response.resume()
        throw new FetchRefused('too large')
      }
      return { url, contentType, body: await this.read(response, maxBytes, partial, deadline) }
    }
  }

  /** The address as a URL, or throws if it is not one we would contact. */
  private check(raw: string): URL {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new FetchRefused('not an address')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchRefused('not a web address')
    if (url.username || url.password) throw new FetchRefused('address has a login in it')
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    if (!this.policy.ports.includes(port)) throw new FetchRefused('unusual port')
    // A numeric host skips the name lookup below, so judge it here.
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) && !this.policy.allowed(host)) throw new FetchRefused('private address')
    return url
  }

  /** Looks the name up and refuses any answer that includes a private address. */
  private readonly lookup: net.LookupFunction = (hostname, options, callback) => {
    resolve(hostname, { all: true, family: options.family }, (error, addresses) => {
      if (error) return callback(error, '', 4)
      if (!addresses.length || addresses.some((a) => !this.policy.allowed(a.address))) {
        return callback(new FetchRefused('private address'), '', 4)
      }
      if (options.all) return callback(null, addresses as never)
      callback(null, addresses[0]!.address, addresses[0]!.family)
    })
  }

  private once(url: URL, accept: string[], deadline: number): Promise<http.IncomingMessage> {
    return new Promise((done, fail) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        url,
        {
          method: 'GET',
          lookup: this.lookup,
          agent: false, // a fresh connection each time, so nothing is reused across checks
          headers: {
            'user-agent': USER_AGENT,
            accept: accept.map((type) => (type.includes('/') && !type.endsWith('/') ? type : `${type}*`)).join(', '),
            'accept-encoding': 'identity',
            'accept-language': 'en',
          },
        },
        done,
      )
      const remaining = deadline - Date.now()
      if (remaining <= 0) return fail(new FetchRefused('timed out'))
      request.setTimeout(remaining, () => request.destroy(new FetchRefused('timed out')))
      request.on('error', fail)
      request.end()
    })
  }

  private read(response: http.IncomingMessage, maxBytes: number, partial: boolean, deadline: number): Promise<Buffer> {
    return new Promise((done, fail) => {
      const chunks: Buffer[] = []
      let size = 0
      const timer = setTimeout(() => response.destroy(new FetchRefused('timed out')), Math.max(1, deadline - Date.now()))
      const finish = () => {
        clearTimeout(timer)
        done(Buffer.concat(chunks).subarray(0, maxBytes))
      }
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        size += chunk.length
        if (size > maxBytes && !partial) {
          clearTimeout(timer)
          response.destroy()
          return fail(new FetchRefused('too large'))
        }
        if (size >= maxBytes && partial) {
          response.destroy()
          finish()
        }
      })
      response.on('end', finish)
      response.on('error', (error) => {
        clearTimeout(timer)
        // Hanging up on a page we have read enough of is not a failure.
        if (partial && size >= maxBytes) done(Buffer.concat(chunks).subarray(0, maxBytes))
        else fail(error)
      })
    })
  }
}
