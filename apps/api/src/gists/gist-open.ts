import { type SQL, sql } from 'drizzle-orm'

/**
 * Whether `memberId` could open the Gist, as GistsService.open decides it apart from
 * the `gists` flag (which is read in code): an active member, in the Gist's community
 * if it has one, not on its removed list, and unless on the stage not blocked with
 * anyone on it. A Gist whose host erased their account is gone.
 *
 * A second copy of the rule in `isCallsMember` (eligibility.ts), which SQL cannot call: when
 * that gains conditions (18+, verification, opt-in), add them here in the same change.
 */
export const memberOpensGist = (memberId: SQL | string, gistId: SQL): SQL<boolean> => sql<boolean>`(
  exists(select 1 from members om where om.id = ${memberId} and om.active)
  and exists(select 1 from gists og join members oh on oh.id = og.host_id
    where og.id = ${gistId} and oh.deleted_at is null
      and (og.community_id is null or exists(select 1 from communities oc
        join community_memberships ocm on ocm.community_id = oc.id
        where oc.id = og.community_id and oc.active and ocm.member_id = ${memberId})))
  and not exists(select 1 from gist_members orm where orm.gist_id = ${gistId} and orm.member_id = ${memberId} and orm.removed_at is not null)
  and (
    exists(select 1 from gist_members osm where osm.gist_id = ${gistId} and osm.member_id = ${memberId}
      and osm.removed_at is null and osm.role in ('host', 'cohost', 'speaker'))
    or not exists(select 1 from gist_members ost
      join blocks ob on (ob.blocker_id = ${memberId} and ob.blocked_id = ost.member_id)
        or (ob.blocked_id = ${memberId} and ob.blocker_id = ost.member_id)
      where ost.gist_id = ${gistId} and ost.removed_at is null and ost.role in ('host', 'cohost', 'speaker'))
  )
)`
