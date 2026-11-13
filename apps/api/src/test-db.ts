import { ageAssurances, createDb, runMigrations } from '@heynaija/db'
import { sql } from 'drizzle-orm'

// Tests run against a real Postgres: the guarantees worth testing (who wins the
// last use of an invite, who may delete what) are enforced in SQL.
const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL is not set (run via `pnpm test`)')

export const { db, pool } = createDb(url)

export const migrate = () => runMigrations(url)

export const reset = () =>
  db.execute(sql`truncate games.community_teams, games.xp_totals, games.competition_invites, games.keno_tickets, games.keno_rounds, games.chess_games, games.chess_challenges, games.lichess_link_attempts, games.lichess_accounts, games.game_events, games.competition_entries, games.competitions, games.season_scores, games.seasons, games.game_profiles, gist_members, gists, link_previews, notifications, notification_opt_outs, push_subscriptions, push_devices, poll_votes, poll_options, post_polls, post_mentions, post_hashtags, media, moderation_actions, reports, blocks, mutes, likes, reposts, bookmarks, follows, community_memberships, communities, invite_redemptions, invites, profile_badges, restricted.identity_verifications, restricted.governance_memberships, restricted.governance_audit_log, restricted.age_assurances, posts, members restart identity cascade`)

/** A date of birth that makes someone `years` old today in Lagos (never after the 28th, so every month has it). */
export function bornYearsAgo(years: number): string {
  const today = new Date(Date.now() + 60 * 60 * 1000)
  return new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), Math.min(today.getUTCDate(), 28))).toISOString().slice(0, 10)
}

/**
 * Records the date of birth each member gave, as everyone has since ADR 0020: an
 * adult's unless `years` says otherwise. Hosting Gists and posting video need one.
 */
export const giveBirthDates = (memberIds: string[], years = 30) =>
  db.insert(ageAssurances).values(
    memberIds.map((memberId) => ({ memberId, band: years >= 18 ? ('18_plus' as const) : ('under_18' as const), method: 'self_declared' as const, birthDate: bornYearsAgo(years) })),
  )
