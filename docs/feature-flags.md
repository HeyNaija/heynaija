# Feature flags

Flags switch product behaviour on and off while the app runs, with no deploy and no
restart. They are defined in code, overridden in the database, and read by the API.

## How a flag is decided

For one flag and one viewer, first match wins:

1. **Allow-list.** If the flag lists members, it is on for those members only and off
   for everyone else, signed out included, whatever the rest says.
2. **Override.** An admin set it on or off for everyone.
3. **Default** from the registry for this deployment's `APP_ENV`.

A key the registry does not know is ignored wherever it turns up (a stray database
row, a request), so the database can never add behaviour.

## Environments

`APP_ENV` is `development`, `staging` or `production`. Unset or empty means
**production**. Development scripts (`pnpm dev:api`, the API's `start`) default it to
`development`; the staging server sets `staging` in `infra/deploy/.env`; the template
(`.env.example`) says `production` on purpose, so an unedited copy cannot switch on
unlaunched features.

Policy:

- **Staging and development have every flag on.**
- **Production is on for what is already live there**: the feature's code is in `main`,
  which deploys to production on every push. Merging the flag system changes nothing in
  production. The registry test keeps a `LIVE_IN_MAIN` table of exactly this, so any
  change to a production default is a visible diff in review.
- **Production is off for a feature whose code is not in `main` yet.** An admin turns it
  on at runtime when the team decides to launch.
- Switching a live feature off is an admin action, never a default.

## Adding a flag

1. Add it to `FLAGS` in `apps/api/src/flags/registry.ts`: a camelCase key, a
   description, the owning area and `defaults` for all three environments. Staging and
   development are `true`; production is `false` unless the feature's code is already in
   `main`. Add the key to `LIVE_IN_MAIN` in `feature-flags.test.ts` with the same value.
2. Gate the behaviour, keeping the default behaviour identical to before:
   - a route: `@UseGuards(SessionGuard, FeatureGuard)` and `@Feature('key')` (404 while
     off; list `FeatureGuard` after the session guard so the viewer is known);
   - code: inject `FeatureFlags` and `await flags.isEnabled('key', memberId)`;
   - the web app: read `me.features.key` from `/v1/me`.
3. Gate creation, not existing data. Turning a flag off must never strand or hide data
   that was made while it was on, so an off flag stops new use and leaves what exists.
4. Add a test next to the change. Nothing else is needed: the table, `/v1/me` and the
   admin page pick the new key up.

Switches that guard against work that is not allowed yet (`NIN_VERIFICATION_ENABLED`
and the other locked-off settings in `apps/api/src/env.ts`) are deliberately not flags:
they cannot be turned on from the database, only by building the feature and changing
the code in review.

## Flags with a code rule on top: `videoPosts`

`videoPosts` (off in production, on in staging and development) is also gated in code,
which an admin cannot flip: it is effective only when the flag is on **and** (an
upload scanner other than `NoScanner` is bound **or** `APP_ENV` is not `production`).
Every video route (`/v1/me/videos/...`) answers the same 404 as a route that does not
exist when it is not effective, signed in or not, and `/v1/me` reports
`features.videoPosts` as the effective value. See `docs/safety/video-scanning.md`.
On top of that, only an adult by stated age may post one (ADR 0019 section 4.6):
the upload and the post refuse anyone else, and `/v1/me` reports `videoPosts` off
for them.

## Flags with a code rule on top: `gists`

`gists` (off in production, on in staging and development) replaced the env switches
`CALLS_ENABLED`, `CALLS_GISTS_ENABLED` and `CALLS_MEMBERS` on 3 November 2026; the
handle list became the flag's allow-list, set from the admin page. Its code is in
`main`, but production's default is off, so `LIVE_IN_MAIN` says `false`: an admin
turns it on there, for everyone or for a list.

One rule in code (`gistsAccess` in `apps/api/src/gists/gists-enabled.guard.ts`) sits
on top of it, and an admin cannot flip it:

- **No LiveKit, no Gists.** Without the `LIVEKIT_*` settings Gists are off whatever
  the flag says.

Until 10 November 2026 there was a second: in production only an allow-list opened
Gists, and "on for everyone" opened them to nobody (ADR 0017's temporary gate). The
owner dropped it that day: the stage has its age rule (a stated adult age, below) and
the beta takes adults only, so the flag now means the same in every environment.

For a member Gists are not open to, every `/v1/gists` route answers the 404 of a
route that does not exist. A signed-out caller is let on to the sign-in 401 while
Gists are open to anyone, so a shared Gist link asks them to sign in. `/v1/me` reports
`features.gists` as the effective value, and every eligibility check in the Gists
service reads the flag again (once per request, so the checks stay synchronous).
The flag opens Gists to listen to; hosting and speaking also need an adult by
stated age (ADR 0020), which `/v1/me` reports as `gistStage`.
LiveKit's webhook and the once-a-minute reconcile run while LiveKit is configured,
whatever the flag says: turning `gists` off, or taking a member off its list, takes
people out of Gists already live within a minute, and the empty rooms then end.

The `GISTS_*` numbers (co-host, speaker and listener caps) are limits, not switches,
and stay in the env.

## `gistReplies`

`gistReplies` (off in production, on in staging and development) gates writing a reply in
a Gist's comment section (ADR 0017). It only has an effect where `gists` is on: every
`/v1/gists` route is behind the `gists` rules above first. Off stops new replies and
leaves the existing ones readable; deleting your own reply, liking and unliking one, and
the host's hiding, keep working. `/v1/me` reports it in `features.gistReplies`.

Rollback. Turning the flag off does not hide replies that exist. Rolling the API back to a
release before migration 0037 does worse: its queries only know `reply_parent_id is null`, so
a Gist's replies would show in feeds, search, profiles and `/p/:id`. Production is shielded
while the flag is off. Before rolling back past 0037 on an environment that has Gist replies,
soft-hide them (`update posts set removed_at = now() where gist_id is not null`) or accept
that they appear. Do not give them a sentinel `reply_parent_id`.

## `adultLabels`

`adultLabels` (off in production, on in staging and development) gates marking posts
sensitive (ADR 0020, the 18+ label): the "Mark as sensitive" switch under attached media
in the composer, the item in a post's menu, the Settings switch that marks everything a
member posts, the moderators' "Mark sensitive" decision and the report reason "Sensitive,
but not marked sensitive". `/v1/me` reports it in `features.adultLabels`.

It gates making marks only. Enforcement never reads it: a post already marked is kept from
signed-out visitors, members with no date of birth and anyone under 18 whatever the flag
says, and adults keep its media covered unless they chose otherwise. Taking your own mark
off, and a moderator taking theirs off, always work.

Rollback. A release before migration 0039 does not know `posts.adult_label` and would show
marked posts to everyone. Before rolling back past 0039 on an environment with marked posts,
take them down (`update posts set removed_at = now() where adult_label is not null`) and
restore them afterwards, or accept that they show.

## Flipping a flag

Site moderators (the site-wide role) use **Moderation, Feature flags** in the web app,
or the API:

```
GET /v1/admin/flags
PUT /v1/admin/flags/:key    {"enabled": true | false | null, "handles": ["ada"]}
```

`enabled: null` with no handles follows the default again; handles with `enabled: null`
is an allow-list; handles together with `true` or `false` is refused. Writes are
rate limited and every one is audited in `feature_flag_changes` (who, the override
before, the override after), in the same transaction as the change. The page shows the
latest changes. There is no separate "recent sign-in" check: admin writes elsewhere in
the API (moderation) rely on the session alone, and so do these.

Allow-lists and the log hold member ids (resolved from handles when saved), so a
later handle change does not break them; the page shows each member's handle as it is
now. An erased account cannot be listed.

## Erasing an account

When an account is erased ([ADR 0016](adr/0016-account-deletion.md)) the erase takes it
off every allow-list, in the same transaction. A list that held only that member was on
for nobody else, so the flag is switched off for everyone instead of falling back to its
default, which may be on. Each of these changes is in the log with no admin named
("Erasing an account changed …"). Changes the member made as a site moderator stay in
the log, which shows them as the tombstone (`deleted-…`): the log never stores a handle.

## Reading, caching and failure

Each API process keeps what it read for **5 seconds** (`FLAG_CACHE_TTL_MS`); concurrent
callers share one read. A change made through a process is seen by that process at
once; every other instance sees it within the TTL plus one read, so **a flip takes
effect everywhere in about 5 to 6 seconds**. Run the web app and e2e tests with this
in mind: after flipping a flag from another process, wait a few seconds.

**Fail closed.** If the database cannot be read, the last good values keep answering.
If there never was a good read, the **production** defaults answer (never staging's)
until a read works. Failures are logged and retried once per TTL.

## `communityAnnouncements`

`communityAnnouncements` (off in production, on in staging and development) gates a
community's moderator notifying every member of a new post in it (ADR 0029): `announce`
on `POST /v1/posts` answers `feature_unavailable` while it is off. Communities report
`viewerCanAnnounce`, `nextAnnouncementAt` and `viewerGetsAnnouncements` as "no" for a
viewer the flag is off for, so the composer's switch and the bell on a community's page
are not shown; the web and the apps read those, not the flag. The box for them in
Settings does read `features.communityAnnouncements`, and is left out while it is off,
keeping its setting (`settingsFor`). Turning a community's
announcements back on (`PUT /v1/communities/:slug/announcements`) is a 404 while it is
off; turning them off always works. Off stops new announcements and leaves the ones
already sent in members' notifications.

## Known limits

- The kill switches (`reposts`, `quotePosts`, `linkPreviews`) are on in production, so a
  failed first read after a restart answers with the production default, which is on,
  for one TTL. Fail-closed means "production default", not "off".
- The web app does not hide the pin, community-pin, reply-audience and quote buttons
  while their flags are off; the click does nothing (the API answers 404 or 400).
  Composer polls and reply controls, the welcome flow and trending topics (page and
  links) do follow the flags.
- A flag turned off stops new use only. Content made while it was on stays.

## What is flagged today

See `FLAGS` in `apps/api/src/flags/registry.ts`; the admin page lists each with its
description and default for the environment.

## Tests and development

Dev and CI run the API with `APP_ENV=development`, so every flag is on and `pnpm e2e`
needs no setup. A test that needs a flag off or limited changes it with the admin API
and waits out the cache, or runs against an API started with `APP_ENV=production`.
