# Stage 5 identity migration

This runbook describes how to introduce application-owned identity mappings
without changing existing HeyNaija member IDs or invalidating current logins.

It is separate from adding a second authentication provider. Kratos remains the
only enabled provider.

## Why this is necessary

The current application uses the Kratos identity UUID as `members.id`. That works
while Kratos is the only authentication backend, but it couples every social row
to one provider's identifier.

Stage 5 adds an application-owned boundary:

```text
(provider_id, subject) -> member_id
```

The mapping allows HeyNaija to keep a stable member identity if authentication
changes later. It also gives the application ownership of handle uniqueness and
account-linking policy. Email addresses are not used to merge accounts.

Existing member IDs are not rewritten. An existing Kratos subject is initially
mapped to the same UUID already stored in `members.id`, so posts, follows,
invites, age records, moderation state, governance state, exports, and current
sessions keep their existing ownership.

## Release shape

The migration uses three phases:

1. **Expand:** `schema.ts` defines the mapping and migration-run tables. Drizzle
   generates and reviews the SQL migration before it is merged.
2. **Backfill:** deployment applies the committed schema migration, then an
   operator runs the idempotent backfill command.
3. **Cut over:** after the application is verified to resolve subjects through the
   mapping, the operator marks the run as cut over. Mapping deletion is refused
   after this point; recovery uses restore or a forward fix.

The server does not generate SQL. The deployment's Compose `migrate` service
applies committed migrations before the API starts. It runs a duplicate-handle
preflight first because the schema migration adds a unique current-handle index.

## Before applying the migration

1. Deploy the release containing the generated Drizzle migration and the
   compatibility-mode application code.
2. Confirm that the database backup job is healthy.
3. Create a fresh backup and record its timestamp or backup path:

   ```bash
   cd /srv/heynaija/infra/deploy
   ./backup.sh
   ```

4. Do not proceed if the backup command fails.

The deployment itself runs this preflight before `db:migrate`:

```bash
node dist/cli/identity-migrate.js --preflight --allow-remote
```

If duplicate current handles exist, deployment stops before the unique index is
created. Resolve those handles through the application policy, make a new backup,
and deploy again.

## Preview the backfill

After the API is running, preview the existing data. Preview does not write rows:

```bash
cd /srv/heynaija/infra/deploy
docker compose exec -T api node dist/cli/identity-migrate.js \
  --allow-remote
```

The report includes the number of members, existing Kratos mappings, missing
mappings, conflicts, foreign mappings, and duplicate handles.

The command refuses to continue if a provider subject already maps to a different
member or if a mapping points at a missing member.

## Run the backfill

Use the backup reference created before deployment:

```bash
docker compose exec -T api node dist/cli/identity-migrate.js \
  --apply \
  --allow-remote \
  --backup-ref 2026-10-19T03:15Z \
  --confirm APPLY_IDENTITY_MIGRATION
```

The command:

- takes a PostgreSQL advisory lock so two operators cannot backfill together;
- checks duplicate handles again;
- checks existing mapping conflicts;
- inserts only missing `kratos` mappings;
- preserves each existing `members.id` exactly;
- records the run and each inserted row;
- commits all data changes in one transaction; and
- prints a `runId` for verification and later rollback.

It is safe to retry after a successful run. Already-existing mappings are skipped.

## Verify

Run verification after the backfill:

```bash
docker compose exec -T api node dist/cli/identity-migrate.js \
  --verify \
  --allow-remote
```

Verification must report:

- zero missing mappings;
- zero mapping conflicts;
- zero mappings pointing at missing members; and
- zero duplicate current handles.

Keep the JSON output with the deployment record.

## Mark application cutover

Do this only after the deployed application has been tested and the runtime code
is ready to require the mapping rather than relying on the legacy Kratos-ID
fallback.

```bash
docker compose exec -T api node dist/cli/identity-migrate.js \
  --cutover <run-id> \
  --allow-remote \
  --confirm MARK_IDENTITY_CUTOVER
```

The cutover marker is an operational safety boundary. It prevents the rollback
command from deleting mappings after application code depends on them.

## Rollback

Before cutover, a backfill run may be rolled back if its mappings still have the
same ownership recorded by that run:

```bash
docker compose exec -T api node dist/cli/identity-migrate.js \
  --rollback <run-id> \
  --allow-remote \
  --confirm ROLLBACK_IDENTITY_MIGRATION
```

Rollback removes only mappings recorded by that run. It does not delete members,
posts, social relationships, invite records, age records, or migration tables.

After cutover, rollback is refused. Do not delete mappings manually. Restore the
database backup only when a full database restore is appropriate, or deploy a
forward fix that repairs the mapping while preserving member ownership.

## Adding another authentication provider later

The mapping migration does not enable another provider by itself. Before adding
one, complete this checklist:

### Provider adapter

- Add a provider-specific session adapter implementing credential recognition,
  authentication, cache invalidation, and provider failure classification.
- Add flow, account, and lifecycle adapters for every capability the product
  exposes.
- Keep provider protocol DTOs, cookies, tokens, redirects, CSRF, OAuth state and
  PKCE inside the adapter.
- Declare capabilities explicitly; unsupported operations must fail on the server.

### Registry and configuration

- Register the provider under a unique configured `providerId`.
- Add and validate its credentials and redirect-origin configuration.
- Reject unknown or incomplete provider configurations at startup.
- Do not select a provider from an untrusted browser-supplied value.
- Reject conflicting credentials and never fall back to another provider after a
  rejection, timeout, or outage.

### Identity and account policy

- Treat the provider subject as opaque and resolve it only through
  `provider_identities`.
- Verify that an existing subject is not already owned by another member.
- Never merge accounts by email, handle, display name, or matching profile data.
- Require explicit authorization, provider proof, and recent authentication before
  linking an identity.
- Require recent authentication before unlinking, and never unlink the member's
  last authentication identity.
- Keep the application member ID, handle owner, invite redemption, age records,
  suspension state, moderation state, export ownership, and governance state
  independent of the provider.

### Browser interaction binding

- Persist interaction state with its provider ID, initiating browser/session
  binding, expiry, replay protection, and validated return target.
- Keep an interaction with the provider selected at its start.
- Preserve provider cookies and OAuth state through redirects.
- Do not retry the same interaction against another provider.

### Validation before enabling it

- Add contract tests for session, flow, account, and lifecycle behavior.
- Test identical subjects under different providers cannot collide.
- Test two providers cannot become one member without explicit linking.
- Test account switching, logout, reauthentication, provider failure, and expired
  or foreign interactions in a real browser.
- Run live-provider journeys separately from fixture tests.
- Enable new signup or login paths only after invite, age, handle, suspension,
  export, moderation, and governance behavior has been verified for that provider.

## Local and CI usage

The repository command builds the database and API packages, then runs the same
compiled command:

```bash
pnpm identity:backfill
pnpm identity:backfill -- --apply --backup-ref local-backup --confirm APPLY_IDENTITY_MIGRATION
```

CI applies the normal committed Drizzle migrations while preparing its test
database. It does not run the production backfill automatically. Pull requests
targeting `staging` run the browser e2e job before they can be merged into that
branch.

## Important limits

- This migration does not enable a second authentication provider.
- It does not merge accounts by email.
- It does not rewrite existing member IDs.
- A generated SQL migration must be reviewed and committed; do not hand-edit or
  invent a production migration at deployment time.
- The mapping backfill is not evidence of a live second-provider integration.
- Runtime identity cutover, explicit account-linking UX, and a second provider are
  separate work from this Kratos mapping migration.
