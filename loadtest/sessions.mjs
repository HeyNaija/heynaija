// Signs the seeded load-test users in, the way a browser does (emailed code
// through the web app's /kratos proxy), and writes their session cookies to
// loadtest/.sessions.json for k6. Sign-in is passwordless, so the codes are read
// from Mailpit: the throwaway stack must send its email there, never to a real
// mail provider (docs/loadtest.md).
//
//   pnpm --filter @heynaija/loadtest sessions --count=500
//
// Sessions last 14 days (infra/kratos/kratos.yml), so this runs once per stack,
// not once per test. Signing in is its own load test: --concurrency raises it.
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { connectToThrowaway, die, env } from './lib/target.mjs'

const { values: args } = parseArgs({
  options: {
    count: { type: 'string', default: '500' },
    concurrency: { type: 'string', default: '10' },
    out: { type: 'string', default: new URL('.sessions.json', import.meta.url).pathname },
  },
})

const pool = await connectToThrowaway()
const { rows: users } = await pool.query(
  `select idx, id from loadtest_members where kratos order by idx limit $1`,
  [Number(args.count)],
)
await pool.end()
if (!users.length) die('no load-test users with Kratos identities; run seed.mjs first')

/** A tiny cookie jar: enough for Kratos's CSRF cookie and the session cookie. */
const jar = () => {
  const cookies = new Map()
  return {
    take(res) {
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';')
        const eq = pair.indexOf('=')
        cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1))
      }
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
    get: (name) => cookies.get(name),
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function codeFromMailpit(email, notBefore) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${env.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    if (!res.ok) throw new Error(`Mailpit: ${res.status}`)
    const { messages } = await res.json()
    const msg = messages.find((m) => new Date(m.Created) >= notBefore)
    const code = msg?.Snippet.match(/\b(\d{6})\b/)?.[1]
    if (code) {
      await fetch(`${env.mailpitUrl}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ IDs: messages.map((m) => m.ID) }),
      })
      return code
    }
    await sleep(500)
  }
  throw new Error(`no sign-in code for ${email} in Mailpit after 30s`)
}

async function signIn(idx) {
  const email = `lt_${idx}@loadtest.test`
  const cookies = jar()
  const json = { accept: 'application/json', 'content-type': 'application/json' }

  let res = await fetch(`${env.baseUrl}/kratos/self-service/login/browser`, { headers: json, redirect: 'manual' })
  cookies.take(res)
  const flow = await res.json()
  const csrf = flow.ui.nodes.find((n) => n.attributes.name === 'csrf_token').attributes.value
  const submit = (body) =>
    fetch(`${env.baseUrl}/kratos/self-service/login?flow=${flow.id}`, {
      method: 'POST',
      headers: { ...json, cookie: cookies.header() },
      body: JSON.stringify({ method: 'code', csrf_token: csrf, identifier: email, ...body }),
      redirect: 'manual',
    })

  const asked = new Date(Date.now() - 1000)
  res = await submit({})
  cookies.take(res)
  // 400 here is Kratos saying "code sent, now enter it".
  if (res.status !== 400 && !res.ok) throw new Error(`${email}: asking for a code got ${res.status}`)

  res = await submit({ code: await codeFromMailpit(email, asked) })
  cookies.take(res)
  const session = cookies.get('hn_session')
  if (!res.ok || !session) throw new Error(`${email}: entering the code got ${res.status} ${await res.text()}`)
  return { handle: `lt_${idx}`, cookie: session }
}

const sessions = []
const queue = [...users]
const t = Date.now()
await Promise.all(
  Array.from({ length: Number(args.concurrency) }, async () => {
    for (let u = queue.shift(); u; u = queue.shift()) {
      sessions.push(await signIn(u.idx))
      if (sessions.length % 100 === 0) console.log(`${sessions.length}/${users.length} signed in`)
    }
  }),
)
await writeFile(args.out, JSON.stringify(sessions))
console.log(`${sessions.length} sessions in ${((Date.now() - t) / 1000).toFixed(0)}s -> ${args.out}`)
