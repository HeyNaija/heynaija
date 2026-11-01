import { sql } from 'drizzle-orm'

// Who may add, replace or remove a community's photo: an active member who
// moderates that community or the whole site. One rule for the community page,
// the upload endpoints and reports, written as columns for a query on
// `communities` so it costs no extra round trip.

/** Whether `memberId` is an active site moderator. */
export const isSiteModerator = (memberId: string) =>
  sql<boolean>`exists(select 1 from members m where m.id = ${memberId} and m.active and m.role = 'moderator')`

/** Whether `memberId` may change the photo of the community the surrounding query selects. */
export const managesPhoto = (memberId: string) =>
  sql<boolean>`("communities"."active" and (${isSiteModerator(memberId)} or exists(
    select 1 from community_memberships cm join members m on m.id = cm.member_id and m.active
    where cm.community_id = "communities"."id" and cm.member_id = ${memberId} and cm.role = 'moderator')))`
