# ADR 0004 — A handle given up by renaming is held for 30 days

**Date:** 15 October 2026 · **Status:** Accepted

## Decision

When a member changes their handle, the old one stays theirs for 30 days. Only
they can take it back. During that time `/u/<old handle>` leads to their profile
under the new handle. After 30 days the old handle is free for anyone.

## Why

Profiles, mentions, reports and moderation all name people by handle. If a freed
handle could be taken straight away, old links and mentions would lead to whoever
took it, and a newcomer could pick up a well-known handle to impersonate its
former owner.

## How

- Kratos keeps handles unique among current accounts: the handle is a credential
  identifier in `infra/kratos/identity.schema.json` (see ADR 0003). It knows
  nothing of past handles.
- The API keeps them in `released_handles`, one row per handle, for the member
  who gave it up last.
- Kratos calls the API just before saving a change in Settings
  (`/internal/kratos/settings`, with the handle before and after). The API refuses
  a handle someone else gave up in the last 30 days and records the one the member
  gives up. Sign-up checks the same thing in the invite webhook.
- `GET /v1/members/<handle>` answers 404 with `movedTo` for a held handle, and
  the profile page redirects there. Members who have blocked the viewer, and
  suspended members, are not followed.

## Consequences

- The API learns a new handle from the member's session, which it caches for 30
  seconds. Until it next sees the member with a fresh session after a rename, it
  still knows them by the old handle. Meanwhile the new `/u/` link does not work
  yet and the old one still shows their profile.
- Moderator commands that take a handle (`mod:grant`, suspend) do not follow
  the redirect. They need the member's current handle.
- Handles renamed through the Kratos admin API skip the webhook and are not held.
