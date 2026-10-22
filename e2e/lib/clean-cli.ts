// pnpm --filter @heynaija/e2e clean: removes what end-to-end runs left behind.
// Waits for a run in progress, whose members it would otherwise remove.
import { cleanTestData } from './db.ts'
import { holdRunLock } from './lock.ts'

const release = await holdRunLock()
try {
  const removed = await cleanTestData((line) => console.log(line))
  console.log(removed ? `removed ${removed} test member(s)` : 'no end-to-end test data here')
} finally {
  await release()
}
