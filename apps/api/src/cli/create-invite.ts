// Usage: pnpm invite:create [--uses 5] [--days 14] [--note "Lagos tech group"]
import { parseArgs } from 'node:util'
import { createDb } from '@heynaija/db'
import { InvitesService } from '../invites/invites.service.js'

const { values } = parseArgs({
  options: { uses: { type: 'string' }, days: { type: 'string' }, note: { type: 'string' } },
})

const maxUses = Number(values.uses ?? 1)
const days = values.days === undefined ? null : Number(values.days)
if (!Number.isInteger(maxUses) || maxUses < 1 || (days !== null && !(days > 0))) {
  console.error('--uses must be a whole number >= 1 and --days a number > 0')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const { db, pool } = createDb(url)
const code = await new InvitesService(db).create({
  maxUses,
  expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000),
  note: values.note ?? null,
})
await pool.end()

console.log(code)
console.error(`${maxUses} use(s), ${days === null ? 'no expiry' : `expires in ${days} day(s)`}. Shown once; it cannot be recovered.`)
