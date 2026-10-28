# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Nigerians at home and in the diaspora, starting with an invite-only pilot of up to
200 people in 3–5 active communities. The launch audience is students,
early-career professionals, technologists, local organisers and creators, recruited
in a few interest clusters rather than through a national launch.

They come to follow and join locally relevant conversations: reading their feeds,
posting short text and images, replying, and taking part in communities such as
Tech & Careers, Universities, Lagos, Abuja and Entertainment. Many use a low-end
Android phone on a slow or expensive connection.

Secondary users: community and site-wide moderators working the moderation queue,
appeals and decision log; suspended members filing appeals.

## Product Purpose

HeyNaija is a Nigeria-first social network being built toward community ownership. It tests one
hypothesis: Nigerians will keep coming back to a fast, locally relevant discussion
network if it hosts useful communities, moderates fairly, and gives members a real
stake in how it is governed.

Success in the pilot is measured, not assumed (PLAN.md §9): at least 50% of accepted
invites follow or interact in their first session; at least 25% of activated
members return within 7 days and do something meaningful; at least 25 people post
each week without staff prompting; reports are triaged within the published target;
the core flow works on a throttled mobile connection.

## Positioning

A discussion network built around Nigerian topics and communities, with feeds that
say why each post is there, rather than opaque engagement ranking: Latest and
Following in time order, and Discover, ranked by published rules from public
activity (ADR 0014). Source publication under the existing AGPL licence is planned; the
repository is currently private. Moderation decisions go into a moderator-only
log, governance proposals are published, and members can download their data from
Settings. Public governance decision records are separate future work.

"Community-owned" is a direction, not a current fact. Draft v0.3 proposes a nonprofit under Incorporated Trustees: three founding trustees serve initial three-year terms, two representatives are elected annually from readiness, and all three trustee seats open at founding-term expiry. Incorporation, elected representation, elected trustee authority and legal asset control are separate milestones; none is implied by a draft or online ballot. Until a charter and legal
review exist, the product must not claim ownership that members do not yet have.

## Operating Context

- Invite-only: people join through a shared invite link (`/join?code=…`). There are
  no passwords; sign-in uses an emailed code or Google.
- Every post is public. Communities are public groupings, not private groups, and the
  composer says so.
- Designed primarily for phones, including constrained connections. Core social
  pages are server-rendered but their streamed content currently needs JavaScript;
  the no-JavaScript social journeys are known expected failures in `e2e/tests/no-js.spec.ts`.
  The static About and Progress reading pages work without JavaScript.
- Moderators work from a queue: remove posts, suspend accounts, dismiss reports,
  restore posts, clear names, bios and photos, review appeals. Every decision goes
  into an append-only log.

## Capabilities and Constraints

Built: invite-only signup and passwordless sign-in; text posts (300 characters) with
up to four images or GIFs with alt text, links with preview cards; threaded replies, likes, reposts and quote posts,
private bookmarks; profiles with photo, display name (50 characters) and bio (160);
follow, mute, block; Latest, Following, community and trending feeds, and Discover, ranked by rules published at /about/discover; search across
members, communities and posts; notifications in the app and by email (grouped, with a one-click unsubscribe); reporting, moderation queue,
appeals, moderator-only decision log, rate limits; light, dark and system themes;
data export (format 7); a welcome flow for newcomers (choose communities, then
suggested people to follow); public governance information and draft constitution;
About and Progress pages. Voting, verification and the Public Treasury are not live.

Not built (do not design them as if they work): interests or topics to follow
(communities stand in for them), pinned welcome posts, community photos,
push notifications, community voting, treasury transactions, the Top reply order
(planned, ADR 0014).

Phase 1 non-goals: native apps, DMs, video, payments or creator revenue, AI
recommendations, ranking by predicted engagement, federation.

The canonical, prioritised inventory is [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md),
generated from `docs/feature-roadmap.json` and also rendered at `/progress`.
See [docs/roadmap-audit.md](docs/roadmap-audit.md) for audit scope and unresolved confirmations.

Terminology: "members" (not users), "communities", "invite", "moderator",
"decision log", "appeal", "Discover", "Latest" and "Following" feeds.

## Brand Commitments

- Name: HeyNaija. The rounded green wordmark (`apps/web/public/brand`, source in
  `docs/design/source/heynaija-wordmark.png`) is the approved logo.
- Owner-set visual rules in PLAN.md §6 are binding: keep the current palette (forest
  green on white and sage), no gradients, no new colours, and no colours borrowed
  from AI-tool branding. The wordmark is the single bold element.
- Voice: plain, warm English. Nigerian references only where they come naturally,
  never as decoration. Be honest about what is and isn't live, and say plainly that
  posts are public.

## Evidence on Hand

- Five seeded launch communities, plus Building HeyNaija for the people building the app (`packages/db`).
- Approved wordmark and a community-conversation illustration in
  `docs/design/source/`; reference mockup `docs/design/heynaija-reference.png`.
- No real members, testimonials, press, usage numbers, or governance outcomes yet.
  Do not invent people, posts, membership counts, votes or treasury figures.

## Product Principles

1. **Fast on a cheap phone.** If a feature hurts low-end Android on a slow connection,
   it needs a strong reason.
2. **Say why.** Feeds, moderation and governance explain themselves: why a post is
   shown, why a decision was made, what is not live yet.
3. **Truthful about ownership.** Show governance openly, but never claim more
   community control than exists.
4. **Safety is part of the product.** Reporting, appeals and moderation are
   first-class flows, not settings buried in a menu.
5. **Local first.** Nigerian topics, places and communities lead discovery.

## Accessibility & Inclusion

WCAG 2.2 AA is the target. Images carry descriptions for screen readers. The core
flow must become usable on a low-end Android phone on a throttled connection;
measured acceptance and no-JavaScript social journeys remain gaps.
