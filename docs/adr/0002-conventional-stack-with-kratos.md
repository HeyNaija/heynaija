# ADR 0002 — Drop the AT Protocol; conventional stack with Ory Kratos

**Date:** 13 October 2026 · **Status:** Accepted · **Supersedes:** ADR 0001 and the
architecture sections of PLAN.md (§0, §2, §3, §5, §6 PDS parts, §8 Phase 0)

## Decision

heynaija is a conventional web application: Next.js, a NestJS API and PostgreSQL
as the source of truth for posts. Identity (accounts, passwords, sessions, email
verification, recovery) is delegated to a self-hosted Ory Kratos.

The self-hosted PDS, the PLC directory, the firehose indexer and AT OAuth are
removed.

## Why

The Phase 0 spike worked, but showed what the protocol costs a 200-person pilot:

- nothing can be private (no private communities, no DMs);
- we operate a PDS and hold identity keys we must never lose;
- sign-in happens on the PDS's page, which we cannot shape (and which labels our
  data "Bluesky");
- an indexer, eventual consistency and OAuth exist only because of the protocol.

In exchange it gives account portability, which members benefit from only if the
network succeeds and they later want to leave. The product hypothesis (PLAN.md §1)
does not depend on it.

Kratos rather than hand-written auth: password hashing, breach checks, session
handling, verification and recovery are security-critical and already solved.

## What this gives up

- Protocol-level portability and interoperability with other AT apps. A "download
  my data" export and the open-source codebase are the remaining ways to honour
  the community-ownership promise; neither is built yet.
- Moving to the AT Protocol later is possible but would be a migration project.

## How it works

- **One origin.** The browser only talks to the web app, which proxies the API
  under `/api/v1` and Kratos under `/kratos`. Cookies are first-party; no CORS.
- **Account pages** (`/login`, `/signup`, `/verification`, `/recovery`,
  `/settings`) render Kratos's self-service flows as plain HTML forms that post
  straight to Kratos. They work without JavaScript.
- **Sessions.** The API forwards the `hn_session` cookie to Kratos
  (`/sessions/whoami`) on every authenticated request. Nothing about sessions is
  stored or cached on our side.
- **Members.** `members.id` is the Kratos identity ID. The row is created the
  first time the API sees an identity that has redeemed an invite.
- **Invite-only signup.** `/join` checks the code and stores it in a short-lived
  HttpOnly cookie. Kratos passes that cookie to two API webhooks: one before the
  account is saved (is the code usable? abort with a message if not) and one
  after (spend it for this identity). The API refuses any identity without a
  redemption, so the invite rule is enforced by us, not by trust in the flow.
- **Posts** are rows in Postgres, soft-deleted. The feed excludes deleted posts
  and posts by inactive members.

## Known limitations

- **Losing the race for an invite's last use** leaves a Kratos account that the
  API refuses. It needs a new invite; there is no in-app way to attach one yet.
- **Handles can be changed** in settings. `members.handle` is a copy refreshed on
  the member's next request, so it can lag briefly.
- **No rate limiting of our own** on `/v1/invites/check`, posting or sign-in
  attempts. Codes carry 60 bits of entropy, so guessing is impractical, but this
  is required before any public exposure.
- **Kratos logs webhook request headers, including the shared secret, at `info`
  level.** Production must run at `warning` or otherwise keep those logs private.
- **Development-only settings:** Kratos runs with `--dev`, plain http, and its
  hooks call the API via `host.docker.internal`. There is no production Kratos
  configuration, SMTP provider or TLS yet.
- **Password change after recovery** was exercised up to the settings form but
  not submitted. Changing email or handle in settings is untested.
- **Tests** cover invites, posts and the session guard (25 cases, real Postgres,
  Kratos stubbed). The Kratos flows and web pages were verified by hand.
- Redis is in the dev stack but nothing uses it yet.
