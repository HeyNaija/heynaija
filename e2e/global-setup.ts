import { apiCliBuilt } from './lib/cli.ts'
import { cleanTestData } from './lib/db.ts'
import { assertLocal, env } from './lib/env.ts'
import { mailpitUp } from './lib/mailpit.ts'

/** Checks the stack is the local one and ready, then clears what earlier runs left. */
export default async function globalSetup() {
  assertLocal()
  if (!(await mailpitUp())) throw new Error(`Mailpit is not answering at ${env.mailpitUrl}; run pnpm infra:up`)
  if (!apiCliBuilt()) throw new Error('the API is not built (apps/api/dist); run pnpm --filter @heynaija/api build')
  const removed = await cleanTestData()
  if (removed) console.log(`removed ${removed} member(s) left by earlier runs`)
}
