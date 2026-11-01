// The API's own command-line tools, run the way an operator would.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { MARK, root } from './env.ts'

const cli = (name: string) => `${root}apps/api/dist/cli/${name}.js`

export function apiCliBuilt() {
  return existsSync(cli('create-invite')) && existsSync(cli('moderator')) && existsSync(cli('founder')) && existsSync(cli('privacy-request'))
}

function run(name: string, args: string[]) {
  // The child reads DATABASE_URL from the process environment (loaded from .env by env.ts).
  return execFileSync(process.execPath, [cli(name), ...args], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** A fresh single-use invite code. */
export function createInvite(uses = 1): string {
  const code = run('create-invite', ['--uses', String(uses), '--note', MARK.inviteNote])
  if (!/^HN-/.test(code)) throw new Error(`create-invite printed ${JSON.stringify(code)}`)
  return code
}

/** Makes `handle` a site-wide moderator, or with `community` (a slug) a moderator of that community. */
export function grantModerator(handle: string, community?: string) {
  run('moderator', ['grant', handle, ...(community ? ['--community', community] : [])])
}

/** Gives `handle` the Founder badge, or with `on` false takes it away. */
export function setFounder(handle: string, on = true) {
  run('founder', [on ? 'grant' : 'revoke', handle])
}

/**
 * Records a deletion request for `handle` and erases the account now, as an
 * operator would once the person has confirmed it is them. The running API's
 * worker does the erasing within seconds. The request carries the e2e mark, so
 * cleaning can still find the member once their handle and identity are gone.
 */
export function eraseNow(handle: string): { requestId: string; memberId: string } {
  const recorded = run('privacy-request', ['record', '--handle', handle, '--kind', 'deletion', '--notes', MARK.inviteNote])
  const requestId = recorded.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0]
  if (!requestId) throw new Error(`privacy-request record printed ${JSON.stringify(recorded)}`)
  const queued = run('privacy-request', ['delete-account', '--request', requestId, '--now'])
  const memberId = queued.match(/\(member ([0-9a-f-]{36})\)/)?.[1]
  if (!memberId) throw new Error(`privacy-request delete-account printed ${JSON.stringify(queued)}`)
  return { requestId, memberId }
}
