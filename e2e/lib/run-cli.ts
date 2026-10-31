// pnpm e2e [files] [Playwright options]: `playwright test`, one run at a time on
// this machine (lib/lock.ts), and outside CI only for the tests you name. The
// whole suite keeps every core busy for many minutes; CI runs it on every pull
// request. E2E_ALL=1 runs it here anyway.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { holdRunLock } from './lock.ts'

const args = process.argv.slice(2)

/** Options whose value is the next argument, so that value is not taken for a file. */
const TAKES_VALUE = new Set([
  '-c', '--config', '-j', '--workers', '--project', '--reporter', '--output', '--retries', '--repeat-each',
  '--timeout', '--global-timeout', '--max-failures', '--shard', '--trace', '--tsconfig', '--grep-invert',
])
/** Options that pick tests by themselves (or let you pick them, in --ui). */
const PICKS_TESTS = /^(-g|--grep|--last-failed|--only-changed|--ui)(=|$)/

const named = args.filter((arg, i) => !arg.startsWith('-') && !TAKES_VALUE.has(args[i - 1] ?? ''))
const picked = named.length > 0 || args.some((arg) => PICKS_TESTS.test(arg))

if (!picked && !process.env.CI && !process.env.E2E_ALL) {
  console.error(`pnpm e2e runs the whole suite only in CI. Name the tests for what you changed:

  pnpm e2e posting            one file (or several: pnpm e2e posting threads)
  pnpm e2e -g "bookmark"      tests whose title matches
  pnpm e2e --last-failed      what failed last time

The whole suite runs in CI on every pull request, and on any branch from
Actions → CI → Run workflow. To run it all here anyway: E2E_ALL=1 pnpm e2e`)
  process.exit(2)
}

// The Google tests restart Kratos, so their projects wait for the whole desktop
// and mobile suites, which naming any of their tests would then run too (`auth`
// also matches google-auth.spec.ts). A run that names tests leaves them out
// unless it names projects itself; pnpm e2e:google runs them on their own.
const projects = picked && !args.some((arg) => /^--project(=|$)/.test(arg)) ? ['--project=desktop', '--project=mobile'] : []
if (projects.length && named.some((name) => /google/i.test(name))) {
  console.error('The Google sign-in tests restart Kratos, so they run on their own: pnpm e2e:google')
  process.exit(2)
}

// Playwright's CLI script under this Node, as its bin shim runs it: on Windows the
// shim is playwright.cmd, which Node spawns only through a shell, and the shell
// would split arguments such as `-g "two words"` again.
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')

const release = await holdRunLock()
const playwright = spawn(process.execPath, [cli, 'test', ...args, ...projects], {
  stdio: 'inherit',
  // Tells global-setup.ts that this run already holds the lock.
  env: { ...process.env, E2E_RUN_LOCK: String(process.pid) },
})
// Ctrl-C in a terminal reaches Playwright too; it stops the run and reports, then exits.
process.on('SIGINT', () => {})
process.on('SIGTERM', () => playwright.kill('SIGTERM'))
const code = await new Promise<number>((resolve) => {
  playwright.on('error', (error) => {
    console.error(`could not start Playwright: ${error.message}`)
    resolve(1)
  })
  playwright.on('exit', (exitCode) => resolve(exitCode ?? 1))
})
await release()
process.exit(code)
