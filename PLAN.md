# HeyNaija: Nigeria-first, community-owned social network
## Phase 1 plan — v3.0

**Updated:** 14 October 2026
**Status:** Core product built and working locally. Not deployed.
**Strategy:** Ship a focused, invite-only web beta; validate retention before expanding infrastructure.
**Initial cohort:** Up to 200 invited users in 3–5 active communities; Nigeria-first, open to the diaspora.

This replaces v2.0, which planned a self-hosted AT Protocol stack. That was dropped
after a technical spike; the reasons are in
[ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md), and v2.0 is in git
history. The product hypothesis, safety, governance and metrics carried over.

---

## Where things stand (read this first)

**Built and verified locally:** invite-only signup, sign-in, email verification and
recovery (Ory Kratos); posts, threaded replies, likes, bookmarks; up to four
images per post with descriptions, processed in a background job, opening in a
full-screen viewer; profiles with photos, display names and bios; follow, mute, block; five communities to join and post in; Latest,
Following, community and trending feeds; search; reporting, a moderation queue,
appeals and a decision log; rate limits; light, dark and system themes.

**Not built:** notifications, deployment of any kind. See [§8 Roadmap](#8-roadmap) for the order.

**Key documents**

| Document | For |
|---|---|
| [README.md](README.md) | Running it locally, commands, moderators, checks |
| [ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md) | Why the stack is what it is, and every known limitation |
| [docs/deployment/cloudflare-r2.md](docs/deployment/cloudflare-r2.md) | Setting up media storage in production |
| [ADR 0001](docs/adr/0001-phase-0-spike.md) | The AT Protocol spike (historical) |

---

## 0. Decisions at a glance

| Question | Decision | Why |
|---|---|---|
| Accounts and sign-in | **Ory Kratos**, self-hosted | Passwords, sessions, verification and recovery are security-critical and already solved |
| Signup | **Invite-only.** Kratos asks our API to check the code before saving an account and to spend it after | Controlled growth; a failed signup never burns an invite |
| Where posts live | **PostgreSQL**, as the source of truth | Simple, private communities possible later, full moderation control |
| Frontend | **Next.js 16** (App Router, Cache Components), server-rendered, works without JavaScript for core reading and posting | Fast on low-end Android and slow networks |
| Backend | **NestJS + Fastify** | A separate API with its own tests and deploys |
| Media storage | **S3-compatible**: MinIO locally, **Cloudflare R2** in production | No download fees on R2; same code everywhere |
| Queue/cache | **Redis with BullMQ** for background jobs: post-image processing and an hourly media sweep, run inside the API process. Next: notifications, shared rate limits | Add only when measured or needed |
| Deploy | Docker on one or two VPSs behind Cloudflare, to be decided | See §7 |
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
2. Open-source code, community-influenced moderation, public governance updates.
3. Members own their data: export it, and the code is open (no protocol lock-in, but
   no lock-in to us either).
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
- [x] Email verification and account recovery by emailed code
- [x] Sign in with email or handle; sign out; change email, handle or password
- [x] Profile photo (upload, replace, remove)
- [x] Display name (50 characters) and short bio (160), searchable by name
- [ ] Onboarding: pick interests and communities, suggested people
- [ ] Data export ("download my data")

### Social
- [x] Text posts (300 characters), threaded replies, likes, private bookmarks
- [x] Follow and unfollow; Latest, Following, profile, community and trending feeds
- [x] Following feed says why each post is there
- [x] Search over members, communities and posts (PostgreSQL full text)
- [x] Mute and block, respected in every feed, thread and search
- [x] Post images: up to 4, with optional descriptions (alt text), processed in a background job
- [ ] Notifications (replies, likes, follows, moderation outcomes)
- [ ] Reposts

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
- [ ] Moderators can remove a profile photo without suspending the account
- [ ] Scanning uploads for known child sexual abuse material (required before uploads open beyond the pilot)
- [ ] Assigning moderators in the app
- [ ] Notifying people about moderation decisions that affect them

### Open governance
- [ ] Licence (consider AGPL-3.0-or-later, with legal review), charter, policies, roadmap, published source
- [ ] Disclosure of the provisional custodians and the plan for community ownership
- [ ] Community votes (the UI says "on the way"; nothing is built)

### Operations
- [x] CI: build, typecheck, tests, dependency audit (never run: no GitHub remote yet)
- [ ] Staging and production environments; TLS; real domains
- [ ] Production Kratos config and an email provider
- [ ] Backups and a rehearsed restore (Postgres, Kratos database, media bucket)
- [ ] Logging, metrics, uptime alerts
- [ ] Browser end-to-end tests; load test
- [ ] Privacy-respecting product metrics (signup → first follow → first post → week-1 return)

---

## 5. Data model

All tables are in `packages/db/src/schema.ts`; migrations in `packages/db/drizzle`.

| Table | Holds |
|---|---|
| `members` | Kratos identity ID, handle copy, active/suspended, site role, avatar |
| `posts` | Text, author, reply parent and root, community, soft delete, moderator removal |
| `likes`, `bookmarks`, `follows` | Relationships |
| `communities`, `community_memberships` | Communities and who belongs (with moderator role) |
| `blocks`, `mutes` | Safety relationships |
| `invites`, `invite_redemptions` | Hashed invite codes and who each one let in |
| `reports`, `moderation_actions` | Reports and appeals; the append-only decision log |
| `media` | Uploaded files: owner, kind, status, type, size, dimensions; for post images also the post, position and description |

Counts (likes, replies, followers) are computed on read. Fine at pilot scale;
revisit with measurements.

---

## 6. Design system

Everything visual comes from tokens in `apps/web/app/globals.css`. Rules that the
brand owner has set:

- **Keep the current palette.** Forest green accent on white and sage. No gradients,
  and no colours borrowed from AI-tool branding.
- **Radius follows role:** 8px for controls, 6px for chips, 10px for panels, 14px for
  the app frame. Only avatars are round.
- **Rows, not cards.** Posts and side-rail sections are ruled lists. A bordered
  panel is only for a real object: the composer, a form, a moderation case, the
  post a thread is about.
- **One bold element:** the bubbly wordmark. Everything around it stays quiet.
- **Shared primitives** for every control: `.btn` (primary, secondary, ghost,
  danger), `.field`, `.chip`, `.menu-panel`/`.menu-item`, `.notice`, `EmptyState`,
  `Menu` (closes on outside click and Escape).
- **Type:** Plus Jakarta Sans, self-hosted. **Icons:** Lucide, through
  `app/ui/icons.tsx` only.
- **Themes:** light, dark and system, saved per browser, applied before first paint.

---

## 7. Production infrastructure (to decide and build)

Proposed shape for the pilot; nothing is provisioned.

| Piece | Proposal | Notes |
|---|---|---|
| Edge | Cloudflare in front of everything | TLS, caching, CSAM scanning tool for media |
| App server | One VPS: web, API, Kratos, Postgres, Redis via Docker Compose | Split Postgres out when measurements say so |
| Media | Cloudflare R2, two buckets | Follow [the R2 guide](docs/deployment/cloudflare-r2.md) |
| Email | A transactional email provider for Kratos | SPF, DKIM, DMARC on the sending domain |
| Backups | Nightly encrypted Postgres dumps (app and Kratos databases) off the server | Rehearse a restore before launch |

Decisions needed from the owner: **hosting provider, domain name, email provider.**

Production changes the code will need (none done yet):
- A production Kratos config: real domain, `https`, no `--dev`, log level `warning`
  (Kratos logs the webhook secret at `info`), SMTP settings.
- Kratos webhook URLs pointing at the API's internal address instead of
  `host.docker.internal`.
- `Secure` cookies, `WEB_PUBLIC_URL` and the Kratos URLs set to the real domain.
- Rate limits moved from memory to Redis if the API runs more than one process.

**Budget:** get live quotes. The v2.0 allowance of roughly €40–€150 a month for
servers and small services is still a reasonable planning figure; it excludes
people, legal advice and unexpected bandwidth.

---

## 8. Roadmap

In order; each step is a vertical slice with tests and a browser check.

1. ~~**Post images.**~~ Done 14 October 2026: up to 4 per post with alt text,
   processed by BullMQ on the existing Redis.
2. ~~**Display name and bio**~~ Done 14 October 2026, along with a full-screen
   image viewer.
3. **Notifications**: replies, likes, follows; then moderation outcomes.
4. **Safety gaps:** moderator removal of photos; abuse-material scanning plan;
   moderator assignment in the app.
5. **Staging deployment** (§7), including R2, email and backups.
6. **Browser end-to-end tests** of signup, posting, moderation; a basic load test.
7. **Governance pages:** licence, charter, rules, privacy policy, data export.
8. **Pilot launch:** onboard 20–30 seed members, then invite in batches.

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
