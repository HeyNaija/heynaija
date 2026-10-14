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

HeyNaija is a Nigeria-first, community-owned social network. It tests one
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
are chronological and say why each post is there, rather than opaque engagement
ranking. The code is open, moderation decisions go into a public log, governance
happens in the open, and members can take their data with them. Nobody gets locked
in, including to HeyNaija itself.

"Community-owned" is a direction, not a current fact. Until a charter and legal
review exist, the product must not claim ownership that members do not yet have.

## Operating Context

- Invite-only: people join through a shared invite link (`/join?code=…`). There are
  no passwords; sign-in uses an emailed code or Google.
- Every post is public. Communities are public groupings, not private groups, and the
  composer says so.
- Used mostly on phones, often on low-end Android with constrained bandwidth; core
  reading and posting work without JavaScript and are server-rendered.
- Moderators work from a queue: remove posts, suspend accounts, dismiss reports,
  restore posts, clear names, bios and photos, review appeals. Every decision goes
  into an append-only log.

## Capabilities and Constraints

Built: invite-only signup and passwordless sign-in; text posts (300 characters) with
up to four images and alt text; threaded replies, likes, private bookmarks; profiles
with photo, display name (50 characters) and bio (160); follow, mute, block; Latest,
Following, community and trending feeds; search across members, communities and
posts; in-app notifications; reporting, moderation queue, appeals, decision log, rate
limits; light, dark and system themes; a governance information page and Public
Treasury preview, both marked as coming soon.

Not built (do not design them as if they work): onboarding (interests, communities,
suggested people), data export, reposts, pinned welcome posts, community photos,
email or push notifications, community voting, treasury transactions.

Phase 1 non-goals: native apps, DMs, video, payments or creator revenue, AI
recommendations, algorithmic ranking, federation.

Terminology: "members" (not users), "communities", "invite", "moderator",
"decision log", "appeal", "Following" and "Latest" feeds.

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

- Five seeded launch communities (`packages/db`).
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

WCAG 2.2 AA. Images carry descriptions for screen readers. The core flow must be
usable on a low-end Android phone on a throttled connection, and reading and posting
work without JavaScript.
