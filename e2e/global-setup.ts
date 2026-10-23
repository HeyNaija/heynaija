import { apiCliBuilt } from './lib/cli.ts'
import { cleanTestData } from './lib/db.ts'
import { assertLocal, env } from './lib/env.ts'
import { holdRunLock } from './lib/lock.ts'
import { mailpitUp } from './lib/mailpit.ts'

/** Checks the stack is the local one and ready, then clears what earlier runs left. */
export default async function globalSetup() {
  assertLocal()
  // pnpm e2e takes the lock before Playwright starts (lib/run-cli.ts); a bare
  // `playwright test` takes it here, before deleting anything.
  const release = process.env.E2E_RUN_LOCK ? undefined : await holdRunLock()
  if (!(await mailpitUp())) throw new Error(`Mailpit is not answering at ${env.mailpitUrl}; run pnpm infra:up`)
  if (!apiCliBuilt()) throw new Error('the API is not built (apps/api/dist); run pnpm --filter @heynaija/api build')
  const removed = await cleanTestData()
  if (removed) console.log(`removed ${removed} member(s) left by earlier runs`)
  return release
}
