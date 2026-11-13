import { type Db, members } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { eq, inArray, sql } from 'drizzle-orm'
import { EMAIL_ADDRESSES, type EmailAddresses } from '../email/addresses.js'
import { MAILER, type Mailer, PermanentMailError } from '../email/mailer.js'
import { memberOfUnsubscribeToken, unsubscribeToken } from '../email/unsubscribe-token.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { strangerToMinor } from '../governance/minors.js'
import { excerpt } from '../notifications/notifications.service.js'
import { visibleAuthor } from '../posts/posts.service.js'
import { PushNotificationsService } from '../push/push-notifications.service.js'
import { DB } from '../tokens.js'
import { HIGHLIGHT_EXCERPT_MAX, type Highlight, highlightsPush, renderHighlights } from './highlights-email.js'
import { HIGHLIGHTS_RULES, type HighlightsRules, type HighlightsSchedule, openRun } from './rules.js'

export const HIGHLIGHTS_JOBS = Symbol('HIGHLIGHTS_JOBS')
export const HIGHLIGHTS_SETTINGS = Symbol('HIGHLIGHTS_SETTINGS')

/** What the highlights service needs from the job queue: somewhere to send work. */
export interface HighlightsJobs {
  /** Queues one member's highlights. Safe to repeat: a member has at most one waiting. */
  send(memberId: string): Promise<void>
}

export type HighlightsSettings = HighlightsSchedule & {
  /** The address members use for the web app: where every link in the email points. */
  webUrl: string
  /** The key unsubscribe links are signed with (email/unsubscribe-token.ts). */
  unsubscribeKey: Buffer
}

/** The rules, when the week's run starts, and whether highlights are being sent at all yet. */
export type PublishedRules = HighlightsRules & HighlightsSchedule & { live: boolean }

/** How a member's highlights went out, or null when nothing was sent. */
export type Sent = 'push' | 'email' | null

type Pusher = Pick<PushNotificationsService, 'enabled' | 'sendTo'>
type Flags = Pick<FeatureFlags, 'reading'>

// Members one pass queues; the rest follow on the next, a few minutes later.
const DUE_PER_SWEEP = 500

/**
 * Weekly highlights (ADR 0027): once a week, a member who has been away is sent
 * a few conversations from the week, chosen by published rules, each saying why
 * it was chosen. A push notification where they have push on, otherwise an email
 * where they have email on; never both, and nothing where they have neither.
 *
 * It is not a notification: nothing is written to `notifications`, and nothing
 * is recorded about what a member reads. `sweep` runs every few minutes and,
 * while the week's run is open, queues the members it has not dealt with yet;
 * `send` then decides, from what is true at that moment, whether there is
 * anything worth sending and sends it. A member is dealt with once per run,
 * whether or not anything went out.
 */
@Injectable()
export class HighlightsService {
  private readonly log = new Logger(HighlightsService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HIGHLIGHTS_JOBS) private readonly jobs: HighlightsJobs,
    @Inject(HIGHLIGHTS_SETTINGS) private readonly settings: HighlightsSettings,
    @Inject(FeatureFlags) private readonly flags: Flags,
    @Optional() @Inject(PushNotificationsService) private readonly push: Pusher | null = null,
    @Optional() @Inject(MAILER) private readonly mailer: Mailer | null = null,
    @Optional() @Inject(EMAIL_ADDRESSES) private readonly addresses: EmailAddresses | null = null,
  ) {}

  /** False when there is neither a mail server nor anything to push with: nothing can be sent. */
  get enabled(): boolean {
    return Boolean(this.push?.enabled) || (this.mailer !== null && this.addresses !== null)
  }

  /** What /about/highlights states. `live` is whether the flag is on for everyone, not just a list. */
  async rules(): Promise<PublishedRules> {
    const flag = await this.flags.reading('weeklyHighlights')
    return { ...HIGHLIGHTS_RULES, weekday: this.settings.weekday, hourUtc: this.settings.hourUtc, live: flag.isEnabled(null) }
  }

  /** Whether weekly highlights exist for this member yet: what Settings asks before offering the switch. */
  async offeredTo(memberId: string): Promise<boolean> {
    return (await this.flags.reading('weeklyHighlights')).isEnabled(memberId)
  }

  /** The link in a member's highlights email that turns them off. */
  unsubscribeUrl(memberId: string): string {
    return `${this.settings.webUrl}/api/v1/highlights/unsubscribe/${unsubscribeToken(this.settings.unsubscribeKey, memberId, 'highlights')}`
  }

  /**
   * Turns weekly highlights off for the member a link was made for, and changes
   * nothing else: not their notifications, not whether those are emailed. False
   * if the link is not one of ours.
   */
  async unsubscribe(token: string): Promise<boolean> {
    const memberId = memberOfUnsubscribeToken(this.settings.unsubscribeKey, token, 'highlights')
    if (!memberId) return false
    await this.db.update(members).set({ weeklyHighlights: false }).where(eq(members.id, memberId))
    return true
  }

  /**
   * Run every few minutes. While the week's run is open, queues each member it
   * has not dealt with who wants highlights and has been away long enough, but
   * not so long that they have left. Returns how many it queued.
   */
  async sweep(now = new Date()): Promise<number> {
    if (!this.enabled) return 0
    const run = openRun(now, this.settings)
    if (!run) return 0
    const flag = await this.flags.reading('weeklyHighlights')
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select m.id from members m
      where ${this.due(now, run)}
      order by m.id
      limit ${DUE_PER_SWEEP}`)
    // Off for this member (the flag is off, or on for a list they are not on):
    // dealt with, so they do not fill every pass of this run.
    const off = rows.filter(({ id }) => !flag.isEnabled(id)).map(({ id }) => id)
    if (off.length) await this.settle(off, now)
    const on = rows.filter(({ id }) => flag.isEnabled(id))
    for (const { id } of on) await this.jobs.send(id)
    if (on.length) this.log.log(`weekly highlights: ${on.length} members queued`)
    return on.length
  }

  /**
   * Chooses and sends one member's highlights, if they are still due and there
   * is enough worth sending: a push notification if one of their browsers or
   * apps takes it, otherwise an email if they have email on. Returns how it went
   * out. Throws when nothing could be reached and trying again may work, leaving
   * the member for the job's next try.
   */
  async send(memberId: string, now = new Date()): Promise<Sent> {
    const run = openRun(now, this.settings)
    if (!run) return null
    const [member] = await this.db
      .select({ handle: members.handle, email: members.emailNotifications, lastSeenAt: members.lastSeenAt, settledAt: members.highlightsSettledAt })
      .from(members)
      .where(sql`${members.id} = ${memberId} and ${this.due(now, run, sql`${members}`)}`)
    // Not due any more: they came back, turned it off, or another try already sent it.
    if (!member?.lastSeenAt) return null
    if (!(await this.offeredTo(memberId))) return null

    // Only what started after they were last here, so nothing in it is something
    // they have already seen, and never what an earlier run already covered.
    const since = new Date(
      Math.max(member.lastSeenAt.getTime(), member.settledAt?.getTime() ?? 0, now.getTime() - HIGHLIGHTS_RULES.windowDays * 86_400_000),
    )
    const highlights = await this.pick(memberId, since, now)
    if (highlights.length < HIGHLIGHTS_RULES.minPosts) {
      await this.settle([memberId], now)
      return null
    }

    let unreachable: unknown = null
    if (this.push?.enabled) {
      try {
        const message = highlightsPush(highlights, excerpt)
        if (message && (await this.push.sendTo(memberId, [message]))) {
          await this.settle([memberId], now, true)
          return 'push'
        }
      } catch (error) {
        // Their push services could not be reached: email instead, if they have it on.
        unreachable = error
      }
    }

    if (member.email && this.mailer && this.addresses) {
      const to = await this.addresses.addressFor(memberId)
      if (to) {
        const unsubscribeUrl = this.unsubscribeUrl(memberId)
        const email = renderHighlights({ handle: member.handle, highlights, webUrl: this.settings.webUrl, unsubscribeUrl })
        try {
          await this.mailer.send({ to, subject: email.subject, text: email.text, html: email.html, unsubscribeUrl })
        } catch (error) {
          if (!(error instanceof PermanentMailError)) throw error
          // Trying again would fail the same way: leave this week's unsent.
          this.log.warn(`weekly highlights to member ${memberId} were refused for good: ${error.message}`)
          await this.settle([memberId], now)
          return null
        }
        await this.settle([memberId], now, true)
        return 'email'
      }
    }

    if (unreachable) throw unreachable
    // Nowhere to send it: no push, and email off or no address.
    await this.settle([memberId], now)
    return null
  }

  /**
   * A member's highlights as of `now`: top-level posts started after `since`
   * that someone took part in or whose author the member follows, the ones with
   * most going on first, one per author. What is left out is what Discover
   * leaves out (ADR 0014): the member's own posts, anyone they blocked or muted
   * or who is suspended, posts taken down, marked sensitive or held by reports,
   * and a minor's posts to someone the minor does not follow.
   */
  async pick(memberId: string, since: Date, now = new Date()): Promise<Highlight[]> {
    const rules = HIGHLIGHTS_RULES
    const from = sql`${since.toISOString()}::timestamptz`
    const until = sql`${now.toISOString()}::timestamptz`
    const { rows } = await this.db.execute<{
      id: string
      text: string
      people: number
      likes: number
      followed: number
      follows_author: boolean
      in_joined: boolean
      author_handle: string
      community_name: string | null
      via_handle: string | null
      via_action: 'replied' | 'quoted' | 'reposted' | null
    }>(sql`
      -- The people the member follows and can see.
      with followed as materialized (
        select f.followee_id as id from follows f join members m on m.id = f.followee_id
        where f.follower_id = ${memberId} and ${visibleAuthor(memberId, sql`f.followee_id`, sql`m.active`)}
      ),
      -- Reported by enough members, or by the image scanner, and not yet decided.
      held as materialized (
        select r.post_id from reports r
        where r.status = 'open' and r.post_id is not null
        group by r.post_id
        having count(distinct r.reporter_id) >= ${rules.reportsToHold}::int or bool_or(r.reporter_id is null)
      ),
      candidates as materialized (
        select p.id, p.author_id, p.created_at, p.text, p.community_id,
          p.author_id in (select id from followed) as follows_author,
          exists(select 1 from community_memberships cm join communities c on c.id = cm.community_id and c.active
            where cm.member_id = ${memberId} and cm.community_id = p.community_id) as in_joined
        from posts p join members a on a.id = p.author_id
        where p.reply_parent_id is null and p.gist_id is null and not p.superseded
          and p.created_at > ${from} and p.created_at <= ${until}
          and p.deleted_at is null and p.removed_at is null
          -- Posts marked sensitive are never recommended, to anyone (ADR 0020).
          and p.adult_label is null
          and p.author_id <> ${memberId}
          and ${visibleAuthor(memberId, sql`p.author_id`, sql`a.active`)}
          and not exists(select 1 from held h where h.post_id = p.id)
          -- A minor is recommended to nobody but the people they follow (ADR 0020).
          and not ${strangerToMinor(memberId, sql`p.author_id`)}
      ),
      -- Who replied (anywhere in the conversation), quoted or reposted. A reply or
      -- quote comes after its post, so all of them are in the window too.
      acts as materialized (
        select r.root_id as post_id, r.author_id as member_id, r.created_at as at, 'replied' as action
        from posts r join members m on m.id = r.author_id and m.active
        where r.created_at > ${from} and r.created_at <= ${until} and r.root_id in (select id from candidates)
          and r.deleted_at is null and r.removed_at is null
        union all
        select q.quote_post_id, q.author_id, q.created_at, 'quoted'
        from posts q join members m on m.id = q.author_id and m.active
        where q.created_at > ${from} and q.created_at <= ${until} and q.quote_post_id in (select id from candidates)
          and q.deleted_at is null and q.removed_at is null
        union all
        select rp.post_id, rp.member_id, rp.created_at, 'reposted'
        from reposts rp join members m on m.id = rp.member_id and m.active
        where rp.post_id in (select id from candidates) and rp.created_at <= ${until}
      ),
      tallies as (
        select a.post_id,
          count(distinct a.member_id) filter (where a.action <> 'reposted' and a.member_id <> c.author_id) as conversation,
          count(*) filter (where a.action = 'reposted') as reposts,
          count(distinct a.member_id) filter (where a.member_id <> c.author_id and f.id is not null) as followed
        from acts a join candidates c on c.id = a.post_id left join followed f on f.id = a.member_id
        group by a.post_id
      ),
      liked as (
        select l.post_id, count(*) as likes
        from likes l join members m on m.id = l.member_id and m.active
        where l.post_id in (select id from candidates) and l.created_at <= ${until}
        group by l.post_id
      ),
      scored as (
        select c.*, coalesce(t.conversation, 0)::int as people, coalesce(l.likes, 0)::int as likes,
          coalesce(t.reposts, 0)::int as reposts, coalesce(t.followed, 0)::int as followed,
          ${rules.conversationPoints}::int * coalesce(t.conversation, 0)
            + ${rules.likePoints}::int * coalesce(l.likes, 0)
            + ${rules.repostPoints}::int * coalesce(t.reposts, 0)
            + ${rules.followedPoints}::int * coalesce(t.followed, 0)
            + case when c.follows_author then ${rules.followsAuthorPoints}::int else 0 end
            + case when c.in_joined then ${rules.joinedCommunityPoints}::int else 0 end as points
        from candidates c left join tallies t on t.post_id = c.id left join liked l on l.post_id = c.id
      ),
      -- Worth sending: someone took part, or the member follows the author. One per author, their best.
      worth as (
        select s.*, row_number() over (partition by s.author_id order by s.points desc, s.created_at desc, s.id desc) as nth
        from scored s
        where s.people + s.likes + s.reposts > 0 or s.follows_author
      ),
      -- The person the member follows who acted last, to name.
      named as (
        select distinct on (a.post_id) a.post_id, a.member_id, a.action
        from acts a join candidates c on c.id = a.post_id join followed f on f.id = a.member_id
        where a.member_id <> c.author_id
        order by a.post_id, a.at desc, a.member_id
      )
      select w.id, w.text, w.people, w.likes, w.followed, w.follows_author, w.in_joined,
        a.handle as author_handle, c.name as community_name, vm.handle as via_handle, n.action as via_action
      from worth w join members a on a.id = w.author_id
        left join communities c on c.id = w.community_id and c.active
        left join named n on n.post_id = w.id left join members vm on vm.id = n.member_id
      where w.nth = 1
      order by w.points desc, w.created_at desc, w.id desc
      limit ${rules.maxPosts}`)
    return rows.map((r): Highlight => ({
      postId: r.id,
      author: r.author_handle,
      community: r.community_name,
      excerpt: excerpt(r.text, HIGHLIGHT_EXCERPT_MAX),
      people: r.people,
      likes: r.likes,
      reason:
        r.via_handle && r.via_action
          ? { kind: 'network', handle: r.via_handle, action: r.via_action, others: Math.max(0, r.followed - 1) }
          : r.follows_author
            ? { kind: 'following' }
            : r.in_joined && r.community_name
              ? { kind: 'community' }
              : { kind: 'active' },
    }))
  }

  /**
   * Who the run that started at `run` still has to deal with, as of `now`: an
   * active member with highlights on, away for at least `awayDays` and at most
   * `stopAfterDays`, whom this run has not settled. `m` is the members row.
   */
  private due(now: Date, run: Date, m = sql`m`) {
    const at = sql`${now.toISOString()}::timestamptz`
    return sql`${m}.active and ${m}.deleted_at is null and ${m}.weekly_highlights
      and (${m}.highlights_settled_at is null or ${m}.highlights_settled_at < ${run.toISOString()}::timestamptz)
      and ${m}.last_seen_at <= ${at} - make_interval(days => ${HIGHLIGHTS_RULES.awayDays}::int)
      and ${m}.last_seen_at > ${at} - make_interval(days => ${HIGHLIGHTS_RULES.stopAfterDays}::int)`
  }

  /** Marks members as dealt with by this run, and as sent to when something went out. */
  private async settle(ids: string[], now: Date, sent = false): Promise<void> {
    await this.db
      .update(members)
      .set(sent ? { highlightsSettledAt: now, highlightsSentAt: now } : { highlightsSettledAt: now })
      .where(inArray(members.id, ids))
  }
}
