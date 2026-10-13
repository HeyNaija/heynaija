# Nigeria-first, community-owned social network
## Revised Phase 1 technical and infrastructure plan — v2.0

> **Architecture superseded (13 October 2026).** The AT Protocol / self-hosted PDS design below was dropped after the Phase 0 spike in favour of a conventional stack with Ory Kratos for identity. See [docs/adr/0002-conventional-stack-with-kratos.md](docs/adr/0002-conventional-stack-with-kratos.md). The product hypothesis, feature scope, safety, governance and metrics sections still stand.

**Date:** 13 October 2026  
**Status:** Proposed, ready for implementation  
**Strategy:** Self-host AT Protocol accounts and social data from the start; ship a focused invite-only web beta; validate retention before expanding infrastructure.  
**Indicative target:** 4–6 weeks to a controlled beta, **subject to the technical spike and launch gates**. The target is not a delivery guarantee.  
**Initial cohort:** Up to 200 invited users, recruited into 3–5 active communities; Nigeria-first and open to the diaspora.  
**Core principle:** No dependence on a proprietary social-data database, no Next.js monolithic backend, no premature microservices.

---

## 0. Decisions at a glance

| Question | Decision for Phase 1 | Rationale |
|---|---|---|
| Where are user accounts and posts hosted? | **Our self-hosted AT Protocol PDS** | Control of the account-hosting service; interoperable repositories |
| Do we host a relay? | **No, not initially** | Our PDS provides its own repo event stream; global aggregation is unnecessary for a local-only first feed |
| Do we need an App View? | **Yes: a small custom, community-scoped App View/read model** | A PDS stores records but does not provide rich timelines, thread hydration, counts, and discovery on its own |
| Who runs the App View? | **Our NestJS service + indexer + PostgreSQL** | Clear business logic, controlled database and scalability |
| How is data indexed? | **PDS firehose -> sync/index worker -> PostgreSQL** to start | Minimal moving parts; later evaluate Tap and external relays for cross-PDS discovery |
| How do members sign in? | **AT Protocol OAuth**; secure server-side sessions | No separate user password database in our app; our PDS handles new-account creation and recovery |
| Frontend? | **Next.js + TypeScript, PWA** | Fast mobile-first development, SSR and discoverability |
| Backend? | **NestJS + Fastify** | Dedicated API, versioned interfaces, separate scaling/deployment |
| Queue/cache? | **Redis + BullMQ** for non-critical async jobs, cache where measured | Worker scalability; durable source of truth remains in Postgres/PDS |
| Databases? | **PDS-managed SQLite + PostgreSQL for App View and platform data** | Do not force all AT records into the app database |
| Deploy? | **Two isolated VPS instances + object storage**, initially Docker Compose | Low operational cost and workload separation |
| Governance? | Publish an open charter; form a provisional steering group; create enforceable member ownership through legal review | Publishing source code does not itself establish community ownership |
| Interoperability? | Use standard `app.bsky.*` records for social interactions | Easier support from ecosystem clients and future migration |

**Important:** Self-hosted PDS ≠ total independence from the wider AT ecosystem. Federation and default DID/identity resolution may rely on external PLC directory, other relays and their policies. We will explicitly document and test those dependencies; our own feed must remain usable if an external relay is unavailable.

---

## 1. Product hypothesis and first audience

**Hypothesis:** Nigerians will repeatedly use a fast, locally relevant discussion network if it hosts useful communities, provides fair moderation, and gives members a meaningful stake in its governance.

**Launch audience:** Students, early-career professionals, technologists, local organisers and creators. Recruit *real people* in a few interest clusters rather than attempting a national-scale launch on day one.

**Differentiators:**
1. Nigeria-first topics, communities and editorial discovery.
2. Open-source code, community-influenced moderation, public financial/governance updates.
3. AT Protocol identities and portable public social records.
4. Low-bandwidth, accessible Android-first web experience.
5. Community discovery rather than opaque engagement maximisation.

**Non-goals in Phase 1:** Native apps; DMs; video; payment/creator revenue; AI recommendations; proprietary social graph; elections/voting on individual moderation decisions; full Bluesky-network indexing; local large relay; Kafka; Kubernetes; geographic geofencing.

**Privacy clarification:** Phase 1 communities are discovery/feed groupings, **not private groups**. Public AT posts can be accessed and redistributed outside our application. Every new member must be informed of this before their first post.

---

## 2. System architecture

```text
                          Browser / Next.js PWA
                                  |
                      Cloudflare (optional CDN/WAF)
                                  |
                         Reverse proxy / TLS
                          /                    \
                      Web                      NestJS API (stateless)
                                                 |
                        +------------------------+-----------------------+
                        |                        |                       |
                    PostgreSQL                Redis                 AT OAuth
                (our read model,       (cache / BullMQ)          -> our PDS
                 communities, safety,                                   |
                 analytics, sessions)                                PDS-managed
                        ^                                            repositories,
                        |                                            identity, blobs
                Indexer / sync worker                                   |
                        ^                                            SQLite / S3
                        |                                               |
                  PDS firehose <---------------------------------------+
                  (subscribeRepos)

              Optional later: third-party relay / Tap -> our indexer
              Optional later: Ozone labeler -> moderation label updates
```

### 2.1 Record ownership and data boundaries

**PDS owns:** DID/account repository; canonical public profile, posts, replies, follows, likes and reposts; blob references; handle and account settings supported by the PDS.

**NestJS/PostgreSQL owns:** community catalogue and joining preferences; content-to-community association; local App View read models; safety reports and decisions; invite tracking; app sessions/consent records; first-party engagement metrics; governance metadata.

**Redis owns only derived/replaceable state** such as cached feeds, rate-limit counters and job coordination. No irreplaceable user content should exist only in Redis.

**Key identifiers:** DID for account; AT URI and CID for records. Never make handle or mutable username the primary key. Preserve record revisions and tombstones to reconcile updates, deletes, deactivation and migration.

### 2.2 Post write and read flow

1. Member opens the Next.js app, which authenticates against our PDS using AT Protocol OAuth.
2. NestJS keeps the OAuth session securely on the server and provides an HttpOnly secure browser session. The browser never stores long-lived PDS credentials in local storage.
3. The write is made via authorised PDS XRPC, using standard Lexicons where possible (`app.bsky.feed.post`, `.like`, `.repost`, `app.bsky.graph.follow`, `app.bsky.actor.profile`).
4. PDS commits the signed repository update and emits a repo event.
5. A dedicated indexer consumes local `com.atproto.sync.subscribeRepos`, verifies/normalises records as appropriate, and upserts a local read model; it uses persisted sequence/cursor and idempotent event handling.
6. NestJS serves paginated timelines, profile views, thread context, community feeds and counts. It applies moderation, blocks/mutes, permission and visibility rules on reads.
7. Redis caches hot paths where measured. Workers handle notifications, refreshes, counters and retries asynchronously.

**Eventual consistency:** The author sees a successful post immediately (optimistic UI plus authoritative PDS confirmation); other feeds can have a short indexing delay. Track indexing lag explicitly, handle out-of-order/delete events, and reconcile with repo backfill after outages.

### 2.3 Federation choices

**Phase 1:** Register accounts on our PDS; show activity from people whose records we index. Optionally allow existing AT accounts after a verified cross-PDS read/write and indexer test. The initial public experience must work even with only locally hosted members.

**Phase 2:** Broaden discovery by consuming relays and using **Tap** to track selected external DIDs and backfill missing records. Tap is still described as beta by its maintainers; test operational suitability before making it mission-critical.

**Phase 3:** Evaluate a self-hosted *scoped relay* when ingesting multiple PDS hosts at scale makes it worthwhile. A full-network relay/global App View is a separate, much larger infrastructure project and not required to run our own social app.

**Architecture spike requirement:** Validate whether our exact Tap version can consume a direct PDS stream. If not, use the documented PDS firehose endpoint with our own minimal consumer for Phase 1, then adopt Tap against a supported relay source in Phase 2. Do not assume Tap obviates every relay or data verification requirement.

---

## 3. Stack and repository

| Area | Stack |
|---|---|
| Web | Next.js, TypeScript, Tailwind CSS, accessible UI components; installable PWA |
| Public API | NestJS + Fastify; DTO validation, OpenAPI contracts |
| Database | PostgreSQL + Prisma (or Drizzle if chosen by spike; choose one, not both) |
| Queue/cache | Redis + BullMQ |
| AT Protocol | Official PDS distribution; `@atproto/api`, official OAuth client, Lexicon types |
| Indexer | Standalone TypeScript worker reading PDS firehose; durable offsets in PostgreSQL |
| Media | PDS configured for S3-compatible blob storage after compatibility test; not managed through the Next.js server |
| Observability | Structured logs, metrics, uptime checks, error tracking, basic dashboards |
| Build/deploy | pnpm workspaces, Docker Compose, GitHub Actions, environment-specific secret storage |
| Future | Tap, Ozone, dedicated feed service, distributed PDS fleet, dedicated search |

```text
network/
├── apps/
│   ├── web/                    # Next.js, frontend only + SSR integration
│   ├── api/                    # NestJS public API and OAuth server endpoints
│   ├── indexer/                # PDS event ingestion and backfill
│   └── worker/                 # BullMQ asynchronous jobs
├── packages/
│   ├── db/                     # Prisma schema + migrations
│   ├── contracts/              # API DTOs/OpenAPI, shared app types
│   ├── atproto/                # protocol client, Lexicons, identity helpers
│   ├── ui/                     # shared design system
│   └── config/                 # tsconfig/eslint/env validation
├── infra/
│   ├── compose/                # dev/staging/prod compose configurations
│   ├── nginx/                  # TLS/reverse-proxy configurations
│   ├── pds/                    # PDS deployment docs + version pinning
│   ├── observability/          # alerts/dashboards
│   └── scripts/                # backups, restores, smoke tests, rollback
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── data-and-privacy.md
│   ├── community-charter.md
│   ├── moderation-policy.md
│   ├── recovery-runbook.md
│   └── adr/                    # architecture decision records
├── .github/workflows/
├── PLAN.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── LICENSE
```

**Service boundary:** Next.js handles rendering and presentation. Business operations, authentication callback, App View, moderation APIs, metrics and background jobs are managed by NestJS/workers. Keep an explicit internal API contract; no UI reaching directly into PostgreSQL.

---

## 4. Phase 1 feature scope (P0)

### User account and onboarding
- Signup by invite on the self-hosted PDS; email verification, account recovery and sensible spam limits.
- Sign in/out with AT OAuth; persistent secure sessions and correct token refresh.
- Public profile: handle, display name, avatar, bio, basic follower/following counts.
- Onboarding picks 1–3 interests and suggests active members.
- Explain public/federated posting and local governance plainly.

### Social interactions
- Compose a text post; optional image upload **only after** testing PDS blob handling and size limits.
- Following feed, local Discover feed, profile feed and curated community feed.
- Replies/threads, likes, reposts, follow/unfollow.
- User block/mute respected within feed generation.
- Direct links to posts and profiles; chronological ordering, cursor pagination and useful empty states.
- Basic search **only across our indexed data** (users and posts) using PostgreSQL full text; no global-web claim.

### Community experience
- Seed 3–5 communities: e.g. Tech & Careers, Universities, Lagos, Abuja, Entertainment.
- Join/leave, community description, moderators, rules, pinned welcome post.
- A post can be associated with one primary community in the local application; canonical content remains a public AT record.
- Feed explains *why* a post appeared; sensible reporting and hiding.

### Safety
- Public rules, report post/account action, moderator queue, notes/actions audit log and appeals route.
- Local account/post visibility actions clearly distinguished from PDS-level account suspension or protocol-wide deletion.
- Rate limits and anti-spam controls, invite abuse detection, account recovery policies.
- Human moderators identified and trained before expansion.
- Respect protocol deletes, takedowns, blocks and identity/deactivation events.

### Open governance
- Publish source repo, an open-source licence (consider AGPL-3.0-or-later with legal review), charter, policies and roadmap.
- Disclose the provisional custodians and the plan for community transfer; do not claim formal cooperative ownership before it is legally established.
- Provide an easy public feedback/discussion channel and a transparency update.
- No vote-weight rewards for payments, follower count or donations.

### Operational baseline
- Persistent accounts and content, automatic deployment, backup and restore, security controls, staging and production.
- Basic first-party event instrumentation: visitor -> signup -> first follow -> first post -> week-1 return.
- Reasonable low-data budgets, mobile accessibility and graceful error handling.

---

## 5. Proposed application schema

Use DID and AT URI as keys linking our read model to signed records; canonical content remains in the PDS.

- `members`: `did` PK, `handle_cache`, `created_at`, `onboarding_status`, `last_seen_at`, `home_pds`.
- `sessions`: hashed session ID, encrypted OAuth state/token references, DID, expires/revoked timestamps; follow OAuth library persistence requirements.
- `communities`: UUID, slug, name, description, rules, status, lead_moderator_did.
- `community_memberships`: community_id, member_did, role, joined_at, notification_pref.
- `posts_index`: `uri` PK, cid, author_did, reply_parent_uri, root_uri, text_search, created_at, indexed_at, deleted_at, community_id (nullable), media metadata; provenance/rev information.
- `follows_index`: follower_did, subject_did, record_uri, active, updated_at.
- `likes_index`, `reposts_index`: actor DID, subject URI, record URI, active.
- `repo_checkpoints`: upstream, stream_cursor, repo DID, last revision, updated_at.
- `processed_events`: stable event key PK, processed_at; bounded retention and deduping.
- `reports`: id, reporter DID, target DID/URI, reason, status, created_at.
- `moderation_actions`: id, report_id, actor DID, action, justification, timestamp, appeal_status.
- `invites`: hashed code, issuer, max_uses, used_count, expires_at, disabled_at.
- `audit_log`: event ID, actor, action, target, timestamp, minimised/redacted metadata.
- `analytics_events`: aggregate or privacy-limited event schema, with retention and consent controls.

Add indexes around `posts_index(author_did,created_at)`, `posts_index(community_id,created_at)`, `(reply_parent_uri)`, active follow relationships, actor/profile lookups and outstanding reports. Index and store deletes idempotently. Define retention policies and data-subject handling procedures before the beta.

---

## 6. Deployable infrastructure (v1)

### Network layout

**Domain layout (illustrative only; reserve names after choosing a brand):**
- `example.ng`: website and Next.js app.
- `api.example.ng`: NestJS API / OAuth client metadata endpoint where appropriate.
- `example-pds.net`: **separate registrable domain** dedicated to PDS and blob hosting. The official production guide warns against using only a subdomain of the application domain for this.
- `status.example.ng`: status page, optional.

Ensure PDS account handles are planned independently of PDS hostname and can be managed long-term. A PDS hostname change after accounts exist involves identity work and is not a casual DNS change.

### Initial machines (illustrative, not a load-tested sizing commitment)

| Deployment | Target capacity | Runs | Important notes |
|---|---|---|---|
| VPS A — PDS | 4 vCPU, 8 GB RAM, adequate fast SSD | Reference PDS, PDS database/SQLite, firehose, PDS admin tooling | Capacity test before opening beyond pilot; encrypted backup and object/blob storage. |
| VPS B — Application | 4 vCPU, 8 GB RAM, adequate SSD | Next.js, NestJS, Postgres, Redis, indexer, workers, Nginx | Isolate Postgres and workers as usage grows. |
| S3-compatible storage | As-used | PDS media where compatible, off-site backups | Separate buckets/credentials, encryption and lifecycle rules. |
| Transactional email | Low-volume service | Invites/recovery/system notices | SPF/DKIM/DMARC; avoid shared inbox for sensitive recovery. |

Both servers should have health checks, firewall restrictions, SSH-key access, non-root deployment identity, automated security patching and a tested rollback procedure. **Never put the DB, Redis, Tap/indexer admin or PDS admin interfaces on an open public port.**

### PDS operational requirements
- Use an **official tagged PDS release**, not floating `latest` in production.
- Keep invite-only registrations while moderating anti-abuse behavior. Verify email/recovery flow, identity handling and relay rate-limit behavior.
- Back up SQLite and PDS configuration/recovery secrets safely. For a production path, implement/test **Litestream** or an equivalent SQLite-aware solution following official guidance. Restore a test account including repository state.
- Store identity rotation/recovery keys outside the main VM when feasible; securely offline-encrypted backup is required even for the pilot. Losing keys can compromise account recovery.
- Configure an S3-compatible blob backend after integration tests. If choosing local blobs briefly, define migration and backup path first.
- Use real HTTPS and PDS/handle DNS settings, account migration testing and a documented operator playbook.

### App operational requirements
- Postgres with daily encrypted off-site backups and point-in-time recovery plan when affordable. Periodically **rehearse restoration**, not just successful backup uploads.
- Redis configured with authentication and private networking. Jobs are idempotent; persist durable business outcomes in Postgres.
- Per-IP, per-account and per-action rate limiting and abuse controls.
- TLS; strict CORS; HttpOnly/Secure/SameSite cookies; CSRF protection where applicable; session rotation/revocation; security headers.
- Basic structured logging, metrics, error capture; avoid logging cookies, tokens, private report text and sensitive identifiers unnecessarily.
- CI: lint, format, test, typecheck, dependency checks, container image build and smoke tests.
- CD: deploy to staging, migration safety checks, controlled production promotion, rollback to pinned images.

**Budget:** Obtain live provider quotes; keep a ceiling appropriate for a self-funded pilot, but treat **€40–€150/month** (not including developers, moderation, legal advice, domain, taxes, unexpected bandwidth) as a rough provisioning allowance for two VPSs and small supporting services. Actual storage, compute, email and backup costs must be measured.

### Backups and availability goals
- PostgreSQL: encrypted daily backups; initial max acceptable loss (RPO) ≤24h, improved after pilot.
- PDS: SQLite-aware backups plus blob backups/replication and separately escrowed recovery keys; recovery plan tested against a temporary instance.
- Recovery objective (RTO) for beta: restore service within a working day; not a high-availability claim.
- Week 3 must include a test of restoring an account, a sample thread and the app read model from backup/replay.

---

## 7. Scaling blueprint: add complexity only when necessary

**Always base scale decisions on measured throughput, concurrency, storage IOPS, feed/DB latency, queue depth, ingestion lag and moderation load, not just registered account count.** The ranges below describe planning stages, not certified per-server limits.

### A. Beta / small community (up to ~1,000 registered users as planning scenario)
- Two VPSs, Compose; one PDS deployment, one API, one Postgres and one Redis.
- Chronological/curated feeds, indexed PostgreSQL queries, caching only on verified hot paths.
- PDS event consumer tied to our own server, plus backfill/recovery process.
- Load-test publication, replies, fan-out-on-read and image storage before raising invite rate.

### B. Growth (10k–50k accounts, contingent on workload)
- Split PostgreSQL onto dedicated capacity, add pooling and read replicas only if required.
- Scale stateless NestJS API and frontend separately behind a load balancer.
- Scale worker concurrency by queue depth, keep per-record idempotency and rate limits.
- Expand from one PDS to several PDS deployments; assign new accounts by a stable placement policy. Preserve DID/home-PDS resolution and migration procedure.
- Add a dedicated feed aggregation component if feed queries become expensive; balance read-time and selective fan-out strategies rather than writing one notification per follower synchronously.
- Add Tap and third-party relay ingestion for external accounts if federation demand warrants it.
- Add proper moderation labeler (e.g. Ozone) and on-call moderation staffing.

### C. Larger network (100k+ accounts, *not* an automatic target)
- PDS fleet with operational provisioning, repair automation, account-placement/relocation policies; do not share mutable SQLite files casually among unrelated instances.
- Database partitioning or sharding only after query profiling; dedicated media processing and search.
- Separate feed, notification and safety workloads; dedicated event backbone if existing queue fails scale requirements.
- Multiple regions/CDN if users' actual latency requires it; disaster recovery exercises and redundancy.
- Consider a scoped Relay and greater federation independence when justified by cross-PDS indexing volumes.
- Kubernetes only if multi-node orchestration complexity becomes a real bottleneck; not an adoption milestone.

### Example *investigation* thresholds (tune with measurement)

| Signal | Trigger to investigate | Candidate intervention |
|---|---|---|
| App API p95 latency | >500 ms sustained on key read paths at controlled load | profile queries, add caching, extra API replicas |
| Feed indexing lag | >10 seconds sustained | profile consumer/DB, increase partitioning/workers |
| Postgres | sustained high I/O or lock/connection pressure | tune queries/indexes/pooling; separate host |
| PDS disk | >70% capacity or increasing I/O waits | expand storage, offload blobs, add PDS capacity |
| Queue backlog | growing faster than it drains for 15 minutes | worker autoscaling / throttle expensive tasks |
| Moderation | reports regularly breach published handling SLA | staffing, triage and anti-abuse investment |

We will run a repeatable **k6** scenario simulating roughly 50 requests/second across browse/post/profile traffic as an initial engineering exercise; this is **not** a claimed capacity limit or launch promise. Load tests must also simulate actual AT writes and event-indexing lag, not just cached read endpoints.

---

## 8. Delivery milestones and release gates

### Phase 0 — Technical spike (2–4 days of focused work)

**Build a proof of correctness before scaffolding all features:**
1. Set up a local and disposable staging PDS from official distribution.
2. Create an invite-only account; resolve handle/DID and verify identity.
3. Implement OAuth login in an isolated NestJS proof of concept.
4. Write a standard `app.bsky.feed.post` to the PDS; observe its firehose event.
5. Index the event in Postgres; read it through a tiny NestJS endpoint.
6. Delete the post and verify removal from local feeds; stop/start indexer and verify resumability.
7. Verify a PDS backup/restore of the sample account and test external federation expectations separately.

**Gate 0:** Complete working **signup -> OAuth -> post -> firehose -> index -> feed -> delete** path. Document any SDK or self-hosting limitations and revise architecture before committing to implementation.

### Week 1 — Repo, security and infrastructure foundation
- Public GitHub repo; pnpm monorepo with Next.js, NestJS, indexer and worker; shared types/CI.
- Docker Compose for local development; separate staging environment and secret handling.
- PDS deployment, invite flow, PostgreSQL migrations, Redis, basic observability.
- Auth/session handling, simple profile, baseline API contracts.

**Gate 1:** Fresh clone starts locally; production-like staging issues test account and supports authenticated read/write; CI passes.

### Week 2 — Social core and App View
- PDS-backed create post, reply, like, repost, follow and profile update.
- Indexer read models with replay/dedupe/deletion support.
- Following feed and thread reads, profile pages, pagination; initial feed design.
- Initial load and indexing-lag dashboards.

**Gate 2:** Two accounts can follow one another, converse, and see consistent posts/engagement after indexer restarts.

### Week 3 — Communities, discoverability and moderation
- 3–5 communities, memberships, curated discovery feed and pinned rules.
- Report tools, moderator queue, local moderation decisions, audit and appeal contact.
- Search limited to indexed public members/posts; block/mute enforcement.
- Invite anti-spam, recovery, deletion and offboarding flows.
- Publish charter, code of conduct, moderation policy, privacy and data explanations.

**Gate 3:** New tester can find an interesting discussion promptly; report/test account takedown works; no known critical abuse bypasses.

### Week 4 — Reliability, private launch and observation
- Production release with TLS, off-site backups, verified restore and rollback drill.
- Mobile/PWA polish, performance/accessibility testing and scripted E2E tests.
- Onboard 20–30 seed contributors then batches of invited members; no sudden public opening.
- Collect consent-aware engagement data, interview users, publish a transparent first operations update.

**Gate 4:** Core user journeys pass, recovery drill passes, moderators and incident contacts are available, and the service withstands tested pilot load.

### Weeks 5–6 — Contingency / evidence-driven iteration
- Fix technical-spike surprises, signup barriers, slow feeds and retention problems.
- Refine local discovery, moderation workload and onboarding based on actual usage.
- **Do not build federation-wide indexing, native apps or algorithmic recommendation models unless findings justify them.**

**Decision:** Expand, iterate, or narrow the concept based on data; do not assume positive retention.

---

## 9. Experiment metrics and decision rules

**Cohort:** 200 invited, progressively onboarded. Don't equate invitations with activated users.

| Metric | Working hypothesis/goal | How to measure |
|---|---|---|
| Activation | ≥50% of accepted invites follow or interact in first session | onboarding funnel |
| Day-7 retention | ≥25% of activated members return and take a meaningful action | consent-aware weekly cohorts |
| Organic weekly contributors | ≥25 distinct people participating without staff prompting | distinct contributors/week |
| Safety | Reports triaged within published pilot SLA | queue events and manual review |
| Post-to-feed propagation | median <2s and p95 <10s under measured pilot load (aspirational) | trace PDS commit -> read model |
| Low-bandwidth UX | Core flow remains usable on constrained mobile network | throttled browser tests |

Survey people who never post and people who abandon signup; the reasons are as important as numerical thresholds. Report results with denominators and caveats.

---

## 10. First implementation backlog (suggested GitHub issues)

**Foundation**
1. `infra: deploy disposable staging AT Protocol PDS and verify DID/handle`
2. `auth: AT OAuth proof of concept with NestJS and encrypted session persistence`
3. `social: write/read/delete standard post to self-hosted PDS`
4. `indexer: subscribe to PDS firehose and persist durable checkpoints`
5. `indexer: idempotent record projection, deletion and restart/replay tests`
6. `repo: create pnpm workspace with web/api/indexer/worker/shared packages`
7. `db: initial PostgreSQL schema, migrations and seed fixtures`
8. `devops: Docker Compose, local secrets and reproducible staging deploy`
9. `ci: tests, lint, typecheck, image build, dependency checks`

**Core application**
10. `web: mobile-first shell, login/onboarding, account/profile pages`
11. `api: following feed with cursor pagination and safety filtering`
12. `social: replies, likes, reposts, follows and counts`
13. `community: catalogue, join/leave, community feed and topic tagging`
14. `web: discover feed, empty/loading/error states, shareable links`
15. `search: basic local full-text search`

**Trust and release**
16. `trust: report/appeal/moderator queues, audit trail and hide actions`
17. `trust: blocks, mutes, deletes and account takedown propagation`
18. `operations: PDS/Postgres backup, restore script and recovery rehearsal`
19. `observability: health, metrics, logs, indexing-lag and uptime alerts`
20. `security: threat model, session/CSRF checks, rate limits, invite abuse checks`
21. `governance: constitution draft, licence, transparency and policy pages`
22. `testing: browser E2E tests and repeatable k6 load profile`
23. `launch: controlled invitations and metric/feedback dashboard`

**Working rule for Claude/Codex:** Implement one vertical slice at a time; do not generate an entire pseudo-complete architecture before testing a real PDS interaction. Add tests and documentation with each slice, and have an independent review pass at phase gates.

---

## 11. Risk register / non-negotiables

| Risk | Mitigation |
|---|---|
| Operating a PDS for users requires secure account recovery and identity key custody | dedicated PDS runbook, separate backup of PLC rotation/recovery keys, verification of recovery flow |
| AT network relay onboarding/rate limits | invite-controlled growth, communicate with relay operator, make local experience independent of external relays |
| PDS is not an App View | build/index local social read model; do not try to query timelines from PDS alone |
| Custom indexer misses deletions after disconnection | persist cursors, monitor lag, implement repo resync/reconciliation and idempotent actions |
| AT OAuth is more complex than conventional password sessions | official SDK, security review, server-side persistence and minimal scopes |
| Public social posts are mistaken for private community membership | prominent onboarding disclosure, no private community promise |
| Moderator shortages and abuse | invite codes, published rules, report triage, staffing and safety thresholds |
| Open-source project is not actually community-owned | founding charter, legal cooperative/foundation review, enforceable member governance and succession |
| Two VPSs are a single-region single-point-of-failure design | realistic RPO/RTO, off-site backups, recovery drill, staged hardening |
| Scalability complexity overwhelms pilot | separate services by deployment role, not microservice proliferation; profile and measure first |
| Vendor dependency/operational sovereignty | independent domain control, source transparency, portable identity, replaceable hosting/CDN |

---

## 12. Definition of Done for the first public beta

- [ ] New invited user creates an account **on our PDS**, signs in with AT OAuth and can recover access.
- [ ] Members can post, reply, like, repost, follow, mute, block and browse chronological feeds.
- [ ] Three or more useful, active topic communities exist with clear moderation contacts.
- [ ] App View correctly handles creates, updates, deletes, replay and identity/account-status changes.
- [ ] Application is usable on a low-end Android phone and a constrained network connection.
- [ ] Rate limits, anti-abuse, moderation queue and appeal path exist and have been manually tested.
- [ ] PDS and PostgreSQL backup **and recovery** are demonstrated, including identity key custody plan.
- [ ] TLS, secure sessions, CI/CD, rollback and operational alerts are active.
- [ ] Public source, licence, charter, policy and provisional ownership disclosure are published.
- [ ] Load-test report, first-party metrics and experiment review template exist.

**One-sentence launch rule:** Do not publicly open registration until we can recover accounts and repositories, operate moderation, and repair a stopped/stale indexer without losing user-visible state.

---

## 13. Reference documentation (accessed October 2026)

1. Official AT Protocol self-hosting: https://atproto.com/guides/self-hosting
2. Official AT Protocol going to production: https://atproto.com/guides/going-to-production
3. Official AT Protocol stack (PDS, relay, App View, DID PLC): https://atproto.com/guides/the-at-stack
4. Official AT Protocol sync/firehose specification: https://atproto.com/specs/sync
5. Official AT Protocol OAuth guide/specification: https://atproto.com/guides/about-oauth and https://atproto.com/specs/oauth
6. Official PDS distribution: https://github.com/bluesky-social/pds
7. Official Tap overview (beta): https://atproto.com/blog/introducing-tap
8. Official Tap TypeScript package: https://github.com/bluesky-social/atproto/tree/main/packages/tap
9. Official Ozone moderation guidance: https://atproto.com/guides/using-ozone
10. Official AT Protocol migration guide: https://atproto.com/guides/account-migration

**Next action:** Start with **Phase 0**, not UI polish. Prove our independent `PDS -> AT OAuth -> published record -> indexer -> NestJS read model` vertical slice, then implement the rest against the validated integration.
