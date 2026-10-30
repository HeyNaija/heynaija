// Privacy requests that arrive by email (docs/governance/privacy-requests.md).
// Usage:
//   pnpm privacy-request record (--email <address> | --handle <handle>) --kind <kind> [--notes <text>]
//   pnpm privacy-request list [--overdue]
//   pnpm privacy-request delete-account (--request <id> | --email <address> | --handle <handle>) [--now]
//   pnpm privacy-request complete <id> [--refused] [--notes <text>]
// <kind> is access, correction, deletion, objection or other. On a server, in the
// API's container: docker compose exec api node dist/cli/privacy-request.js <command> ...
//
// It asks for erasures and never does one: the API's account worker erases, so
// this needs no storage or CDN keys (loadPrivacyToolEnv).
import { parseArgs } from 'node:util'
import { createDb, members, PRIVACY_REQUEST_KINDS } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { AccountDeletionService } from '../account/account-deletion.service.js'
import { BullAccountJobs } from '../account/account-queue.js'
import { EmailDeletionNotices } from '../account/deletion-notices.js'
import { failureReason } from '../account/failure-reason.js'
import { PrivacyRequestError, PrivacyRequestsService, type RequestKind } from '../account/privacy-requests.service.js'
import { KratosAdmin } from '../auth/kratos-admin.js'
import { KratosAddresses } from '../email/addresses.js'
import { smtpMailer } from '../email/mailer.js'
import { loadPrivacyToolEnv } from '../env.js'
import { MembersService } from '../members/members.service.js'

const USAGE = `usage:
  privacy-request record (--email <address> | --handle <handle>) --kind <${PRIVACY_REQUEST_KINDS.join('|')}> [--notes <text>]
  privacy-request list [--overdue]
  privacy-request delete-account (--request <id> | --email <address> | --handle <handle>) [--now]
  privacy-request complete <id> [--refused] [--notes <text>]`

const { values, positionals } = parseArgs({
  options: {
    email: { type: 'string' },
    handle: { type: 'string' },
    kind: { type: 'string' },
    notes: { type: 'string' },
    request: { type: 'string' },
    overdue: { type: 'boolean' },
    now: { type: 'boolean' },
    refused: { type: 'boolean' },
  },
  allowPositionals: true,
})
const [command, id] = positionals

class UsageError extends Error {}

const env = loadPrivacyToolEnv()
const { db, pool } = createDb(env.DATABASE_URL)
const admin = new KratosAdmin(env)
const requests = new PrivacyRequestsService(db, env)
const day = (at: Date) => at.toISOString().slice(0, 10)

/** The account named by --handle, or by --email (asked of Kratos); null if none has that address. */
async function account(): Promise<{ id: string; handle: string } | null> {
  if (values.handle) {
    const handle = values.handle.replace(/^@/, '').toLowerCase()
    const [member] = await db.select({ id: members.id, handle: members.handle }).from(members).where(eq(members.handle, handle))
    if (!member) throw new UsageError(`no account has the handle @${handle}`)
    return member
  }
  if (values.email) {
    const identity = await admin.identityIdByEmail(values.email)
    if (!identity) return null
    const [member] = await db.select({ id: members.id, handle: members.handle }).from(members).where(eq(members.id, identity))
    return member ?? null
  }
  throw new UsageError('say whose request it is: --email <address> or --handle <handle>')
}

async function record() {
  const kind = values.kind as RequestKind
  if (!PRIVACY_REQUEST_KINDS.includes(kind)) throw new UsageError(`--kind must be one of ${PRIVACY_REQUEST_KINDS.join(', ')}`)
  const member = await account()
  const { id, dueBy } = await requests.record({ memberId: member?.id ?? null, kind, notes: values.notes })
  console.log(`recorded ${kind} request ${id}${member ? ` for @${member.handle}` : ', from an address no account has'}; due ${day(dueBy)}`)
  if (kind === 'deletion') console.log(`once they have confirmed it is them: privacy-request delete-account --request ${id}`)
}

async function list() {
  const now = new Date()
  const open = (await requests.open()).filter((r) => !values.overdue || r.dueBy < now)
  if (!open.length) return console.log(values.overdue ? 'No privacy requests are overdue.' : 'No open privacy requests.')
  for (const r of open) {
    const who = r.handle ? `@${r.handle}` : 'no account'
    console.log(`${r.id}  ${r.kind.padEnd(10)} ${r.status.padEnd(11)} ${r.channel.padEnd(12)} received ${day(r.receivedAt)}  due ${day(r.dueBy)}  ${who}${r.dueBy < now ? '  OVERDUE' : ''}`)
  }
}

async function deleteAccount() {
  const linked = values.request ? await requests.get(values.request) : null
  if (values.request && !linked) throw new UsageError('no privacy request has that ID')
  let member = values.handle || values.email ? await account() : null
  if (!member && linked?.memberId) {
    const [owner] = await db.select({ id: members.id, handle: members.handle }).from(members).where(eq(members.id, linked.memberId))
    member = owner ?? null
  }
  if (!member) throw new UsageError(values.email ? 'no account has that address' : 'say whose account it is: --email <address> or --handle <handle>')

  const addresses = new KratosAddresses(env.KRATOS_ADMIN_URL)
  const deletion = new AccountDeletionService(
    db,
    env,
    admin,
    addresses,
    { eraseFilesOf: () => Promise.reject(new Error('erasing runs in the API, not here')) },
    new MembersService(db),
    new EmailDeletionNotices(smtpMailer(env), addresses, env.WEB_PUBLIC_URL),
  )
  const { scheduledFor, alreadyRequested } = await deletion.request(member.id, { channel: 'email', immediate: values.now, requestId: values.request })
  if (alreadyRequested) console.log(`@${member.handle} was already waiting for deletion`)
  if (values.now) {
    // The API's worker erases it as soon as it picks this up, instead of within the hour.
    const jobs = new BullAccountJobs(env)
    try {
      await jobs.erase(member.id)
    } finally {
      await jobs.queue.close()
    }
    console.log(`@${member.handle} is off HeyNaija and queued for erasing now (member ${member.id})`)
  } else {
    console.log(`@${member.handle} is off HeyNaija and will be erased on ${day(scheduledFor)} (member ${member.id})`)
  }
}

async function complete() {
  if (!id) throw new UsageError('say which request: complete <id>')
  await requests.close(id, { refused: values.refused, notes: values.notes })
  console.log(`request ${id} ${values.refused ? 'refused' : 'completed'}`)
}

const commands: Record<string, () => Promise<void>> = { record, list, 'delete-account': deleteAccount, complete }
try {
  const run = commands[command ?? '']
  if (!run) throw new UsageError(USAGE)
  await run()
} catch (err) {
  // Never a database error's own message: it holds the query's parameters.
  console.error(err instanceof UsageError || err instanceof PrivacyRequestError ? err.message : failureReason(err))
  process.exitCode = 1
} finally {
  await pool.end()
}
