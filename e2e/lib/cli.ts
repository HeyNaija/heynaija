// The API's own command-line tools, run the way an operator would.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { MARK, root } from './env.ts'

const cli = (name: string) => `${root}apps/api/dist/cli/${name}.js`

export function apiCliBuilt() {
  return existsSync(cli('create-invite')) && existsSync(cli('moderator'))
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

/** Makes `handle` a site-wide moderator. */
export function grantModerator(handle: string) {
  run('moderator', ['grant', handle])
}
