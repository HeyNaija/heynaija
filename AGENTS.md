# Notes for coding agents

## End-to-end tests

The Playwright suite ([docs/e2e.md](docs/e2e.md)) drives real browsers against
the dev stack on this machine, shared with the people and other agents working
here, and the whole of it keeps every core busy for many minutes. So:

- Run the tests for what you changed: `pnpm e2e posting` (a file),
  `pnpm e2e -g "bookmark"` (titles), `pnpm e2e --last-failed`. `pnpm e2e` with
  nothing named refuses outside CI. The Google sign-in tests restart Kratos and
  run on their own: `pnpm e2e:google`.
- A new test that needs members uses `newMember` (or `signUpOverHttp`) from
  `e2e/lib/members.ts`, which skips the sign-up pages; only a test of signing up
  itself goes through them (`signUp`).
- Leave the whole suite to CI, which runs it on every pull request. For a branch
  with no pull request: `gh workflow run CI --ref <branch>`, then `gh run watch`.
  Run it here (`E2E_ALL=1 pnpm e2e`) only when asked to.
- Runs take turns. If `pnpm e2e` says it is waiting for another run, let it wait
  (up to 30 minutes); do not stop the other run or work around the lock. A run in
  the background still holds it, so do not start a second one meanwhile.
