import { createDb, runMigrations } from '@heynaija/db'
import { sql } from 'drizzle-orm'

// Tests run against a real Postgres: the guarantees worth testing (who wins the
// last use of an invite, who may delete what) are enforced in SQL.
const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL is not set (run via `pnpm test`)')

export const { db, pool } = createDb(url)

export const migrate = () => runMigrations(url)

export const reset = () =>
  db.execute(sql`truncate link_previews, notifications, notification_opt_outs, push_subscriptions, poll_votes, poll_options, post_polls, post_mentions, post_hashtags, media, moderation_actions, reports, blocks, mutes, likes, reposts, bookmarks, follows, community_memberships, communities, invite_redemptions, invites, profile_badges, restricted.identity_verifications, restricted.governance_memberships, restricted.governance_audit_log, restricted.age_assurances, posts, members cascade`)
