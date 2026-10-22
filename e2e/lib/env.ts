// Where the tests point, and the checks that keep them on this machine.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../', import.meta.url))
const envFile = `${root}.env`
if (existsSync(envFile)) process.loadEnvFile(envFile)

const url = (value: string | undefined, fallback: string) => (value ?? fallback).replace(/\/$/, '')

export const env = {
  baseUrl: url(process.env.E2E_BASE_URL, 'http://127.0.0.1:3000'),
  apiUrl: url(process.env.E2E_API_URL, 'http://127.0.0.1:4000'),
  mailpitUrl: url(process.env.MAILPIT_URL, 'http://127.0.0.1:8026'),
  kratosAdminUrl: url(process.env.KRATOS_ADMIN_URL, 'http://127.0.0.1:4534'),
  kratosPublicUrl: url(process.env.KRATOS_PUBLIC_URL, 'http://127.0.0.1:4533'),
  databaseUrl: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL,
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** Throws unless every service the tests write to is on this machine. */
export function assertLocal() {
  if (!env.databaseUrl) throw new Error('DATABASE_URL is not set (run pnpm infra:env, or set E2E_DATABASE_URL)')
  const db = new URL(env.databaseUrl)
  const name = `${db.hostname}${db.pathname}`
  if (!LOOPBACK.has(db.hostname)) throw new Error(`refusing to run: database ${db.hostname} is not on this machine`)
  if (/prod|staging|live/i.test(name)) throw new Error(`refusing to run: database ${name} looks like a real environment`)
  const services = { web: env.baseUrl, mailpit: env.mailpitUrl, kratos: env.kratosAdminUrl, 'kratos public': env.kratosPublicUrl }
  for (const [what, value] of Object.entries(services)) {
    if (!LOOPBACK.has(new URL(value).hostname)) throw new Error(`refusing to run: ${what} ${value} is not on this machine`)
  }
}

/** Members, emails and invites made by these tests carry these marks, so cleanup finds only them. */
export const MARK = { handlePrefix: 'e2e_', emailDomain: 'e2e.test', inviteNote: 'e2e' }
