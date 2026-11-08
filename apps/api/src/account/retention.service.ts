import type { Db } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { Env } from '../env.js'
import { HANDLE_HOLD_DAYS } from '../members/members.service.js'
import { DB, ENV } from '../tokens.js'

type RetentionEnv = Pick<Env, 'DELETED_CONTENT_RETENTION_DAYS' | 'ERASED_AGE_RECORD_RETENTION_DAYS' | 'PRIVACY_REQUEST_RETENTION_DAYS'>

/** What one sweep let go of. */
export type Swept = { posts: number; handles: number; ageRecords: number; requests: number }

/**
 * What is kept after a deletion only for a while (docs/adr/0016), let go of by
 * the account worker every hour, for as long as /privacy#keep says. Taken-down
 * images are the media worker's (MediaService.purgeTakenDown).
 */
@Injectable()
export class RetentionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: RetentionEnv,
  ) {}

  /** How many deleted posts were blanked, handle holds ended, and age and privacy request records deleted. */
  async sweep(now = new Date()): Promise<Swept> {
    return this.db.transaction(async (tx) => {
      // An erased account's handles are held so nobody can take one straight away
      // (docs/adr/0004). Once a hold is over the row only says what it was called.
      const handles = await tx.execute(sql`delete from released_handles r using members m
        where m.id = r.member_id and m.deleted_at is not null
          and r.released_at <= ${now}::timestamptz - make_interval(days => ${HANDLE_HOLD_DAYS})`)

      // An erased account's age record goes with it, but its governance audit
      // trail (that it said it was 18 or older, and when) is kept for this long, so
      // HeyNaija can show the 18+ rule was applied (counsel log, C-06).
      const ageRecords = await tx.execute(sql`delete from restricted.governance_audit_log g using members m
        where m.id = g.subject_id and m.deleted_at is not null
          and m.deleted_at <= ${now}::timestamptz - make_interval(days => ${this.env.ERASED_AGE_RECORD_RETENTION_DAYS})`)

      // The record of a privacy request, to show it was handled on time (C-09).
      const requests = await tx.execute(sql`delete from privacy_requests
        where closed_at <= ${now}::timestamptz - make_interval(days => ${this.env.PRIVACY_REQUEST_RETENTION_DAYS})`)

      // Deleted posts, the ones members delete and the ones kept as evidence when an
      // account is erased, keep their text for moderation records for this long
      // (counsel log, C-04), and longer while a report about them is open.
      const days = this.env.DELETED_CONTENT_RETENTION_DAYS
      // One statement, so the posts past the period are looked for once an hour,
      // not once a table. Every part runs whether or not the last line reads it.
      // A poll kept with an evidence post goes now (its options and votes cascade).
      const { rows } = await tx.execute<{ blanked: number }>(sql`
        with expired as (select p.id from posts p
            where p.deleted_at <= ${now}::timestamptz - make_interval(days => ${days})
              and not exists(select 1 from reports r where r.post_id = p.id and r.status = 'open')),
          blanked as (update posts set text = '', link_url = null, quote_post_id = null
            where id in (select id from expired) and (text <> '' or link_url is not null or quote_post_id is not null)
            returning 1),
          mentions as (delete from post_mentions where post_id in (select id from expired)),
          hashtags as (delete from post_hashtags where post_id in (select id from expired)),
          titles as (update ideas set title = '' where title <> '' and post_id in (select id from expired)),
          problems as (delete from problem_details where post_id in (select id from expired)),
          polls as (delete from post_polls where post_id in (select id from expired))
        select count(*)::int as blanked from blanked`)
      return {
        posts: rows[0]?.blanked ?? 0,
        handles: handles.rowCount ?? 0,
        ageRecords: ageRecords.rowCount ?? 0,
        requests: requests.rowCount ?? 0,
      }
    })
  }
}
