import type { Db } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { Env } from '../env.js'
import { HANDLE_HOLD_DAYS } from '../members/members.service.js'
import { DB, ENV } from '../tokens.js'

/**
 * What is kept after a deletion only for a while (docs/adr/0016), let go of by
 * the account worker every hour.
 */
@Injectable()
export class RetentionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'DELETED_CONTENT_RETENTION_DAYS'>,
  ) {}

  /** How many deleted posts were blanked, and how many handle holds ended. */
  async sweep(now = new Date()): Promise<{ posts: number; handles: number }> {
    return this.db.transaction(async (tx) => {
      // An erased account's handles are held so nobody can take one straight away
      // (docs/adr/0004). Once a hold is over the row only says what it was called.
      const handles = await tx.execute(sql`delete from released_handles r using members m
        where m.id = r.member_id and m.deleted_at is not null
          and r.released_at <= ${now}::timestamptz - make_interval(days => ${HANDLE_HOLD_DAYS})`)

      // Deleted posts, the ones members delete and the ones kept as evidence when an
      // account is erased, keep their text for moderation records for this long
      // (counsel log, C-04), and longer while a report about them is open. Unset,
      // nothing is blanked.
      const days = this.env.DELETED_CONTENT_RETENTION_DAYS
      if (days === undefined) return { posts: 0, handles: handles.rowCount ?? 0 }
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
      return { posts: rows[0]?.blanked ?? 0, handles: handles.rowCount ?? 0 }
    })
  }
}
