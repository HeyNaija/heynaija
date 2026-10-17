# HeyNaija: a Nigeria-first social network, built toward community ownership
## Phase 1 plan — v3.0

**Updated:** 14 October 2026
**Status:** Core product built; staging live at https://staging.heynaija.ng (15 October 2026). Production not deployed.
**Strategy:** Ship a focused, invite-only web beta; validate retention before expanding infrastructure.
**Initial cohort:** Up to 200 invited users in 3–5 active communities; Nigeria-first, open to the diaspora.

This replaces v2.0, which planned a self-hosted AT Protocol stack. That was dropped
after a technical spike; the reasons are in
[ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md), and v2.0 is in git
history. The product hypothesis, safety, governance and metrics carried over.

---

## Where things stand (read this first)

**Built and verified locally:** invite-only signup, email-code sign-in and email
confirmation (Ory Kratos; password recovery is disabled, ADR 0003); posts, threaded replies, likes, reposts and quote posts, bookmarks; up to four
images per post with descriptions, processed in a background job, opening in a
full-screen viewer; profiles with photos, display names and bios; follow, mute, block; five communities to join and post in; Latest,
Following, community and trending feeds; search; reporting, a moderation queue,
appeals and a decision log; notifications (replies, likes, reposts, quotes, follows,
moderation outcomes); rate limits; light, dark and system themes.

**Current feature inventory:** [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md) is the canonical prioritised roadmap, also readable at `/progress`. Production deployment and other P0 safety, operations, disclosure and access gaps remain incomplete. See [§8 Roadmap](#8-roadmap).

**Key documents**

| Document | For |
|---|---|
| [README.md](README.md) | Running it locally, commands, moderators, checks |
| [Feature roadmap](docs/FEATURE_ROADMAP.md) | Generated feature status, priorities, availability and inspected evidence |
| [Roadmap audit](docs/roadmap-audit.md) | Audit limits, documentation corrections and founder confirmations |
| [ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md) | Why the stack is what it is, and every known limitation |
| [docs/deployment/staging.md](docs/deployment/staging.md) | Deploying staging on the shared Contabo server: Cloudflare, nginx, GitHub runner, backups |
| [docs/deployment/production.md](docs/deployment/production.md) | Deploying production on netcup |
| [docs/deployment/cloudflare-r2.md](docs/deployment/cloudflare-r2.md) | Setting up media storage in production |
| [docs/safety/abuse-material-scanning.md](docs/safety/abuse-material-scanning.md) | Scanning uploads for abuse material: plan, runbook, legal questions |
| [ADR 0001](docs/adr/0001-phase-0-spike.md) | The AT Protocol spike (historical) |

---

## 0. Decisions at a glance

| Question | Decision | Why |
|---|---|---|
| Accounts and sign-in | **Ory Kratos**, self-hosted | Passwords, sessions, verification and recovery are security-critical and already solved |
| Signup | **Invite-only.** Kratos asks our API to check the code before saving an account and to spend it after | Controlled growth; a failed signup never burns an invite |
| Where posts live | **PostgreSQL**, as the source of truth | Simple, private communities possible later, full moderation control |
| Frontend | **Next.js 16** (App Router, Cache Components), server-rendered, meant to work without JavaScript for core reading and posting. **Not true at present:** streamed pages stay on their loading skeleton without JavaScript (found by the e2e tests, 15 October 2026; [docs/e2e.md](docs/e2e.md)) | Fast on low-end Android and slow networks |
| Backend | **NestJS + Fastify** | A separate API with its own tests and deploys |
| Media storage | **S3-compatible**: MinIO locally, **Cloudflare R2** in production | No download fees on R2; same code everywhere |
| Queue/cache | **Redis with BullMQ** for background jobs: post-image processing and an hourly media sweep, run inside the API process. Next: shared rate limits, email or push notifications | Add only when measured or needed |
| Deploy | **Docker Compose on one VPS** (netcup recommended, or Contabo) behind Cloudflare; staging at `staging.heynaija.ng`; email through **Resend** | See §7 |
| Governance | Open charter, provisional steering group, legal review before any ownership claim | Publishing code does not make a project community-owned |
| Federation | **None in Phase 1.** Portability through data export and open source instead | See ADR 0002 |

---

## 1. Product hypothesis and first audience

**Hypothesis:** Nigerians will repeatedly use a fast, locally relevant discussion
network if it hosts useful communities, provides fair moderation, and gives members
a meaningful stake in its governance.

**Launch audience:** Students, early-career professionals, technologists, local
organisers and creators. Recruit real people in a few interest clusters rather
than attempting a national launch on day one.

**Differentiators:**
1. Nigeria-first topics, communities and discovery.
2. Planned public source under the existing AGPL licence, accountable moderation, and public governance proposals. The repository is currently private.
3. Members can download their data from Settings (export format 3). Public source publication and wider interoperability remain separate work.
4. Low-bandwidth, accessible, Android-first web experience.
5. Chronological feeds that say why a post is there, rather than opaque engagement ranking.

**Non-goals in Phase 1:** native apps; DMs; video; payments or creator revenue; AI
recommendations; algorithmic ranking; federation; Kafka; Kubernetes.

**Privacy:** communities are public groupings, not private groups. Every post is
public; the composer says so.

---

## 2. Architecture

```text
Browser ──> Next.js web app
              ├── /api/v1/*  ──> NestJS API ──> PostgreSQL (members, posts, communities, moderation)
              │                      └──> object storage (MinIO / R2): uploads (private), media (public)
              ├── /media/*   ──> media bucket (processed images)
              └── /kratos/*  ──> Ory Kratos ──> PostgreSQL (identities, sessions) ──> SMTP
                                     └── webhooks ──> API (invite check and spend)
```

- **One origin.** The browser talks only to the web app, which proxies the API,
  Kratos and media. Cookies are first-party; no CORS except browser uploads to storage.
- **Kratos owns identity**; the API asks it who a session belongs to on every
  request. `members.id` is the Kratos identity ID.
- **The API owns everything else** and is the only authority on permissions.
- **Media:** the browser shrinks an image, uploads it straight to the private bucket
  with a signed URL; the API checks it, re-encodes it (dropping location data) and
  publishes small WebP versions to the public bucket. Profile photos are processed
  in the request; post images in a BullMQ job, while the composer waits for them.

---

## 3. Repository

| Path | What |
|---|---|
| `apps/web` | Next.js web app |
| `apps/api` | NestJS API, its tests, and CLI commands (invites, moderators, media buckets) |
| `packages/db` | Drizzle schema, migrations, community seed |
| `infra/kratos` | Kratos config and identity schema |
| `infra/compose` | Local stack: Postgres, Redis, Kratos, Mailpit, MinIO |
| `infra/scripts` | Secret generation, test-database helper |
| `docs/adr` | Decision records |
| `docs/deployment` | Production setup guides |
| `docs/design` | Brand source art and the reference mockup |

---

## 4. Phase 1 scope and status

### Accounts and onboarding
- [x] Invite-only signup with shareable invite links (`/join?code=…`)
- [x] 18+ during the beta (temporary): "I am 18 or older" on `/join`, refused by the API's registration webhook without it; stored as a stated age band only (16 October 2026, ADRs 0005 and 0006)
- [ ] Accounts for people under 18, with age assurance, parental or guardian consent where required, adult-content restriction and contact limits: [docs/governance/under-18-rollout.md](docs/governance/under-18-rollout.md)
- [x] No passwords: sign up and sign in with a code emailed to you, or with Google
      (ADR 0003); sign out; change email or handle; connect or disconnect Google
- [x] Profile photo (upload, replace, remove)
- [x] Display name (50 characters) and short bio (160), searchable by name
- [ ] Onboarding: pick interests and communities, suggested people
- [x] Data export ("download my data"): Settings → Your data, one JSON file (15 October 2026; format 2 adds age confirmation and verification status, 16 October; format 3 adds reposts and quote posts, 16 October)

### Social
- [x] Text posts (300 characters), threaded replies, likes, private bookmarks
- [x] Follow and unfollow; Latest, Following, profile, community and trending feeds
- [x] Profile tabs: Posts, Replies, and Media (posts and replies with images) (16 October 2026)
- [x] Following feed says why each post is there
- [x] Search over members, communities and posts (PostgreSQL full text)
- [x] Mute and block, respected in every feed, thread and search
- [x] Post images: up to 4, with optional descriptions (alt text), processed in a background job
- [x] Notifications (replies, likes, reposts, quotes, follows, moderation outcomes), in-app only
- [x] Reposts and quote posts: repost to your followers and profile, or quote with your own words. Following and the profile Posts tab show each post once, at the latest time it was reposted by someone you see; blocks and mutes apply to reposter and author; a quote of a deleted post shows a placeholder (16 October 2026, [ADR 0007](docs/adr/0007-reposts-and-quotes.md))

### Communities
- [x] Five seeded communities: Tech & Careers, Universities, Lagos, Abuja, Entertainment
- [x] Join, leave, post into; rules; moderators shown
- [ ] Pinned welcome post
- [ ] Community photos
- [ ] Private communities (possible now, not planned for Phase 1)

### Safety
- [x] Report a post or account; moderation queue; remove post; suspend account; dismiss
- [x] Site-wide and per-community moderator roles (assigned from the command line)
- [x] Appeals from suspended members; append-only decision log; restore a removed post
- [x] Rate limits on posting, actions, reports, search, invite checks and uploads
- [x] Moderators can remove a profile photo, or clear a name and bio, without suspending the account
- [ ] Scanning uploads for known child sexual abuse material (required before uploads open beyond the pilot). Plan written and the hook built; Cloudflare's CSAM Scanning Tool is on (15 October 2026); PhotoDNA still to come: [docs/safety/abuse-material-scanning.md](docs/safety/abuse-material-scanning.md)
- [x] Assigning community moderators in the app (site-wide roles stay on the command line)
- [x] Images taken down by moderators are moved out of public view and kept privately as evidence
- [x] Notifying people about moderation decisions that affect them (post removed or restored, report outcome, reinstatement; a rejected appeal shows on the suspended account)

### Open governance
- [x] Governance information page and Public Treasury preview, clearly marked coming soon
- [x] Governance overview rebuilt from draft constitution v0.2 (16 October 2026): founding-stage notice, participation types, proposed structure and thresholds, ownership milestones with truthful statuses, empty states. `/governance/constitution`, `/governance/membership`, `/governance/verification`; Settings shows each member's status
- [ ] Optional NIN verification (NINAuth) and voting membership: data model, rules and tests built behind switches the API refuses to turn on; verification, opt-in and ballots wait for the approvals in [docs/governance/open-items.md](docs/governance/open-items.md)
- [ ] A working feedback channel for the governance drafts
- [ ] Licence, charter, policies, roadmap, published source. Draft pages live at /rules, /privacy, /charter and /licence (15 October 2026), marked as drafts with placeholders for the operator's details; licence chosen: AGPL-3.0-or-later. Still to do: legal review, the `LICENSE` file, filling in the placeholders, publishing the source
- [ ] Disclosure of the provisional custodians and the plan for community ownership (the charter sets out the plan; the custodians' names are a placeholder)
- [ ] Community voting and treasury records (information pages are built; voting and transactions are not live)

### Operations
- [x] CI: build, typecheck, tests, dependency audit (never run: no GitHub remote yet)
- [ ] Staging and production environments; TLS; real domains (staging live at staging.heynaija.ng behind Cloudflare, 15 October 2026; production not provisioned: [production guide](docs/deployment/production.md))
- [x] Production Kratos config and an email provider (Resend)
- [ ] Backups and a rehearsed restore (Postgres, Kratos database, media bucket): scripts built, backup and restore rehearsed locally; media not copied outside R2
- [ ] Logging, metrics, uptime alerts (logs capped per service; uptime check and backup ping described in the guide; no error alerts yet)
- [ ] Browser end-to-end tests (Playwright suite passing locally, 15 October 2026, and added to CI; first GitHub run still to confirm: [docs/e2e.md](docs/e2e.md)); load test (kit built: [docs/loadtest.md](docs/loadtest.md))
- [ ] Privacy-respecting product metrics (signup → first follow → first post → week-1 return)

---

## 5. Data model

All tables are in `packages/db/src/schema.ts`; migrations in `packages/db/drizzle`.

| Table | Holds |
|---|---|
| `members` | Kratos identity ID, handle copy, active/suspended, site role, avatar |
| `posts` | Text, author, reply parent and root, quoted post, community, soft delete, moderator removal, like/reply/repost counts |
| `likes`, `reposts`, `bookmarks`, `follows` | Relationships |
| `communities`, `community_memberships` | Communities and who belongs (with moderator role) |
| `blocks`, `mutes` | Safety relationships |
| `invites`, `invite_redemptions` | Hashed invite codes and who each one let in |
| `reports`, `moderation_actions` | Reports and appeals; the append-only decision log |
| `notifications` | One row per event for a member: kind, actor, post, read time. What still shows is decided on read |
| `media` | Uploaded files: owner, kind, status, type, size, dimensions; for post images also the post, position and description |
| `profile_badges` | Public badges (the green identity tick); a row only while it may be shown and its owner chose to show it |
| `restricted.*` | Kept apart from ordinary reads (ADR 0005): `age_assurances` (age-band statements and how each was made; ADR 0006), `identity_verifications`, `governance_memberships`, `governance_audit_log` |

Like, reply and repost counts are kept on each post by triggers (migrations 0011
and 0015). Follower counts are computed on read. Fine at pilot scale; revisit
with measurements.

---

## 6. Design system

Everything visual comes from tokens in `apps/web/app/globals.css`; the full system
(tokens, cards, type, layout, do's and don'ts) is recorded in
[apps/web/DESIGN.md](apps/web/DESIGN.md). Rules that the brand owner has set:

- **Keep the current palette.** Forest green accent on white and sage. No gradients,
  and no colours borrowed from AI-tool branding.
- **Radius follows role:** 8px for controls, 6px for chips, 12px for cards. Only
  avatars are round.
- **Cards on a tinted ground** (changed 14 October 2026, replacing "rows, not
  cards"). The page is a pale sage-grey ground with no framing sheet; posts,
  notifications, the composer, profile and community headers, forms and each
  right-rail section are flat white cards (1px border, no shadow) with 10–12px
  gaps. The sidebar sits on the ground; the current page is a white pill. Same on
  phones, with 12px side gutters.
- **One bold element:** the bubbly wordmark. Everything around it stays quiet.
- **Shared primitives** for every control: `.btn` (primary, secondary, ghost,
  danger), `.field`, `.chip`, `.menu-panel`/`.menu-item`, `.notice`, `EmptyState`,
  `Menu` (closes on outside click and Escape).
- **Type:** Plus Jakarta Sans, self-hosted. **Icons:** Lucide, through
  `app/ui/icons.tsx` only.
- **Themes:** light, dark and system, saved per browser, applied before first paint.

---

## 7. Production infrastructure

**Staging is live** at https://staging.heynaija.ng (15 October 2026); **production is not provisioned yet.** Step-by-step guides:
[staging](docs/deployment/staging.md) and [production](docs/deployment/production.md);
the files are in `infra/deploy/` and `.github/workflows/`.

| Piece | Decision | Notes |
|---|---|---|
| Domain | `heynaija.ng`; staging at `staging.heynaija.ng` | DNS on Cloudflare |
| Edge | Cloudflare in front of everything | TLS (Full strict, origin certificate), caching, Authenticated Origin Pulls, CSAM scanning tool for media |
| Servers | **Staging:** the owner's existing Contabo server, shared with Koinovera staging. **Production:** its own netcup server (4 vCPU / 8 GB / 120 GB). Ubuntu 24.04 | Docker Compose: web, API, Kratos, Postgres, Redis. Only the web app publishes a port, on 127.0.0.1, so nothing clashes with Koinovera |
| Front door | The host's **nginx** (already serving Koinovera on staging), one site per environment rendered from a template | Origin certificate, Authenticated Origin Pulls, security headers, real visitor IPs |
| Media | Cloudflare R2: two buckets per environment, served at `/media` by nginx | [R2 guide](docs/deployment/cloudflare-r2.md) |
| Email | Resend over SMTP, from `no-reply@mail.heynaija.ng` | SPF, DKIM, DMARC on the sending domain |
| Backups | Nightly `pg_dump` of both databases, encrypted with age, copied to an R2 backups bucket, 30 days kept | Restore rehearsed on a laptop; rehearse again on staging |
| Deploys | **GitHub Actions:** a push to `staging` or `main` runs CI, builds the images on GitHub's machines into GitHub's registry, then HeyNaija's own self-hosted runner on that server runs `deploy.sh` | Servers never build; rollback reruns the workflow on an earlier commit, or `deploy.sh <commit>` |

Still to do: the owner's accounts and server (the guide), media copies outside R2,
error alerting from logs, rate limits in Redis before running more than one API
process.

**Budget:** get live quotes. The v2.0 allowance of roughly €40–€150 a month for
servers and small services is still a reasonable planning figure; it excludes
people, legal advice and unexpected bandwidth.

---

## 8. Roadmap

The current prioritised roadmap is [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md),
generated from `docs/feature-roadmap.json`. The public `/progress` page reads the
same registry; update the registry rather than keeping a second status list here.
Run `pnpm roadmap:generate`, `pnpm roadmap:check` and `pnpm roadmap:test` after edits.
CI checks synchronisation and schema integrity.

P0 means safe and usable public-beta work, P1 core engagement, P2 growth and
community, and P3 later experiments. Priority is independent of completion.
Statuses distinguish implemented, partial, planned and externally blocked work;
availability is recorded separately from local implementation and test evidence.

[Audit notes](docs/roadmap-audit.md) explain known documentation conflicts and
outstanding founder confirmations. The historic implementation dates elsewhere
in this plan are context, not proof that a feature is currently deployed or that
public-beta acceptance is complete. Ship vertical slices with meaningful tests
and browser checks; do not open public registration until the launch conditions
in §11 are met.

---

## 9. Experiment metrics and decision rules

**Cohort:** 200 invited, onboarded progressively. Invitations are not activations.

| Metric | Goal | How to measure |
|---|---|---|
| Activation | ≥50% of accepted invites follow or interact in their first session | onboarding funnel |
| Day-7 retention | ≥25% of activated members return and do something meaningful | weekly cohorts, consent-aware |
| Organic weekly contributors | ≥25 distinct people posting without staff prompting | distinct contributors per week |
| Safety | Reports triaged within the published pilot target | queue timestamps and review |
| Low-bandwidth UX | Core flow usable on a throttled mobile connection | throttled browser tests |

Survey people who never post and people who abandon signup; their reasons matter
as much as the numbers. Report results with denominators and caveats.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Uploaded abuse material | Scanning before uploads open beyond the pilot; report and removal paths; fast takedown |
| Moderator shortage | Invite-only growth, published rules, per-community moderators, decision log |
| Posts mistaken for private | Composer says posts are public; no private-community promise |
| "Community-owned" claimed before it is true | Charter and legal review first; the UI says votes are "on the way" |
| Single server is a single point of failure | Off-site backups, rehearsed restore, honest recovery targets |
| Kratos misconfiguration in production | Dedicated production config, reviewed; log level and secrets checked |
| In-memory rate limits reset on restart | Move to Redis before running more than one API process |
| Dependency on Cloudflare | Media and DNS are portable: S3-compatible storage, standard DNS |

---

## 11. Definition of done for the first public beta

- [x] An invited person can sign up, verify their email, sign in and recover access.
- [x] Members can post, reply, like, follow, mute, block and browse chronological feeds.
- [x] Three or more communities exist with visible rules and moderators.
- [x] Reporting, the moderation queue, appeals and rate limits exist and were tested by hand.
- [ ] Usable on a low-end Android phone on a constrained connection (designed for; not yet measured).
- [ ] Postgres, Kratos and media backup **and restore** demonstrated.
- [ ] TLS, secure cookies, CI/CD, rollback and alerts active.
- [ ] Abuse-material scanning in place if image uploads are open.
- [ ] Public source, licence, charter, rules, privacy policy and ownership disclosure published.
- [ ] First-party metrics and an experiment review template exist.

**Launch rule:** do not open registration publicly until we can restore from backup,
run moderation with real moderators, and handle abuse reports within the published target.

---

## 12. Working agreements (for people and AI assistants)

- Build one vertical slice at a time, with tests and a check in the browser.
- API tests run against a real Postgres (`pnpm test`); services are tested directly.
- The repository owner commits; assistants stage changes and say what is uncommitted.
- Record decisions and known limitations in `docs/adr`; keep the README's run
  instructions working.
- Follow the design rules in §6. Do not add gradients or new colours.
- If the dev site looks unstyled after a CSS change, restart `pnpm dev:web`: the
  dev server has served a stale stylesheet more than once. If a restart does not
  fix it, stop the server, delete `apps/web/.next` and start it again (Turbopack's
  on-disk cache was serving the old CSS on 14 October).
