// Usage:
//   pnpm mod:grant <handle>                    make a site-wide moderator
//   pnpm mod:grant <handle> --community lagos  make a moderator of one community
//   pnpm mod:revoke <handle> [--community lagos]
import { parseArgs } from 'node:util'
import { createDb } from '@heynaija/db'
import { ModerationService } from '../moderation/moderation.service.js'

const { values, positionals } = parseArgs({
  options: { community: { type: 'string' } },
  allowPositionals: true,
})
const [command, rawHandle] = positionals
const handle = rawHandle?.replace(/^@/, '').toLowerCase()

if ((command !== 'grant' && command !== 'revoke') || !handle) {
  console.error('usage: moderator <grant|revoke> <handle> [--community <slug>]')
  process.exit(1)
}

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const { db, pool } = createDb(url)
const moderation = new ModerationService(db)
const on = command === 'grant'
try {
  if (values.community) await moderation.setCommunityModerator(handle, values.community, on)
  else await moderation.setSiteModerator(handle, on)
  const where = values.community ? `the "${values.community}" community` : 'the whole site'
  console.log(on ? `@${handle} now moderates ${where}` : `@${handle} no longer moderates ${where}`)
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
} finally {
  await pool.end()
}
