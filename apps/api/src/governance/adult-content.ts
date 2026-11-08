import { AGE_ASSURANCE_METHODS } from '@heynaija/db'
import { type SQL, sql } from 'drizzle-orm'
import { ADULT_AGE, methodRank, rankRequired } from './age.js'

// Posts marked sensitive (ADR 0020, the 18+ label) reach only members who count
// as adults. Every read path checks it in the query that reads the posts, so the
// age is worked out in SQL: `isAdultFor(ageStatus(records, now),
// 'age_restricted_content')` from age.ts, written again for Postgres. The test
// beside this file holds the two to the same answers.

/** Only a member who counts as an adult may mark anything sensitive; a minor's post that needs it is removed instead. */
export class LabelNotAllowedError extends Error {}

const rank = sql.raw(`case a.method ${AGE_ASSURANCE_METHODS.map((method) => `when '${method}' then ${methodRank(method)}`).join(' ')} end`)

/** The band the record `a` gives today: from its date of birth, on today's date in Lagos, or else as stored. */
const band = sql`case
  when a.birth_date is not null
    then case when a.birth_date <= ((now() at time zone 'Africa/Lagos')::date - interval '${sql.raw(String(ADULT_AGE))} years')::date
      then '18_plus' else 'under_18' end
  else a.band end`

/**
 * `answer`, read from the record `a` that `ageStatus` would go by for `member`:
 * the strongest live record, the newest between equals; the "18 or older" box
 * (no date) counts as the member's statement. False when there is none.
 */
export const fromAgeRecord = (member: SQL | string, answer: SQL): SQL<boolean> => sql<boolean>`coalesce((
  select ${answer}
  from restricted.age_assurances a
  where a.member_id = ${member} and a.withdrawn_at is null
  order by ${rank} desc, a.assured_at desc
  limit 1
), false)`

/** True when the record `a` gives under 18 today: `ageStatus(records, now).band === 'under_18'`, for `fromAgeRecord`. */
export const underAdultAge = sql<boolean>`(${band}) = 'under_18'`

/**
 * True when `member` (an id, or a column such as a post's author) counts as an
 * adult for content marked sensitive. The strongest live record wins, the newest
 * between equals; a record with a date of birth gives its band from that date, on
 * today's date in Lagos. No record and under 18 are both false.
 */
export const countsAsAdult = (member: SQL | string): SQL<boolean> =>
  fromAgeRecord(member, sql`${rank} >= ${rankRequired('age_restricted_content')}::int and (${band}) = '18_plus'`)

/**
 * `countsAsAdult` for the member reading, and false signed out.
 *
 * It reads nothing from the row around it, so Postgres works it out once per
 * query, however many posts the query reads.
 */
export const seesAdultContent = (viewerId: string | null): SQL<boolean> => (viewerId ? countsAsAdult(viewerId) : sql<boolean>`false`)

/**
 * Whether a post carrying `label` (its adult_label) may reach `viewerId`: it is
 * unmarked, it is the viewer's own, or the viewer counts as an adult. The one test
 * for every query that shows posts.
 */
export const adultContentAllowed = (viewerId: string | null, label: SQL, authorId: SQL): SQL<boolean> =>
  viewerId
    ? sql<boolean>`(${label} is null or ${authorId} = ${viewerId} or ${seesAdultContent(viewerId)})`
    : sql<boolean>`(${label} is null)`

/**
 * Whether the community `adultOnly` belongs to may reach `viewerId`: it is not
 * marked sensitive, or the viewer counts as an adult (ADR 0020, question 8). To
 * anyone else it does not exist: not listed, found, shown, joined or posted in,
 * and nothing says why. Its posts carry the 'community' mark, so
 * `adultContentAllowed` keeps them from the same people.
 */
export const communityOpenTo = (viewerId: string | null, adultOnly: SQL = sql`"communities"."adult_only"`): SQL<boolean> =>
  viewerId ? sql<boolean>`(not ${adultOnly} or ${seesAdultContent(viewerId)})` : sql<boolean>`(not ${adultOnly})`
