# Threaded conversations with bounded loading

**Status:** implemented in the workspace; migration `0013_threaded_replies` applied to local development.
**Date:** 15 October 2026
**Goal:** let members read and answer a conversation in place while reducing repeated page rendering and database work.

## Recommendation

Keep the existing post/reply graph and build connected, expandable branches on top of it. Show 20 direct replies on entry, load one additional branch page only on an explicit click, and use cursor pagination throughout. Keep chronological ordering, existing direct-reply counters and the current reply write path.

This is conversation threading: replies from different people stay connected to the posts they answer. A composer for publishing several connected posts at once is a separate feature and is outside this proposal.

Zero additional cost is not a realistic promise. The composite index consumes storage and adds maintenance work, and each opened branch requires a request. The expected gain is less work per initial view and less repeated shell rendering while exploring a conversation. Measure the same completed reading journey before and after implementation.

## What exists today

The current code is the source of truth; some architecture and performance documents describe earlier implementations.

| Existing behavior | Evidence | Consequence |
| --- | --- | --- |
| Every reply has an immediate parent and a conversation root. | `packages/db/src/schema.ts:132`; `apps/api/src/posts/posts.service.ts:403` and `:433` | No thread table, graph backfill or new root lookup is needed to create a reply. |
| The detail API returns focus, up to 50 ancestors, and up to 200 direct replies. | `apps/api/src/posts/posts.service.ts:105` and `:357` | Large initial responses; no cursor for reply 201; grandchildren require another detail view. |
| Earlier context is collapsed and direct replies are a flat list. | `apps/web/app/(main)/p/[id]/page.tsx:36` | The relationship exists in storage but is hard to follow visually. Collapsing already-fetched context saves no database work. |
| Reply bodies and reply buttons open another post page. | `apps/web/app/ui/post-item.tsx:143` and `:155` | Exploring a branch repeats page and context work. |
| Successful posting refreshes the current route. | `apps/web/app/actions.ts:46` | In-place replying requires a separate success path to retain expanded branches. |
| Stored counters represent live, active members' direct replies. | `packages/db/drizzle/0011_post_counters.sql:46` | Keep them; an all-descendant counter would add writes and root-row contention. |

Currently the post service executes three SQL statements for a root detail and four for a reply detail, excluding session handling and the web shell. Images and viewer relationships use SQL subqueries within hydration, rather than separate application calls for every post. Rendering 200 replies still amplifies that work and the response size.

## Reference patterns

These are documented public behaviors and API contracts, not measurements of the other applications' infrastructure.

| Reference | Observed pattern | Application to HeyNaija |
| --- | --- | --- |
| [X thread display](https://help.x.com/en/using-x/create-a-thread) | Connected posts use a line; longer bundles have a disclosure to see more. X uses “thread” here for several posts by one author. | Use clear visual connections and deliberate expansion for conversations; defer a multi-post authoring composer. |
| [X conversations](https://help.x.com/en/using-x/x-conversations?lang=browser) | Replies are grouped into sub-conversations; reply counts represent direct replies. Ranking uses additional signals. | Keep branches and direct-count semantics. Start with chronological order rather than personalized ranking. |
| [Threads reply controls](https://about.fb.com/news/2025/03/new-threads-features-more-personalized-experience-you-control/) | Conversation controls include reply approvals and filters. | Expansion must preserve HeyNaija's existing moderation and viewer visibility rules. New approvals and filters are separate scope. |
| [Bluesky thread API contract](https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/app/bsky/feed/getPostThread.json) | Parent context and descendant depth are separate parameters; responses distinguish unavailable and blocked posts. | Treat context and branches separately. Use explicit, much smaller HeyNaija budgets rather than copying its defaults. |

The HeyNaija recommendation is an engineering inference from these patterns and the current repository, not evidence that another app uses this database design.

## Member experience

1. **Open a conversation.** Keep `/p/[id]` as the permanent entry point. Show the focused post and its direct replies in the existing typography, surfaces, spacing and theme tokens. Connect related rows with a subtle vertical line. Make the immediate parent visible when opening a reply permalink; older context can sit behind “Earlier conversation.”
2. **Expand a branch.** A reply with children has a separate “View replies” control. Clicking it loads and inserts that reply's first child page directly underneath. “More replies” continues only that sibling list. Collapse and immediate re-expansion use already-loaded state.
3. **Answer the right person.** “Reply” opens one active editor at the selected row, labeled “Replying to @handle.” The editor submits that row's ID as `replyTo`. Keep drafts through expansion and errors; changing the reply target must be explicit. Do not mount a composer for every post.
4. **Keep reading on a phone.** Cap indentation at one step on small screens and two on desktop. Deeper rows name their immediate parent rather than repeatedly narrowing the text column. Use semantic lists, accessible button names, expanded/loading states and the existing mobile target sizes.
5. **Keep links useful.** Timestamps retain their permalinks and existing `#post-{id}` anchors. Notifications keep their current targets. A deeply nested permalink starts with that post and bounded parent context, so it never needs to reconstruct every branch from the root.
6. **Respect chronology.** Continue the current oldest-first order. *(Since 25 October 2026, [ADR 0013](../adr/0013-reply-order.md): the replied-to post's author's replies come first, then everyone else's, newest first by default with a switch to oldest first. The gap handling below still applies.)* If a new reply is newer than an incomplete loaded page, show it in a separate “Your reply” position with the gap made clear. Keep the page cursor unchanged and deduplicate by ID when pagination reaches it. Append normally only when the sibling list is complete.

A reply badge remains a direct-reply count, not the size of the whole conversation or an exact viewer-visible total. Existing counters include replies hidden by an individual member's blocks/mutes. A thread-only `hasReplies` structural hint keeps live rows expandable when their only children are unavailable intermediates and the direct live count is zero. A branch may still open with no available replies; show a neutral empty state and hide its expansion control for that loaded state.

## API and query design

### Initial detail

Extend the existing `GET /v1/posts/:id` envelope with a reply cursor. Return the focused post, its bounded ancestors, and the first page of direct replies. Keep the existing 50-ancestor hard limit for this first release; do not expand ancestor siblings. Expose an accurate truncation indication when the chain exceeds the cap, with an earlier-post permalink for continuing context. Never label the nearest *visible* ancestor as the immediate recipient if hidden nodes create a gap.

The initial reply page contains at most 20 display nodes, including structural placeholders where necessary. Query up to 21 eligible nodes to determine whether another page exists. A root view has no ancestor content to fetch and should skip the recursive ancestor query entirely.

### Branch expansion

Add `GET /v1/posts/:id/replies?cursor=...&limit=20`, with a server-enforced maximum of 20 for this feature. Return flat display nodes carrying `replyParentId` and a nullable next cursor. A small web server action can call this endpoint and return rendered row fragments, following the existing feed-action pattern while keeping `PostItem` a server component. Expansion never calls the full thread endpoint or re-renders the shell.

Authorize the parent on every request, then select only its immediate children using the shared visibility policy. Target at most two post-related SQL statements: a minimal parent check and a paginated child/hydration query. Existing session/member checks remain additional work. Do not add an API request or application query for each child row.

Use ascending keyset pagination by `(created_at, id)` (since [ADR 0013](../adr/0013-reply-order.md), within each of two groups, in either direction):

```sql
-- Ordering skeleton only; real SQL must also enforce viewer visibility,
-- structural-placeholder eligibility and redacted serialization.
WHERE reply_parent_id = :parent_id
  AND (created_at, id) > (:exact_cursor_timestamp, :cursor_id)
ORDER BY created_at ASC, id ASC
LIMIT 21
```

Omit the tuple comparison on the first page. Obtain the next cursor from the last returned server page row, never from a locally inserted reply or the global reply count. Validate cursor size, version, timestamp, UUID, ordering and parent scope. A cursor is a position, never authorization. Preserve timestamp precision across PostgreSQL, cursor encoding and comparison: the existing helper round-trips through JavaScript `Date` and loses database microseconds. Reusing it unchanged for ascending pagination can repeat or skip rows.

### Index

Add a B-tree on `(reply_parent_id, created_at, id)` covering live and soft-deleted replies. A live-only partial index would not support the mixed live/placeholder list. Restricting an index to `reply_parent_id IS NOT NULL` is an optional measured storage optimization, not a requirement. Retire the old parent-only index only after checking all affected query plans; do not assume its other uses are redundant.

PostgreSQL documents that a matching [ordering index](https://www.postgresql.org/docs/current/indexes-ordering.html) can avoid sorting all matching rows before a limit, while large [offsets](https://www.postgresql.org/docs/current/queries-limit.html) still require computing skipped rows. The composite is intended to make early and late reply pages seekable.

**A limit bounds output and hydration, not all rows examined.** Many blocked, muted, inactive or ineligible deleted authors/nodes can still force a longer scan. Benchmark those distributions. If those scans violate the budget, introduce a bounded candidate window with explicit continuation semantics; never fill a page through an unbounded server retry loop or silently truncate accessible replies.

### Writes and new replies

Preserve reply creation's parent validation, root/community inheritance, rate limit, image rules and notification to the immediate parent author. Preserve trigger-maintained direct counts. Do not update every ancestor, add a root activity/count write, or notify everyone in the conversation.

Add a reply-specific web action success path that returns a bounded hydration/render of the confirmed new post. The current `{id}` create API can stay compatible: a single-post hydration can happen in the reply response service or through a lightweight single-post read. Do not use a second full-thread fetch. Return the confirmed row and an updated direct-parent count if convenient; do not promise a count snapshot immune to concurrent writes.

The browser inserts the confirmed row, reconciles its local parent count and preserves expanded branches and pagination. Failed submissions retain the draft. The ordinary feed composer may retain its current refresh behavior; the reply path must avoid it.

## Deleted posts and visibility

Preserve a conversation's surviving branches without showing deleted content:

- Admit a soft-deleted/moderated intermediate node as a generic “This post is no longer available” placeholder only when an indexed `EXISTS` finds any direct structural child. Check all children, including deleted ones; using the live direct count alone breaks chains of consecutive deleted nodes.
- Omit deleted leaf nodes. A placeholder response contains only structural identifiers, its ordering key and expansion status; no author metadata, text, images, likes or numeric reply count. Do not fully hydrate unavailable content and rely on the browser to hide it.
- Apply the same active-author/block/mute eligibility before admitting a node or reading its branch. Expandable placeholders do not override the member's visibility rules. Descendants behind an excluded author remain reachable through their own eligible permalinks, consistent with the current filtering policy.
- Permit branch reads through an eligible soft-deleted parent; continue to forbid creating a reply to it. Keep a directly opened deleted root's focus URL unavailable in this first release, as today. Existing living descendant permalinks retain redacted ancestor context.
- A placeholder's structural child can itself be hidden or an omitted deleted leaf. Empty expansion is valid. The placeholder discloses only that structural continuation exists, comparable to the existing global-count hint; it must never identify the hidden child.

The child-existence check is an indexed SQL probe, not a recursive descendant traversal or an application N+1 query. Include its cost in deleted-heavy benchmarks.

## Browser and cache budgets

| Action | Budget/behavior |
| --- | --- |
| Initial view | One focus, at most 50 ancestors, at most 20 direct reply nodes; zero automatically loaded descendant branches. |
| Expand or load more | One user-triggered web request, one child-page API call, at most 20 display nodes. |
| Collapse | No request. |
| Reopen a retained branch | No request until explicit refresh/invalidation. |
| Post a reply | Existing write plus one bounded post hydration; no whole-route refresh. |
| Idle thread | No polling, subscriptions, ranking refresh or automatic branch prefetch. |

Deduplicate requests for the same parent/cursor and disable repeated loading while pending. Ignore stale responses after navigation or invalidation. Key retained data by viewer, focused post, parent and cursor, and clear it on account or visibility changes. Do not share personalized thread JSON across users: it contains viewer like/bookmark state and filtered content.

Keep existing `prefetch={false}`, lazy images, optimistic likes and offscreen rendering containment. Do not mount feed intersection observers inside branches: many observers could produce automatic cascading loads. Use a bounded cache for collapsed branches, for example 200 nodes with least-recently-used eviction; never evict a draft. Cap recursively expanded UI depth at three levels below the post in focus (`THREAD_MAX_DEPTH`; it was six until 26 October 2026, when it proved too narrow on a phone), and provide an ordinary “Continue conversation” permalink beyond that. A reply at the cap is answered on its own page, never in place, because it would not be drawn there. A deleted post has no page to continue to, so it may open up to six levels further (`THREAD_MAX_GAPS`) to keep the replies behind it reachable. The data model remains unrestricted in depth. Profile very long actively expanded lists before adding virtualization.

## Implementation order

1. Add the composite index, exact-precision reply cursor and shared paginated reply reader, including placeholder/visibility rules. Extend focused detail with the first-page cursor and skip the ancestor query for roots.
2. Add branch loading and connected rows to the existing page, preserving server-rendered content, deep links and native navigation fallback.
3. Add the single targeted editor and confirmed-reply insertion path; preserve chronology gaps and invalidate state on deletion/block/mute.
4. Exercise correctness and run the same production-build conversation journeys before and after. Ship pagination and inline expansion together so the visible improvement has a measured read budget.

No schema backfill, root index, closure table, path arrays, Redis thread cache or new worker is required for this release.

## Verification and release criteria

Extend the existing `loadtest/` kit. Its seed and journeys currently cover one-level replies and root detail pages, so they cannot establish nested-thread performance.

Use a throwaway environment, never staging or production. Test a normal conversation, a parent with 10,000–100,000 replies, a chain longer than 50 ancestors, deleted intermediates (including consecutive deletions), heavy block/mute filtering and concurrent writes to one popular parent.

Correctness tests must cover exact timestamp ties and different microseconds within a millisecond, malformed/cross-parent cursors, pagination during insertion/deletion/restoration/suspension, no visible replies despite a positive count, duplicate expansion clicks, navigation during a request, reply deduplication and draft retention. Check the existing notification links and mobile layout. A visited-ID guard and existing server recursion cap defend reads from malformed graph cycles.

Use `EXPLAIN (ANALYZE, BUFFERS)` on early and late pages to confirm the intended index seek and absence of a sibling-wide sort/offset scan. Measure filtered and deleted-heavy plans separately. Verify at most four post-service statements for initial detail, two for expansion, and no per-row application round trips; fewer statements are preferable where context is absent.

Compare API and web CPU, database execution time/buffers, response bytes, p95 latency, completed journeys, errors and parent-row lock waits. Keep the existing production-build p95 target below 300 ms and errors below 1% at the supported rate, with per-route results and no dropped k6 iterations. Report 429s separately from successful writes. Preserve feed and posting performance under the same mixed workload.

For a wide root the proposed first reply batch falls from 200 to 20 returned nodes (90% fewer reply rows on first paint); this is not a claim of 90% less total CPU or database time. Additional branch reads and index maintenance must be counted. Existing direct-parent counters can still contend on a viral parent; avoiding new root-wide writes prevents adding another shared hotspot, but does not remove the current one.

## Implementation measurements

The implementation adds the branch and single-post endpoints, exact-precision cursors, redacted structural nodes, a composite reply index and server-rendered rows controlled by the client conversation coordinator. The reply composer returns a confirmed row without refreshing the route. Test fixtures and focused k6 journeys are documented in [loadtest-threads.md](../loadtest-threads.md).

On 15 October 2026, a temporary local fixture contained 10,000 root replies and a 1,000-reply child branch. The previous repository revision's post service and the new service were loaded in one Node process against the same database/indexes. Each journey opened the root and the first child branch; the old reader hydrated up to 200 replies at each position, while the new reader returned 20 at each. One warmup and 15 sequential measured journeys per version produced:

| Measurement | Previous reader | Thread reader |
| --- | --- | --- |
| Returned reply rows per journey | 400 | 40 |
| Serialized JSON bytes per journey | 171,094 | 18,553 |
| Median service + serialization time | 16.00 ms | 8.73 ms |
| Sample p95 | 36.76 ms | 13.78 ms |

These are small, warm local service measurements, not production capacity, HTTP wire-compression or total web-render CPU results. Both versions used the new index, so the comparison isolates the changed read behavior. The earlier development hot-reload run was discarded. Do not extrapolate the latency ratio to other hardware, users or thread shapes.

`EXPLAIN (ANALYZE, BUFFERS)` on the actual new branch query selected `posts_reply_parent_created_idx` for both the first page and a cursor after reply 9,000. Each parent index scan returned 21 rows with zero rows removed by the filter; total query execution was approximately 0.37 ms and 0.32 ms respectively. Small media subqueries still have their own work. Heavy viewer filtering and hot-parent write capacity require separate production-sized measurements.

The focused local k6 smoke covered mixed reads, deleted chains and early/late pages with zero HTTP failures or dropped iterations. Temporary load-test fixtures were removed without deleting the pre-existing load-test seed. The implementation includes scratch-database tests for query budgets, cursor precision, visibility changes, deleted chains and ancestor limits, plus browser tests for pagination, repeated targeted replies, draft retention and mobile layout.

Final validation passed: the full production build succeeded after regenerating stale `.next` output; API tests passed 151/151 and web tests passed 13/13. The focused thread/posting browser run against the production build passed 12 tests, with one mobile-only case skipped on desktop. A separate production-build image posting/viewer test also passed. These checks establish build and behavior correctness; production capacity and hot-parent write throughput remain unmeasured.
