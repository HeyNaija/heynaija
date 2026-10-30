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

Policy: **staging and development have every flag on. Production has a flag on only if
the feature is already live for everyone**; anything new or risky is off there until the
team decides to launch it, and an admin then turns it on at runtime.

## Adding a flag

1. Add it to `FLAGS` in `apps/api/src/flags/registry.ts`: a camelCase key, a
   description, the owning area and `defaults` for all three environments. Staging and
   development are `true`; production is `false` unless the feature is live.
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

Allow-lists hold member ids (resolved from handles when saved), so a later handle
change does not break them.

## Reading, caching and failure

Each API process keeps what it read for **5 seconds** (`FLAG_CACHE_TTL_MS`); concurrent
callers share one read. A change made through a process is seen by that process at
once; every other instance sees it within the TTL plus one read, so **a flip takes
effect everywhere in about 5 to 6 seconds**. Run the web app and e2e tests with this
in mind: after flipping a flag from another process, wait a few seconds.

**Fail closed.** If the database cannot be read, the last good values keep answering.
If there never was a good read, the **production** defaults answer (never staging's)
until a read works. Failures are logged and retried once per TTL.

## What is flagged today

See `FLAGS` in `apps/api/src/flags/registry.ts`; the admin page lists each with its
description and default for the environment.

## Tests and development

Dev and CI run the API with `APP_ENV=development`, so every flag is on and `pnpm e2e`
needs no setup. A test that needs a flag off or limited changes it with the admin API
and waits out the cache, or runs against an API started with `APP_ENV=production`.
