# Feature roadmap audit

Audit date: 17 October 2026. Baseline: local `staging` at `2aa9b86`, matching
the cached `origin/staging` reference at the start of this work. Existing uncommitted
About-page and navigation changes were preserved and extended. `main` was not used.
This is a code/test/documentation audit, not a live deployment or legal audit.

## One maintained feature inventory

Edit `docs/feature-roadmap.json`, then run `pnpm roadmap:generate`,
`pnpm roadmap:check` and `pnpm roadmap:test`. The generator and public `/progress`
page share the validator, status definitions, priority ordering and grouping in
`apps/web/lib/roadmap.ts`. The schema is versioned and documented in the generated
Markdown. No production availability is inferred from implementation.

The repository metadata was checked through GitHub on the audit date and reported
`private`. Public pages therefore link to the readable `/progress` inventory and
licence explanation, not to private source or developer evidence. Evidence paths
and operational details remain in developer documentation. There is no working
governance feedback channel to link yet.

## Corrections to older descriptions

- `PRODUCT.md` listed data export as absent. The API, download route, format-3
  service tests and governance browser tests demonstrate it exists, including
  reposts, quote references and age declarations. Sensitive person keys and
  reports about the member stay excluded.
- `PRODUCT.md` described a public moderation log. The log endpoint and service
  enforce moderator roles; ordinary members are explicitly denied in tests.
  Public governance records are a separate planned feature.
- `PRODUCT.md` said core social flows worked without JavaScript. `PLAN.md` and
  `docs/e2e.md` already document the streaming limitation and expected failures.
  The new static information pages are tested independently; their readability
  does not fix social feeds or posting.
- The earlier About copy and positioning could imply publicly available source.
  An AGPL file exists, but the repository is private. Source publication remains
  blocked on owner review and publication.
- Governance information is available; voting, verification, membership activation
  and treasury operations are not. Information pages and disabled groundwork do
  not make those features operational.
- Local feed labels are Latest and Following. A label such as “For you” elsewhere
  would not change the chronological implementation. Basic trending currently
  scores recent posts using twice the reply count plus likes, then time and ID;
  it is not national/state trend analytics or a personalised recommender.
- `PLAN.md` previously called production deployment the only missing work, while
  its own beta checklist still had safety, operations, disclosure and performance
  gaps. Its current-roadmap section now points to the generated inventory.
- Staging documentation records a laptop backup/restore rehearsal, but leaves
  deployed backup and restore acceptance unchecked. That supports partial status,
  not a completed recovery claim. Google sign-in is configured but explicitly
  excluded from current end-to-end coverage, so it is partial pending a real
  provider journey. Password recovery is explicitly disabled (ADR 0003): emailed
  sign-in codes restore access while the member controls their email, but there
  is no separate process for loss of that email account. Older README and PLAN
  recovery wording has been corrected.

## Priority decisions

P0 remains the threshold for a safe, usable public beta, even for incomplete work.
Account deletion and a working privacy-request contact were promoted from the
brief’s initial P2 proposal to P0: the policy currently offers a placeholder
contact and there is no self-service deletion. A missing rights/contact route is
not merely a growth feature. No-JavaScript core social journeys stay P0 because
they are an existing access commitment, separately from future low-data settings.

Identity verification, badges, adult voting membership, ballots, legal ownership
and treasury operations stay blocked until their separate prerequisites are met.
No gates, application features, migrations or operational settings were changed.
Later ideas remain proposals, without delivery dates or invented completion scores.

## Founder and operator confirmations still needed

- Names and roles of custodians, legal operator, funding disclosure and a real
  privacy/safety contact; decide and operate the governance feedback channel.
- Authority and readiness to publish source; the repository remains private.
- Which local revision is actually deployed on staging and production. Individual
  feature availability remains unknown without a live check.
- Recovery acceptance, monitored alerts, backup and media recovery, response
  ownership and current operational rehearsals.
- Scanning-provider approval, legal/privacy decisions and an operational abuse
  response process before uploads expand beyond the invited pilot.
- The legal entity, draft adoption, identity-provider approvals, secure eligibility,
  independent ballot assurance and child-safety prerequisites already listed in
  `docs/governance/open-items.md`. The temporary beta age declaration is not a
  verified adult age and does not satisfy voting eligibility.

The About origin is presented as a product motivation supplied in the brief,
not a personal founder memoir, founding date or invented historical event.

## Updates since the audit

- 18 October 2026: Google sign-in moved to Implemented, recorded in production.
  `e2e/tests/google-auth.spec.ts` now covers signup, sign-in and account linking
  against a local signed OIDC issuer, and the owner reported a real Google sign-in
  on staging and production. The registry gained a `production` availability
  value; the deployment entry now records both environments as deployed. Account
  recovery stays Partial: Kratos recovery is still disabled and there is no
  process for losing access to the account email.

## Validation record

- `pnpm roadmap:check` and `pnpm roadmap:test`: generated Markdown is in sync;
  all 7 schema, evidence-path, dependency and generation checks pass.
- `pnpm typecheck`, plus the updated e2e workspace typecheck: pass.
- Final production web build: pass; both `/about` and `/progress` are included.
- Existing API suite: 213 tests pass against its local scratch database.
- Existing web unit suite: 17 tests pass.
- Existing governance, data-export and sharing browser journeys: 14 pass across
  the selected desktop/mobile projects.
- New `information.spec.ts` journeys: 12 pass. They cover signed-out reading
  without JavaScript, separate light/dark theme checks, registry counts and public
  caveats, priority anchors, signed-in account navigation, public entry points,
  and 320px layouts. Desktop/mobile screenshots were visually reviewed.
- A dev-server stylesheet-cache issue was caught by the CSS assertion. Restarting
  alone retained the stale cache; regenerating the disposable development cache
  resolved it, and the same layout assertion then passed. The known social
  no-JavaScript expected failures remain unchanged.
