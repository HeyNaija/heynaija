# Conversation thread benchmarks

The optional thread fixtures and focused k6 journeys extend the existing
[throwaway load-test kit](loadtest.md). They do not enlarge the default seed.
Use a production web build for timing; never run them against staging or
production. The fixture seeder uses the same database safety guard as the
ordinary seed and clean scripts.

## Prepare a disposable stack

After migrating the app and running the normal seed/session steps, add fixtures:

```bash
pnpm --filter @heynaija/loadtest thread-fixtures --dry-run
pnpm --filter @heynaija/loadtest thread-fixtures --wide=10000
```

Set `BASE_URL` to the test web app before creating the fixtures. The generated
`loadtest/.threads.json` contains public fixture identifiers, the expected web
URL, the filtering viewer's handle and an exact-precision late-page cursor. It
contains no session cookies. The filtering viewer is the first seeded
Kratos-backed member; its session must be in `.sessions.json`.

Fixtures include four connected reading positions, each with 200 direct
siblings; a wide parent; a 65-reply chain; a parent whose replies are 90% hidden
from the designated viewer by mutes, blocks in both directions and inactive
authors; exact timestamp ties and different microseconds in one millisecond;
consecutive deleted/removed intermediates with a surviving child; a deleted
root with a live descendant; and a separate hot parent for writes.

For the larger wide-parent case, start from the snapshot before fixtures (or
clean and seed again), then use `--wide=100000`. `--depth` accepts 51–1000 and
`--filtered` accepts 40–100000. Fixtures refuse a second install. All fixture
authors and posts enter the existing cleanup tracking; the normal `clean`
command removes the fixture table, `.threads.json` and posts created by k6 too.
The four extra filtering members have no Kratos identities.

## Run focused journeys

Run from `loadtest/` with k6:

```bash
k6 run -e CASE=mixed -e RATE=2 -e DURATION=30s k6/threads.js
k6 run -e CASE=journey -e RATE=10 -e DURATION=3m --out json=results/thread-reading.json k6/threads.js
k6 run -e CASE=wide -e RATE=10 -e DURATION=3m --out json=results/thread-wide.json k6/threads.js
k6 run -e CASE=hot -e RATE=10 -e DURATION=3m --out json=results/thread-hot.json k6/threads.js
```

Create `results/` before using `--out`. `CASE` can also be `deep`, `filtered`,
`deleted` or `ties`. The default `mixed` case reads all these shapes and performs
no writes; `hot` explicitly posts every iteration to one parent. Increase rates
in separate runs to find capacity, then hold the supported rate for longer.
For a correctness smoke test against `next dev`, use a generous `P95_MS` such
as `10000`; those timings do not establish production capacity.

`RATE` is **journeys per second**, not requests per second. The four-position
reading journey makes four requests; the wide case makes two (first and 90%-late
pages); timestamp-tie verification makes four; other cases differ. Use k6's
`http_reqs` for the actual front-door request rate. The `name`, `case` and `mode`
tags distinguish routes and journey types in JSON output; `phase:run` excludes
setup warmups from latency/error thresholds. The late cursor is
created once during fixture seeding, so setup does not walk thousands of pages.

When a separate load generator reaches the test web app at another URL, set
both `BASE_URL` and `LOADTEST_THROWAWAY_BASE_URL` to that exact URL. Set `ORIGIN`
to the app's configured public origin if it differs. The script rejects URLs
containing production, staging or live environment names. Copy `.threads.json`
alongside `.sessions.json` to the load generator; protect the session file.

## Compare the same reading journey

Use the same seeded database snapshot, sessions, server sizing, production-build
settings and journey rate before and after. Keep the new load-test runner
available while the server runs each revision:

```bash
# Server runs the old flat-card revision.
k6 run -e CASE=journey -e MODE=legacy -e RATE=10 -e DURATION=3m --out json=results/thread-before.json k6/threads.js
# Server runs the thread revision against the same fixture snapshot.
k6 run -e CASE=journey -e MODE=threads -e RATE=10 -e DURATION=3m --out json=results/thread-after.json k6/threads.js
```

Both visit the same four connected conversation positions. Legacy mode requests
four `/p/:id` pages, as clicking the old cards does. Thread mode requests the
initial page and three bounded reply pages through `/api`. Compare
`completed_journeys`, `journey_duration`, `journey_body_bytes`, request counts,
server CPU and database execution time for equal completed work. Running both
modes against the new server compares navigation with expansion; it is not a
measurement of the old 200-reply implementation.

The reply-page requests model API loading through the web proxy. They do not
execute browser rendering, the branch server action's row rendering, collapse
caching or composer interactions. Use the browser/e2e checks and profiling for
those costs. Body-byte metrics measure uncompressed UTF-8 response bodies;
`data_received` includes actual transfer overhead and compression.

## Acceptance and diagnosis

The script checks p95 request latency below 300 ms (override with `P95_MS`),
errors below 1%, correctness checks above 99% and zero dropped iterations.
It checks capped/truncated deep context, filtered authors, traversable redacted
intermediates, omitted deleted leaves, surviving descendant permalinks and
timestamp pagination covering all 80 replies exactly once. Confirm no material
feed/posting regression with the original mixed `journeys.js` workload too.
Use `DEBUG=1` to log unexpected status codes without printing cookies or bodies.

Hot writes report `successful_writes`, `write_completion` and `rate_limited`.
A 429 is an expected throttle response, but never increments successful writes
or completed journeys. A latency pass dominated by 429s is not write capacity:
mint enough distinct sessions, reduce per-member traffic and compare actual
successful throughput. Watch parent-row lock waits and database pool queues
using the queries in [the main load-test guide](loadtest.md#on-the-server-while-it-runs).

Use `EXPLAIN (ANALYZE, BUFFERS)` on the actual reply query for the wide parent's
first and late cursor positions. Require the parent/time/ID index seek without
a sibling-wide sort or offset scan. Repeat with the filtered and deleted
fixtures: output limits do not bound all candidates examined. Compare
`pg_stat_statements` execution time and buffers, API/web CPU, p95/p99 latency,
payload and completed journeys at the same load. The fixture's one-time `OFFSET`
only chooses the benchmark anchor during seeding; application paging must seek.

The fixture script and k6 configuration can be validated without connecting:

```bash
node --check thread-fixtures.mjs
node thread-fixtures.mjs --wide=100000 --dry-run
k6 inspect k6/threads.js
```

`k6 inspect` requires existing fixture/session JSON files, but sends no requests.
Large-scale capacity remains unmeasured until these runs execute on the intended
disposable production-sized server.

Validated on 15 October 2026 against the local dev stack: syntax checks, a
100000-reply dry run, k6 configuration inspection, fixture insertion with
`--wide=40 --depth=51 --filtered=40`, and low-rate mixed, deleted-chain and
first/late-page correctness runs. The final runs passed all checks with zero
HTTP failures and dropped iterations. The temporary 1027 posts and four members
were removed afterward while preserving the existing seed and sessions. These
small `next dev` runs used `P95_MS=10000` and establish correctness only; wide
10000/100000-parent, hot-write and old-revision comparisons have not been run.
