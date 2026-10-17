// A local OIDC issuer for exercising Kratos's real OAuth callback, JWT validation,
// email challenge and persistence. No request reaches Google or a real account.
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root } from './env.ts'

export async function googleProvider() {
  // Desktop and mobile projects can have separate workers. Only one may change
  // the shared local provider at a time; an interrupted run's stale lock is safe to reclaim.
  const lock = join(tmpdir(), `heynaija-google-${createHash('sha256').update(root).digest('hex').slice(0, 12)}.lock`)
  const deadline = Date.now() + 150_000
  for (;;) {
    try { await mkdir(lock); await writeFile(join(lock, 'pid'), String(process.pid)); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const pid = Number(await readFile(join(lock, 'pid'), 'utf8'))
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') { await rm(lock, { recursive: true, force: true }); continue }
          }
        }
      } catch {}
      if (Date.now() > deadline) throw new Error('Another Google test project still owns the local provider')
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  const release = () => rm(lock, { recursive: true, force: true })
  const issuer = 'http://host.docker.internal:5099'
  const clientId = 'heynaija-google-test'
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'heynaija-test', use: 'sig', alg: 'RS256' }
  let account = { email: '', verified: true, subject: '' }
  let authorizations = 0
  const codes = new Map<string, { email: string; verified: boolean; subject: string; nonce: string; challenge: string; redirect: string }>()
  const tokens = new Map<string, object>()
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, issuer)
      const json = (body: object, status = 200) => {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify(body))
      }
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({ issuer, authorization_endpoint: 'http://127.0.0.1:5099/authorize', token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, userinfo_endpoint: `${issuer}/userinfo`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'] })
      }
      if (url.pathname === '/jwks') return json({ keys: [jwk] })
      if (url.pathname === '/authorize') {
        if (!account.email || url.searchParams.get('client_id') !== clientId) return json({ error: 'invalid_request' }, 400)
        authorizations++
        const code = randomBytes(24).toString('hex')
        codes.set(code, { ...account, nonce: url.searchParams.get('nonce') ?? '', challenge: url.searchParams.get('code_challenge') ?? '', redirect: url.searchParams.get('redirect_uri')! })
        const callback = new URL(url.searchParams.get('redirect_uri')!)
        callback.searchParams.set('code', code)
        callback.searchParams.set('state', url.searchParams.get('state')!)
        response.writeHead(303, { location: callback.href })
        return response.end()
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        let body = ''
        for await (const chunk of request) body += chunk
        const form = new URLSearchParams(body)
        const code = form.get('code') ?? ''
        const pending = codes.get(code)
        codes.delete(code)
        if (!pending || (pending.challenge && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== pending.challenge) || form.get('redirect_uri') !== pending.redirect) return json({ error: 'invalid_grant' }, 400)
        const claims = { iss: issuer, aud: clientId, sub: createHash('sha256').update(pending.subject.toLowerCase()).digest('hex'), email: pending.email, email_verified: pending.verified, nonce: pending.nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300 }
        const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
        const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode(claims)}`
        const idToken = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`
        const accessToken = randomBytes(24).toString('hex')
        tokens.set(accessToken, claims)
        return json({ access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken })
      }
      if (url.pathname === '/userinfo') {
        const claims = tokens.get((request.headers.authorization ?? '').replace(/^Bearer /, ''))
        return claims ? json(claims) : json({ error: 'invalid_token' }, 401)
      }
      return json({ error: 'not_found' }, 404)
    } catch {
      response.writeHead(500)
      response.end('Test issuer failed')
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(5099, '0.0.0.0', resolve)
    })
  } catch (error) { await release(); throw error }
  const reload = (testProvider: boolean) => {
    const args = ['compose', '--env-file', '.env', '-f', 'infra/compose/docker-compose.dev.yml']
    if (testProvider) args.push('-f', 'e2e/fixtures/google-compose.yml')
    args.push('up', '-d', '--no-deps', '--force-recreate', 'kratos')
    execFileSync('docker', args, { cwd: root, stdio: 'pipe', timeout: 60_000 })
  }
  const ready = async () => {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      try { if ((await fetch('http://127.0.0.1:4533/health/ready')).ok) return } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('Kratos did not become ready after updating the test provider')
  }
  try {
    reload(true)
    await ready()
  } catch (error) {
    try { reload(false) } finally { server.closeAllConnections(); server.close(); await release() }
    throw error
  }
  return {
    use(email: string, verified = true, subject = email) { account = { email, verified, subject } },
    get authorizations() { return authorizations },
    async close() {
      try { reload(false); await ready() } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await release() }
    },
  }
}
