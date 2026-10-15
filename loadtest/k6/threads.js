// Focused thread journeys. RATE is completed journeys/iterations per second,
// not front-door requests/second: the reading journey makes four requests.
import { check } from 'k6'
import { SharedArray } from 'k6/data'
import http from 'k6/http'
import { Counter, Rate, Trend } from 'k6/metrics'

const fixture = JSON.parse(open(__ENV.THREAD_FIXTURES || '../.threads.json'))
const sessions = new SharedArray('thread sessions', () => JSON.parse(open(__ENV.SESSIONS || '../.sessions.json')))
const BASE_URL = (__ENV.BASE_URL || fixture.baseUrl).replace(/\/$/, '')
const MODE = __ENV.MODE || 'threads'
const CASE = __ENV.CASE || 'mixed'
const cases = ['journey', 'wide', 'deep', 'filtered', 'deleted', 'ties', 'hot', 'mixed']
if (!cases.includes(CASE) || !['threads', 'legacy'].includes(MODE)) throw new Error('invalid CASE or MODE')
if (MODE === 'legacy' && CASE !== 'journey') throw new Error('MODE=legacy requires CASE=journey')
if (fixture.version !== 1 || !sessions.length) throw new Error('seed thread fixtures and mint sessions first')
// Keep accidental writes away from named real environments. A different URL
// (e.g. a private address used by a separate load generator) needs explicit naming.
if (!/^https?:\/\//.test(BASE_URL) || /prod|staging|live/i.test(BASE_URL)
  || (BASE_URL !== fixture.baseUrl && __ENV.LOADTEST_THROWAWAY_BASE_URL !== BASE_URL)) {
  throw new Error('use the fixture BASE_URL or explicitly name LOADTEST_THROWAWAY_BASE_URL; real environment names are refused')
}
const viewer = sessions.find((s) => s.handle === fixture.viewerHandle)
if (!viewer) throw new Error(`mint a session for fixture viewer ${fixture.viewerHandle}`)
const RATE = Number(__ENV.RATE || 1)
if (!Number.isInteger(RATE) || RATE <= 0) throw new Error('RATE must be a positive integer')
const P95_MS = Number(__ENV.P95_MS || 300)
export const options = {
  scenarios: { threads: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s',
    duration: __ENV.DURATION || '30s', preAllocatedVUs: Number(__ENV.VUS || 20), maxVUs: Number(__ENV.MAX_VUS || 1000) } },
  thresholds: {
    'http_req_duration{phase:run}': [`p(95)<${P95_MS}`],
    'http_req_failed{phase:run}': ['rate<0.01'], checks: ['rate>0.99'],
    dropped_iterations: ['count==0'],
    // Report completed-journey latency and body size without equating them with per-request targets.
    journey_duration: ['max>=0'], journey_body_bytes: ['max>=0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
}
http.setResponseCallback(http.expectedStatuses(200, 201, 429))
const completed = new Counter('completed_journeys')
const attempted = new Counter('attempted_journeys')
const journeyDuration = new Trend('journey_duration', true)
const journeyBytes = new Trend('journey_body_bytes')
const bodyBytes = new Trend('response_body_bytes')
const successfulWrites = new Counter('successful_writes')
const writeCompletion = new Rate('write_completion')
const rateLimited = new Counter('rate_limited')

const pick = (list) => list[Math.floor(Math.random() * list.length)]
// UTF-8 body bytes, before transfer compression; data_received separately counts
// actual wire traffic, including headers. String.length would miscount emoji.
function bytes(text) {
  let count = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) count++
    else if (c < 0x800) count += 2
    else if (c >= 0xd800 && c <= 0xdbff) { count += 4; i++ }
    else count += 3
  }
  return count
}
function params(session, name, test, write = false) {
  return { headers: { cookie: `hn_session=${session.cookie}`,
    ...(write ? { origin: __ENV.ORIGIN || BASE_URL, 'content-type': 'application/json' } : {}) },
  tags: { name, case: test, mode: MODE, phase: test === 'setup' ? 'setup' : 'run' }, redirects: 0, timeout: '10s' }
}
function get(path, session, name, test, expected = 200) {
  const response = http.get(`${BASE_URL}${path}`, { ...params(session, name, test), responseCallback: http.expectedStatuses(expected, 429) })
  const size = bytes(response.body || '')
  bodyBytes.add(size, { case: test, name, mode: MODE })
  if (response.status === 429) rateLimited.add(1, { case: test })
  if (__ENV.DEBUG === '1' && response.status !== expected) console.warn(`${test}: ${name} returned ${response.status}, expected ${expected}`)
  check(response, { [`read returned ${expected}`]: (r) => r.status === expected })
  return { response, size, ok: response.status === expected }
}
function json(result) {
  try { return result.response.json() } catch { return null }
}
function replyPage(parent, cursor, session, test) {
  const result = get(`/api/v1/posts/${parent}/replies?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    session, cursor && test === 'wide' ? 'GET /api/v1/posts/:id/replies (late)' : 'GET /api/v1/posts/:id/replies', test)
  const page = json(result)
  const valid = check(page, { 'reply page is bounded': (p) => Array.isArray(p?.replies) && p.replies.length <= 20,
    'reply cursor is nullable string': (p) => p && (p.cursor === null || typeof p.cursor === 'string') })
  return { ...result, page, ok: result.ok && valid }
}

export function setup() {
  // Compile/warm up routes outside the scored scenario, without creating posts.
  for (const id of [fixture.reading[0], fixture.deep]) {
    const res = http.get(`${BASE_URL}/p/${id}`, params(viewer, 'setup', 'setup'))
    if (res.status !== 200) throw new Error(`fixture page returned ${res.status}; check BASE_URL, sessions and database snapshot`)
  }
  if (MODE !== 'legacy') {
    const res = http.get(`${BASE_URL}/api/v1/posts/${fixture.wide}/replies?limit=20`, params(viewer, 'setup', 'setup'))
    if (res.status !== 200 || !Array.isArray(res.json().replies)) throw new Error('thread reply API is unavailable')
  }
}

export default function () {
  const test = CASE === 'mixed' ? pick(['journey', 'journey', 'wide', 'wide', 'deep', 'filtered', 'deleted', 'ties']) : CASE
  const session = test === 'filtered' ? viewer : pick(sessions)
  const start = Date.now()
  let size = 0
  let ok = true
  const record = (result) => { size += result.size; ok = ok && result.ok; return result }
  if (test === 'journey') {
    // Same four conversation positions before/after: old UI navigates to each
    // focus; new UI renders once and expands the three already-visible connectors.
    for (const [index, id] of fixture.reading.entries()) {
      if (index === 0 || MODE === 'legacy') record(get(`/p/${id}`, session, 'GET /p/:id', test))
      else record(replyPage(id, null, session, test))
    }
  } else if (test === 'wide') {
    record(replyPage(fixture.wide, null, session, test))
    record(replyPage(fixture.wide, fixture.wideLateCursor, session, test))
  } else if (test === 'deep') {
    record(get(`/p/${fixture.deep}`, session, 'GET /p/:id', test))
    const result = record(get(`/api/v1/posts/${fixture.deep}`, session, 'GET /api/v1/posts/:id', test))
    const thread = json(result)
    ok = check(thread, { 'ancestor context is capped and truncated': (t) => Array.isArray(t?.ancestors)
      && t.ancestors.length <= 50 && t.ancestorsTruncated === true && typeof t.earlierAncestorId === 'string' }) && ok
  } else if (test === 'filtered') {
    const result = record(replyPage(fixture.filtered, null, viewer, test))
    ok = check(result.page, { 'hidden authors are excluded': (p) => Array.isArray(p?.replies)
      && p.replies.every((r) => !fixture.hiddenAuthors.includes(r.authorId)),
    'filtered page fills when enough visible replies exist': (p) => p?.replies?.length === Math.min(20, Math.floor(fixture.filteredReplies / 10)) }) && ok
  } else if (test === 'deleted') {
    for (const [parent, expected] of [[fixture.deleted, fixture.deletedFirst], [fixture.deletedFirst, fixture.deletedSecond], [fixture.deletedSecond, fixture.survivor]]) {
      const result = record(replyPage(parent, null, session, test))
      ok = check(result.page, { 'surviving branch is traversable and deleted leaves are omitted': (p) => p?.replies?.length === 1 && p.replies[0].id === expected,
      'deleted intermediates contain no content or author': (p) => Array.isArray(p?.replies)
        && p.replies.filter((r) => r.id === fixture.deletedFirst || r.id === fixture.deletedSecond)
          .every((r) => r.unavailable === true && r.hasReplies === true && !('text' in r) && !('images' in r)
            && !('authorId' in r) && !('authorHandle' in r) && !('replyCount' in r)) }) && ok
    }
    record(get(`/api/v1/posts/${fixture.goneRoot}`, session, 'GET /api/v1/posts/:id (deleted root)', test, 404))
    record(get(`/api/v1/posts/${fixture.goneRootSurvivor}`, session, 'GET /api/v1/posts/:id', test))
  } else if (test === 'ties') {
    let cursor = null
    const ids = new Set()
    // The fixture is exactly 80 rows. A fifth page or duplicate exposes cursor
    // precision/order regressions without an unbounded test-side pagination loop.
    for (let page = 0; page < 4; page++) {
      const result = record(replyPage(fixture.ties, cursor, session, test))
      if (!result.ok) break
      for (const row of result.page.replies) ids.add(row.id)
      cursor = result.page.cursor
      if (!cursor) break
    }
    ok = check(ids, { 'timestamp ties page exactly once': (seen) => seen.size === 80 && cursor === null }) && ok
  } else if (test === 'hot') {
    const response = http.post(`${BASE_URL}/api/v1/posts`, JSON.stringify({ replyTo: fixture.hot,
      text: `Load test hot reply ${__VU}-${__ITER}-${Date.now()}` }), params(session, 'POST /api/v1/posts (hot parent)', test, true))
    size = bytes(response.body || '')
    bodyBytes.add(size, { case: test, mode: MODE })
    if (response.status === 429) rateLimited.add(1, { case: test })
    const wrote = response.status === 201
    writeCompletion.add(wrote)
    successfulWrites.add(wrote ? 1 : 0)
    check(response, { 'write returned 201 or rate limit': (r) => r.status === 201 || r.status === 429 })
    ok = wrote
  }
  journeyDuration.add(Date.now() - start, { case: test, mode: MODE })
  journeyBytes.add(size, { case: test, mode: MODE })
  attempted.add(1, { case: test, mode: MODE })
  completed.add(ok ? 1 : 0, { case: test, mode: MODE })
}
