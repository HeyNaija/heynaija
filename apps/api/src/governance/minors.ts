import type { REPLY_AUDIENCES } from '@heynaija/db'
import { type SQL, sql } from 'drizzle-orm'
import { fromAgeRecord, underAdultAge } from './adult-content.js'

// The contact and discovery protections a member under 18 has from the start
// (ADR 0020, section 4, "Contact"), the way X keeps a minor's account to the
// people they chose: here, the people they follow. Everyone else is a stranger
// to them, whatever the stranger's own age, since ages are stated, not checked.
// A minor cannot loosen any of this before they turn 18.
//
// - Replies: a conversation a minor starts is limited to people they follow
//   ("everyone" reads as "following"), and replying straight to anything a minor
//   wrote, anywhere, needs them to follow you or to have mentioned you there.
// - Mentions: a stranger's @handle for a minor is plain text, as for a handle
//   nobody has, and tells them nothing.
// - Discovery: a minor is in nobody's Discover, search, @mention suggestions or
//   welcome-flow suggestions but their own circle's.
// - Profile: no age band, no location and no lists of followers, for anyone.
//
// The protections follow the age the rules work out (`ageStatus` in age.ts):
// someone with no date of birth on record yet is not treated as a minor here,
// since that would hide every member who has not answered yet, and they cannot
// use the app until they do. Nothing here asks whether a viewer is an adult, so
// an unknown age never counts as one.

/** True when `member` is under 18 as far as HeyNaija knows: `ageStatus(records, now).band === 'under_18'`, in SQL. */
export const isMinor = (member: SQL | string): SQL<boolean> => fromAgeRecord(member, underAdultAge)

/**
 * True when `member` is a minor and `viewer` is a stranger to them: signed out,
 * or someone other than themselves whom they do not follow. What such a viewer
 * is never shown or given.
 */
export const strangerToMinor = (viewer: SQL | string | null, member: SQL): SQL<boolean> =>
  viewer === null
    ? isMinor(member)
    : sql<boolean>`(${member} <> ${viewer}
        and not exists(select 1 from follows mf where mf.follower_id = ${member} and mf.followee_id = ${viewer})
        and ${isMinor(member)})`

/** Who may reply to a minor's new conversation, the default first: never everyone. */
export const MINOR_REPLY_AUDIENCES = ['following', 'mentioned'] as const satisfies readonly (typeof REPLY_AUDIENCES)[number][]

/** A minor's conversations are open only as far as "following", whatever was asked; they may still ask for "mentioned". */
export class ReplyAudienceNotAllowedError extends Error {}
