// k6 load test: signed-in members using HeyNaija through the web app, the way
// browsers do. Every iteration is ONE request to the web app (a server-rendered
// page, or a call through its /api proxy), so iterations per second = requests
// per second at the front door. A page render fans out to 3-5 API calls (and as
// many Kratos whoami calls) behind it.
//
//   k6 run -e PROFILE=smoke k6/journeys.js                     # 5 req/s for 30s
//   k6 run -e PROFILE=ramp -e BASE_URL=http://10.0.0.5:3100 k6/journeys.js
//
// Sessions come from sessions.mjs (loadtest/.sessions.json). See docs/loadtest.md.
import { check } from 'k6'
import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import http from 'k6/http'
import { Counter } from 'k6/metrics'

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const PROFILE = __ENV.PROFILE || 'smoke'

const sessions = new SharedArray('sessions', () => JSON.parse(open(__ENV.SESSIONS || '../.sessions.json')))

// The staged ramp: each step climbs for a minute, then holds for three, so every
// level gets a steady stretch to measure.
// RAMP, CLIMB_S and HOLD_S can be overridden (e.g. RAMP=5,10,20 HOLD_S=20) to try
// the ramp on a laptop in a minute or two.
const RAMP = (__ENV.RAMP || '50,100,250,500,1000').split(',').map(Number)
const CLIMB_S = Number(__ENV.CLIMB_S || 60)
const HOLD_S = Number(__ENV.HOLD_S || 180)

const profiles = {
  // Does every journey work? Low enough that even `next dev` keeps up.
  smoke: {
    executor: 'constant-arrival-rate',
    rate: Number(__ENV.RATE || 2),
    timeUnit: '1s',
    duration: '30s',
    preAllocatedVUs: 10,
    maxVUs: 50,
  },
  ramp: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 200,
    // Past the knee, latency climbs and k6 needs more VUs to keep the rate up.
    maxVUs: Number(__ENV.MAX_VUS || 3000),
    stages: RAMP.flatMap((rate) => [
      { target: rate, duration: `${CLIMB_S}s` },
      { target: rate, duration: `${HOLD_S}s` },
    ]),
  },
}
if (!profiles[PROFILE]) throw new Error(`unknown PROFILE ${PROFILE}; use smoke or ramp`)

// The latency target (p95 under 300 ms) only means something against a production
// build: `next dev` renders pages one at a time, unoptimised, taking a second or
// more each. Smoke runs against dev therefore check correctness only, unless
// P95_MS is given.
const P95_MS = Number(__ENV.P95_MS || (PROFILE === 'smoke' ? 0 : 300))
const thresholds = {
  ...(P95_MS ? { http_req_duration: [`p(95)<${P95_MS}`] } : {}),
  // Stop early only if the stack has fallen over; slow is what we came to measure.
  http_req_failed: [{ threshold: 'rate<0.01' }, { threshold: 'rate<0.25', abortOnFail: true, delayAbortEval: '30s' }],
  checks: ['rate>0.99'],
}
// One verdict per held step, so the summary shows which rate broke the targets.
if (PROFILE === 'ramp') {
  for (const rate of RAMP) {
    thresholds[`http_req_duration{stage:${rate}}`] = [`p(95)<${P95_MS}`]
    thresholds[`http_req_failed{stage:${rate}}`] = ['rate<0.01']
  }
}
// Per-kind latency, reported (always-true thresholds make k6 print them).
for (const kind of ['page', 'api-read', 'api-write']) thresholds[`http_req_duration{kind:${kind}}`] = ['max>=0']

export const options = {
  scenarios: { members: profiles[PROFILE] },
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // Our own rate limits answering 429 are the app working as designed, not
  // capacity errors; they are counted separately below.
  discardResponseBodies: false,
}
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429))

const rateLimited = new Counter('rate_limited')

/** Which held step of the ramp we are in, by time since the scenario started. */
function stage() {
  if (PROFILE !== 'ramp') return PROFILE
  const s = (Date.now() - exec.scenario.startTime) / 1000
  const i = Math.floor(s / (CLIMB_S + HOLD_S))
  if (i >= RAMP.length) return 'end'
  // The climbing minute belongs to no step: it is between rates.
  return s % (CLIMB_S + HOLD_S) < CLIMB_S ? 'climb' : String(RAMP[i])
}

const pick = (list) => list[Math.floor(Math.random() * list.length)]

function params(session, name, kind, extra = {}) {
  return {
    headers: { cookie: `hn_session=${session.cookie}`, ...(extra.headers || {}) },
    // setup() runs outside any scenario, so it has no stage.
    tags: { name, kind, stage: kind === 'setup' ? 'setup' : stage() },
    timeout: '10s',
    redirects: 0,
  }
}

// Browsers send Origin on every write; the API's CSRF check compares it.
// ORIGIN must match the API's WEB_PUBLIC_URL; set it when k6 reaches the web app
// by another address (a port or IP) than the one the stack is configured for.
const origin = { origin: (__ENV.ORIGIN || BASE_URL).replace(/\/$/, '') }
const jsonWrite = { ...origin, 'content-type': 'application/json' }

function ok(res, label) {
  if (res.status === 429) rateLimited.add(1)
  return check(res, { [`${label} ok`]: (r) => (r.status >= 200 && r.status < 400) || r.status === 429 })
}

/** Runs once: collects posts, cursors and profiles to visit, and warms up every route. */
export function setup() {
  if (!sessions.length) throw new Error('no sessions; run `pnpm --filter @heynaija/loadtest sessions` first')
  const s = sessions[0]
  const postIds = []
  const authors = new Set()
  const cursors = []
  let cursor = null
  for (let page = 0; page < 5; page++) {
    const res = http.get(`${BASE_URL}/api/v1/feed?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, params(s, 'setup', 'setup'))
    if (res.status !== 200) throw new Error(`feed answered ${res.status}: is ${BASE_URL} up and seeded?`)
    const body = res.json()
    for (const p of body.posts) {
      postIds.push(p.id)
      authors.add(p.authorHandle)
    }
    cursor = body.cursor
    if (!cursor) break
    cursors.push(cursor)
  }
  if (!postIds.length) throw new Error('the feed is empty; run seed.mjs first')

  // First hits compile pages under `next dev` and fill caches; keep them out of the numbers.
  for (const path of ['/', '/?feed=following', `/p/${postIds[0]}`, `/u/${s.handle}`, '/notifications']) {
    http.get(`${BASE_URL}${path}`, params(s, 'setup', 'setup'))
  }
  return { postIds, authors: [...authors], cursors }
}

// The mix of things members do, by weight. Reads dominate, as on any social site.
const ACTIONS = [
  [25, 'home', (s) => http.get(`${BASE_URL}/`, params(s, 'GET /', 'page'))],
  [5, 'home following', (s) => http.get(`${BASE_URL}/?feed=following`, params(s, 'GET /?feed=following', 'page'))],
  [15, 'open post', (s, d) => http.get(`${BASE_URL}/p/${pick(d.postIds)}`, params(s, 'GET /p/:id', 'page'))],
  [5, 'profile', (s, d) => http.get(`${BASE_URL}/u/${pick(d.authors)}`, params(s, 'GET /u/:handle', 'page'))],
  [7, 'notifications page', (s) => http.get(`${BASE_URL}/notifications`, params(s, 'GET /notifications', 'page'))],
  [
    12,
    'scroll feed',
    (s, d) => {
      const cursor = d.cursors.length && Math.random() < 0.7 ? `&cursor=${encodeURIComponent(pick(d.cursors))}` : ''
      return http.get(`${BASE_URL}/api/v1/feed?limit=30${cursor}`, params(s, 'GET /api/v1/feed', 'api-read'))
    },
  ],
  [8, 'scroll following', (s) => http.get(`${BASE_URL}/api/v1/feed/following?limit=30`, params(s, 'GET /api/v1/feed/following', 'api-read'))],
  [8, 'me', (s) => http.get(`${BASE_URL}/api/v1/me`, params(s, 'GET /api/v1/me', 'api-read'))],
  [2, 'notifications', (s) => http.get(`${BASE_URL}/api/v1/notifications?limit=30`, params(s, 'GET /api/v1/notifications', 'api-read'))],
  [2, 'trending', (s) => http.get(`${BASE_URL}/api/v1/trending`, params(s, 'GET /api/v1/trending', 'api-read'))],
  [
    8,
    'like',
    (s, d) => {
      const id = pick(d.postIds)
      // Mostly likes; sometimes taking one back.
      const method = Math.random() < 0.8 ? 'PUT' : 'DELETE'
      return http.request(method, `${BASE_URL}/api/v1/posts/${id}/like`, null, params(s, `${method} /api/v1/posts/:id/like`, 'api-write', { headers: origin }))
    },
  ],
  [
    3,
    'create post',
    (s, d) => {
      const reply = Math.random() < 0.3
      const body = JSON.stringify({
        text: `Load test post ${Date.now()} from ${s.handle}`,
        ...(reply ? { replyTo: pick(d.postIds) } : {}),
      })
      return http.post(`${BASE_URL}/api/v1/posts`, body, params(s, 'POST /api/v1/posts', 'api-write', { headers: jsonWrite }))
    },
  ],
]
const TOTAL = ACTIONS.reduce((n, [w]) => n + w, 0)

export default function (data) {
  const session = pick(sessions)
  let roll = Math.random() * TOTAL
  for (const [weight, label, run] of ACTIONS) {
    roll -= weight
    if (roll < 0) {
      ok(run(session, data), label)
      return
    }
  }
}
