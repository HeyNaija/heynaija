import { type SQL, sql } from 'drizzle-orm'

// Community announcements (docs/adr/0029): a moderator notifies every member of
// a community about a new post in it. The rules both the posting side and the
// community's page read, written as SQL so they cost no extra round trip.

/** Hours a community waits between announcements, whoever of its moderators sends them. */
export const ANNOUNCEMENT_EVERY_H = 24

/**
 * Whether `memberId` may notify the community's members: an active member who
 * has joined it and moderates it, or moderates the whole site.
 */
export const mayAnnounce = (memberId: string, communityId: SQL) =>
  sql<boolean>`exists(select 1 from community_memberships cm join members m on m.id = cm.member_id and m.active
    where cm.community_id = ${communityId} and cm.member_id = ${memberId} and (cm.role = 'moderator' or m.role = 'moderator'))`

/** When the community's next announcement may go, given when its last went; null if one may go now. */
export const nextAnnouncementAt = (announcedAt: SQL) =>
  sql<Date | null>`(case when ${announcedAt} > now() - make_interval(hours => ${ANNOUNCEMENT_EVERY_H})
    then ${announcedAt} + make_interval(hours => ${ANNOUNCEMENT_EVERY_H}) end)`
