import { type SQL, sql } from 'drizzle-orm'

/**
 * Chess Arena (docs/adr/0028): while a game is on, replies in its thread by anyone
 * but the two players are hidden from the two players. A courtesy, not anti-cheat:
 * anyone can watch on lichess.org. True when the post (a reply: `rootId` set) is in
 * an unfinished game's thread, `viewerId` plays in it and `authorId` does not. Once
 * the game ends, everything shows. The thread's own first post is never hidden.
 */
export const hiddenFromPlayer = (viewerId: string | SQL | null, rootId: SQL, authorId: SQL): SQL =>
  viewerId === null
    ? sql`false`
    : sql`(${rootId} is not null and exists(select 1 from games.chess_games hg
        where hg.thread_post_id = ${rootId} and hg.finished_at is null
          and ${viewerId} in (hg.white_id, hg.black_id) and ${authorId} not in (hg.white_id, hg.black_id)))`
