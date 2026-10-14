// pnpm --filter @heynaija/e2e clean: removes what end-to-end runs left behind.
import { cleanTestData } from './db.ts'

const removed = await cleanTestData((line) => console.log(line))
console.log(removed ? `removed ${removed} test member(s)` : 'no end-to-end test data here')
