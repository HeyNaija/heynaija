import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CloudflarePurger } from './cdn-purge.js'

const zone = 'a'.repeat(32)

/** A stand-in for Cloudflare's API that records what it was asked to purge. */
const cloudflare = (answer: { status?: number; body: unknown }) => {
  const calls: { url: string; auth: string; files: string[] }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      auth: (init.headers as Record<string, string>).authorization!,
      files: JSON.parse(init.body as string).files,
    })
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }) as typeof fetch
  return { calls, fetchFn }
}

test('each file is purged under every address it is served from', async () => {
  const { calls, fetchFn } = cloudflare({ body: { success: true, errors: [] } })
  await new CloudflarePurger(zone, 'TOKEN', ['https://heynaija.ng/media', 'https://media.heynaija.ng'], fetchFn).purge([
    'posts/p1/640.webp',
    'posts/p1/1600.webp',
  ])
  assert.deepEqual(calls, [
    {
      url: `https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,
      auth: 'Bearer TOKEN',
      files: [
        'https://heynaija.ng/media/posts/p1/640.webp',
        'https://media.heynaija.ng/posts/p1/640.webp',
        'https://heynaija.ng/media/posts/p1/1600.webp',
        'https://media.heynaija.ng/posts/p1/1600.webp',
      ],
    },
  ])
})

test('a long list goes in several requests, within Cloudflare’s limit', async () => {
  const { calls, fetchFn } = cloudflare({ body: { success: true } })
  const keys = Array.from({ length: 40 }, (_, i) => `avatars/a${i}/96.webp`)
  await new CloudflarePurger(zone, 'TOKEN', ['https://heynaija.ng/media'], fetchFn).purge(keys)
  assert.deepEqual(calls.map((c) => c.files.length), [30, 10])
})

test('a refusal throws, so the job is tried again', async () => {
  const refused = cloudflare({ status: 403, body: { success: false, errors: [{ message: 'Authentication error' }] } })
  await assert.rejects(
    new CloudflarePurger(zone, 'BAD', ['https://heynaija.ng/media'], refused.fetchFn).purge(['posts/p1/640.webp']),
    /403.*Authentication error/,
  )
  const unsure = cloudflare({ body: { success: false } })
  await assert.rejects(new CloudflarePurger(zone, 'TOKEN', ['https://heynaija.ng/media'], unsure.fetchFn).purge(['posts/p1/640.webp']))
})
