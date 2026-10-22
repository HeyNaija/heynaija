import { createServer } from 'node:http'

const origin = 'http://127.0.0.1:3307'
const requests = []
const input = (name, type, value, group = 'default', label = name) => ({
  type: 'input', group, attributes: { name, type, value }, messages: [], meta: { label: { id: 0, text: label } },
})

createServer(async (req, res) => {
  const url = new URL(req.url, origin)
  let body = ''
  for await (const chunk of req) body += chunk
  if (url.pathname !== '/__requests') requests.push({ path: url.pathname, cookie: req.headers.cookie ?? '', body })
  const json = (value, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(value))
  }
  if (url.pathname === '/__requests') return json(requests)
  if (['/health', '/v1/health'].includes(url.pathname)) return json({ ok: true })
  if (url.pathname === '/v1/me') return json({ id: 'fixture-member', handle: 'ada', bio: '', avatar: null, displayName: 'Ada', unreadNotifications: 0, moderates: false })
  if (['/v1/communities', '/v1/trending'].includes(url.pathname)) return json([])
  if (url.pathname === '/v1/me/governance') return json({}, 503)
  if (url.pathname === '/v1/invites/check') return json({ usable: true })
  if (url.pathname === '/v1/logout') { res.writeHead(204); return res.end() }
  if (url.pathname === '/sessions/whoami') return json({ active: true, identity: { id: '11111111-1111-4111-8111-111111111111', traits: { email: 'ada@example.test', handle: 'ada' } } })
  if (url.pathname === '/self-service/logout/browser') return json({ logout_url: `${origin}/kratos/self-service/logout?token=fixture` })
  if (url.pathname === '/self-service/logout') {
    res.writeHead(303, { location: '/auth-error' }); return res.end()
  }
  if (url.pathname === '/self-service/errors') return json({ error: { reason: 'Fixture flow expired' } })
  const browser = url.pathname.match(/^\/self-service\/(login|registration|verification|settings)\/browser$/)
  if (browser) {
    const kind = browser[1]
    const page = kind === 'registration' ? 'signup' : kind
    res.writeHead(303, { location: `/${page}?flow=${kind}`, 'set-cookie': 'csrf_fixture=raw%2Fvalue; Path=/; HttpOnly; SameSite=Lax' })
    return res.end()
  }
  const match = url.pathname.match(/^\/self-service\/(login|registration|verification|settings)\/flows$/)
  if (match) {
    const kind = match[1], id = url.searchParams.get('id')
    if (id === 'expired') return json({}, 410)
    const group = kind === 'settings' ? 'profile' : 'default'
    const nodes = [input('csrf_token', 'hidden', 'csrf-fixture')]
    if (kind === 'registration' || kind === 'settings') {
      nodes.push(input('traits.email', 'email', 'ada@example.test', group), input('traits.handle', 'text', 'ada', group))
    } else nodes.push(input('identifier', 'email', '', group))
    if (id === 'email-change') nodes.push(input('email_change_code', 'text', '', group))
    nodes.push(input('method', 'submit', kind === 'settings' ? 'profile' : 'code', group, 'Continue'))
    if (kind === 'settings') nodes.push(input('unlink', 'submit', 'google', 'oidc', 'Disconnect Google'))
    return json({ id, refresh: id === 'refresh', ui: {
      action: `${origin}/kratos/self-service/${kind}?flow=${id}`, method: 'POST', nodes,
      messages: ['notice', 'email-change'].includes(id) ? [{ id: 1, type: 'success', text: 'Saved fixture notice' }] : [],
    } })
  }
  if (req.method === 'POST' && url.pathname.startsWith('/self-service/')) {
    res.writeHead(303, { location: '/auth-error?id=submitted' }); return res.end()
  }
  return json({}, 404)
}).listen(4407, '127.0.0.1')
