// Usage:
//   pnpm founder:grant <handle>   show the Founder badge on their profile and posts
//   pnpm founder:revoke <handle>
import { createDb } from '@heynaija/db'
import { MembersService } from '../members/members.service.js'

const [command, rawHandle] = process.argv.slice(2)
const handle = rawHandle?.replace(/^@/, '').toLowerCase()

if ((command !== 'grant' && command !== 'revoke') || !handle) {
  console.error('usage: founder <grant|revoke> <handle>')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const { db, pool } = createDb(url)
const members = new MembersService(db)
const on = command === 'grant'
try {
  const changed = await members.setFounder(handle, on)
  if (on) console.log(changed ? `@${handle} now has the Founder badge` : `@${handle} already has the Founder badge`)
  else console.log(changed ? `@${handle} no longer has the Founder badge` : `@${handle} did not have the Founder badge`)
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await pool.end()
}
