import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const REPLY_AUDIENCES = ['everyone', 'following', 'mentioned'] as const

// A member of the network. `id` is the Ory Kratos identity ID: Kratos owns the
// email, password and sessions; this table holds only what the app itself needs.
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey(),
    // Copy of the Kratos `handle` trait, refreshed whenever the member is seen.
    // Not unique here: Kratos keeps handles unique (the handle is a credential
    // identifier in infra/kratos/identity.schema.json), and this copy can briefly
    // lag a rename, so for a moment two rows can hold the same handle.
    handle: text('handle').notNull(),
    // Inactive members (suspended, deactivated) are filtered out of feeds on read.
    active: boolean('active').notNull().default(true),
    status: text('status'),
    // 'moderator' here means site-wide. Community moderators are on the membership.
    role: text('role', { enum: ['member', 'moderator'] }).notNull().default('member'),
    // The member's current profile photo, if they have set one (see `media`).
    avatarMediaId: uuid('avatar_media_id'),
    // Shown alongside the handle. Optional; the handle stands alone without it.
    displayName: text('display_name'),
    bio: text('bio').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at'),
    // When the member finished or skipped the welcome flow (/welcome). Null until
    // then, and the home page sends them there. Migration 0019 set it for everyone
    // who joined before the flow existed, so only newcomers see it.
    onboardedAt: ts('onboarded_at'),
    // Whether notifications are also sent by email (docs/adr/0009). New members
    // start on; migration 0021 turned it off for everyone who joined before email
    // existed, since they were never asked. Turned off in Settings or by the link
    // in any email.
    emailNotifications: boolean('email_notifications').notNull().default(true),
    // When a notification email was last sent to them. The next one waits a while
    // after it, so a steady trickle of activity is not a steady trickle of mail.
    lastNotificationEmailAt: ts('last_notification_email_at'),
    // The one of their own top-level posts they keep at the top of their profile.
    // Shown only while it is live; a post removed for good takes the pin with it.
    pinnedPostId: uuid('pinned_post_id').references((): AnyPgColumn => posts.id, { onDelete: 'set null' }),
  },
  (t) => [index('members_handle_idx').on(t.handle)],
)

// A handle a member gave up by renaming. For a while afterwards only they can take
// it back, and /u/<handle> leads to their new one, so old links and mentions do
// not reach someone new (see MembersService.handleHeld). Written by the Kratos
// settings webhook just before the rename is saved; one row per handle, for the
// member who gave it up last.
export const releasedHandles = pgTable('released_handles', {
  handle: text('handle').primaryKey(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id),
  releasedAt: ts('released_at').notNull().defaultNow(),
})

// An uploaded file. The bytes live in object storage; this row tracks who owns it
// and whether it has been checked and processed. Only 'ready' media is ever shown.
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => members.id),
    kind: text('kind', { enum: ['avatar', 'post_image'] }).notNull(),
    // pending: an upload URL was issued. processing: uploaded, waiting for the
    // background job. ready: processed and public. failed: it was not a usable
    // image. deleted: replaced or removed by its owner, or abandoned.
    // quarantined: taken down by a moderator; the files are kept privately.
    // blocked: matched known abuse material; the original is kept privately.
    status: text('status', { enum: ['pending', 'processing', 'ready', 'failed', 'deleted', 'quarantined', 'blocked'] })
      .notNull()
      .default('pending'),
    // What the browser said it would send; the upload URL only accepts exactly this.
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    // Dimensions of the largest processed version, so pages can reserve the space.
    width: integer('width'),
    height: integer('height'),
    // A GIF kept as an animated WebP, with a still of its first frame beside it so
    // readers can pause it. False for ordinary images.
    animated: boolean('animated').notNull().default(false),
    // Post images only: the post it belongs to (null until the post is made),
    // its place among that post's images, and its description for screen readers.
    postId: uuid('post_id').references(() => posts.id),
    position: integer('position'),
    alt: text('alt').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
    readyAt: ts('ready_at'),
  },
  (t) => [
    index('media_owner_status_idx').on(t.ownerId, t.status),
    index('media_post_idx').on(t.postId),
  ],
)

// What a web address in a post leads to, fetched once and shared by every post
// that links there: the page's title, description and a thumbnail we keep
// ourselves (readers' browsers never contact the linked site). A card is shown
// only when 'ready'. A page that could not be read is 'failed' and tried again
// after an hour, and a 'ready' one is refreshed after a week.
export const linkPreviews = pgTable(
  'link_previews',
  {
    url: text('url').primaryKey(),
    status: text('status', { enum: ['pending', 'ready', 'failed'] })
      .notNull()
      .default('pending'),
    title: text('title'),
    description: text('description'),
    siteName: text('site_name'),
    // The thumbnail's file name in the media bucket (links/<imageId>/640.webp) and
    // its size, so the card can reserve its space. Null when the page had no usable image.
    imageId: uuid('image_id'),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    fetchedAt: ts('fetched_at'),
  },
  (t) => [index('link_previews_requested_idx').on(t.requestedAt)],
)

// A public interest group. Anyone can read it; members can post into it.
export const communities = pgTable('communities', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  rules: text('rules').notNull().default(''),
  // Inactive communities disappear from lists; their posts stay in members' profiles.
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
  // A top-level post in the community its moderators keep at the top: a welcome,
  // or the guidance everyone should read. Shown only while it is live.
  pinnedPostId: uuid('pinned_post_id').references((): AnyPgColumn => posts.id, { onDelete: 'set null' }),
})

export const communityMemberships = pgTable(
  'community_memberships',
  {
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    role: text('role', { enum: ['member', 'moderator'] }).notNull().default('member'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.communityId, t.memberId] }),
    index('community_memberships_member_idx').on(t.memberId),
  ],
)

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => members.id),
    text: text('text').notNull(),
    replyParentId: uuid('reply_parent_id'),
    rootId: uuid('root_id'),
    // A quote post: an ordinary post with its own text that embeds another post.
    // No foreign key, like reply_parent_id: a quoted post that is gone, or that the
    // reader may not see, is shown as a placeholder.
    quotePostId: uuid('quote_post_id'),
    // The root post owns the conversation boundary. Replies retain this column's
    // default but inherit the root's value when policy is checked.
    replyAudience: text('reply_audience', { enum: REPLY_AUDIENCES }).notNull().default('everyone'),
    // The first web address in the text, without its #fragment: the one that gets a
    // preview card. Matches link_previews.url; null when the text has no address.
    linkUrl: text('link_url'),
    // At most one community per post. Replies inherit their parent's.
    communityId: uuid('community_id').references(() => communities.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Soft delete: the row stays for moderation and audit, but leaves every feed.
    deletedAt: ts('deleted_at'),
    // Taken down by a moderator (as opposed to deleted by its author). Reversible.
    removedAt: ts('removed_at'),
    // Likes by active members, and direct replies that are live and by active
    // members: what readers see. Kept by triggers (migration 0011), in the same
    // transaction as the like, reply, deletion or suspension that changes them.
    likeCount: integer('like_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    // Reposts by active members, kept the same way (migration 0015). Quotes are
    // posts of their own and are not counted here.
    repostCount: integer('repost_count').notNull().default(0),
  },
  (t) => [
    index('posts_created_idx').on(t.createdAt, t.id),
    index('posts_author_created_idx').on(t.authorId, t.createdAt),
    index('posts_reply_parent_created_idx').on(t.replyParentId, t.createdAt, t.id),
    index('posts_community_created_idx').on(t.communityId, t.createdAt),
    index('posts_quote_idx').on(t.quotePostId).where(sql`quote_post_id is not null`),
    check('posts_reply_audience_check', sql.raw(`reply_audience in (${REPLY_AUDIENCES.map((value) => `'${value}'`).join(', ')})`)),
    // Full-text search. 'simple' (no stemming) suits mixed English, Pidgin and names.
    index('posts_text_search_idx').using('gin', sql`to_tsvector('simple', ${t.text})`),
  ],
)

// An informal social poll attached to one post. This is deliberately separate
// from governance ballots: it has no eligibility, quorum or binding effect.
export const postPolls = pgTable(
  'post_polls',
  {
    postId: uuid('post_id')
      .primaryKey()
      .references(() => posts.id, { onDelete: 'cascade' }),
    multiple: boolean('multiple').notNull().default(false),
    // Null means the creator explicitly chose "never". New polls default to a
    // seven-day expiry in application policy, where the requested preset lives.
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Active members who have voted, and on each option below the active members
    // who chose it. Kept by triggers (migration 0028), in the same transaction as
    // the ballot or suspension that changes them, like posts.like_count.
    voterCount: integer('voter_count').notNull().default(0),
  },
  (t) => [check('post_polls_expiry_check', sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.createdAt}`)],
)

export const pollOptions = pgTable(
  'poll_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => postPolls.postId, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    voteCount: integer('vote_count').notNull().default(0),
  },
  (t) => [
    uniqueIndex('poll_options_post_position_idx').on(t.postId, t.position),
    uniqueIndex('poll_options_post_text_idx').on(t.postId, sql`lower(${t.text})`),
    unique('poll_options_post_id_unique').on(t.postId, t.id),
    check('poll_options_position_check', sql`${t.position} between 0 and 9`),
    // Application policy counts 80 graphemes; this wider database ceiling only
    // guards pathological input because one visible grapheme may use many code points.
    check('poll_options_text_check', sql`char_length(${t.text}) between 1 and 1280`),
  ],
)

// Votes are public. One row is one selected option; a multiple-choice ballot has
// several rows with the same post/member, written in one statement, so they share
// created_at. PostsService locks the poll row before accepting the member's one
// immutable ballot.
export const pollVotes = pgTable(
  'poll_votes',
  {
    postId: uuid('post_id').notNull(),
    optionId: uuid('option_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.memberId, t.optionId] }),
    foreignKey({ columns: [t.postId, t.optionId], foreignColumns: [pollOptions.postId, pollOptions.id] }).onDelete('cascade'),
    index('poll_votes_option_idx').on(t.postId, t.optionId),
    index('poll_votes_member_idx').on(t.memberId, t.createdAt),
    // The public voter list, newest ballot first, a page at a time.
    index('poll_votes_ballot_idx').on(t.postId, t.createdAt, t.memberId),
  ],
)

// A member named with @handle in a post, reply or quote, written with the post
// (posts are never edited). Stored by member ID, so the mention keeps leading to
// the same person after they rename, while the text keeps the handle as written.
// `start` and `length` say where that @handle is in the text, in UTF-16 code
// units as JavaScript counts them, so a reader's app can link exactly that span.
export const postMentions = pgTable(
  'post_mentions',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    start: integer('start').notNull(),
    length: integer('length').notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.start] }), index('post_mentions_member_idx').on(t.memberId)],
)

// A #hashtag in a post, reply or quote, written with the post. `tag` is the key
// every spelling shares (#EndSARS and #endsars are one topic): the letters after
// the #, composed (NFC) and in lower case. `start` and `length` say where it is
// in the text, in UTF-16 code units, as for mentions. Posts from before hashtags
// were recorded have no rows, so their #words stay plain text.
export const postHashtags = pgTable(
  'post_hashtags',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    tag: text('tag').notNull(),
    start: integer('start').notNull(),
    length: integer('length').notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.start] }), index('post_hashtags_tag_idx').on(t.tag, t.postId)],
)

export const likes = pgTable(
  'likes',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.memberId] }), index('likes_member_idx').on(t.memberId)],
)

// Sharing someone's post, as it is, with the people who follow you. It shows in
// their Following feed and on your profile at the time you reposted it; whether
// it still shows (the post deleted, either member blocked or muted) is decided
// when it is read.
export const reposts = pgTable(
  'reposts',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.postId] }),
    // A post's reposts in time order: "has anyone you follow reposted this since?"
    // is answered from the index alone, even for a post with thousands of reposts.
    index('reposts_post_created_idx').on(t.postId, t.createdAt, t.memberId),
    // A few members' reposts are read from here (a profile, a light follower)...
    index('reposts_member_created_idx').on(t.memberId, t.createdAt),
    // ...and the newest reposts site-wide from here, for someone who follows
    // many accounts: a Following page is found near the top.
    index('reposts_created_idx').on(t.createdAt, t.postId, t.memberId),
  ],
)

// Private to the member: nobody else can see what you saved.
export const bookmarks = pgTable(
  'bookmarks',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.postId] })],
)

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => members.id),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => members.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index('follows_followee_idx').on(t.followeeId),
  ],
)

// Blocking is mutual invisibility: neither side sees the other's posts, and the
// blocked member cannot follow, reply to or like the blocker.
export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => members.id),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => members.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('blocks_blocked_idx').on(t.blockedId)],
)

// Muting is one-sided and silent: the muter stops seeing the muted member's posts.
export const mutes = pgTable(
  'mutes',
  {
    muterId: uuid('muter_id')
      .notNull()
      .references(() => members.id),
    mutedId: uuid('muted_id')
      .notNull()
      .references(() => members.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.muterId, t.mutedId] })],
)

export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'scam', 'illegal', 'other', 'appeal'] as const

// A report about a post or an account. An appeal is a report a suspended member
// files about themselves (reason 'appeal'), so it lands in the same queue. A
// report with no reporter was filed by the upload scanner, not by a person.
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').references(() => members.id),
    postId: uuid('post_id').references(() => posts.id),
    memberId: uuid('member_id').references(() => members.id),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    details: text('details').notNull().default(''),
    status: text('status', { enum: ['open', 'actioned', 'dismissed'] }).notNull().default('open'),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => members.id),
  },
  (t) => [index('reports_status_created_idx').on(t.status, t.createdAt)],
)

export const MODERATION_ACTIONS = [
  'remove_post',
  'restore_post',
  'suspend_member',
  'reinstate_member',
  'dismiss_report',
  'remove_avatar',
  'clear_profile',
  'grant_community_moderator',
  'revoke_community_moderator',
] as const

// Append-only record of every moderator decision: who did what, to what, and why.
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => members.id),
    action: text('action', { enum: MODERATION_ACTIONS }).notNull(),
    postId: uuid('post_id').references(() => posts.id),
    memberId: uuid('member_id').references(() => members.id),
    reportId: uuid('report_id').references(() => reports.id),
    // Role changes: the community concerned.
    communityId: uuid('community_id').references(() => communities.id),
    note: text('note').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('moderation_actions_created_idx').on(t.createdAt)],
)

export const NOTIFICATION_KINDS = [
  'reply',
  'like',
  'repost',
  'quote',
  'mention',
  'follow',
  'post_removed',
  'post_restored',
  'report_resolved',
  'account_reinstated',
  'avatar_removed',
  'profile_cleared',
  'moderator_granted',
  'moderator_revoked',
  // An idea you sent or voted for changed status; detail is the new status.
  'idea_status',
] as const

// Something that happened to a member: a reply, like, repost, quote, mention or follow by
// someone else, or a moderation decision about their post, account or report. Rows are written
// when it happens; whether one is still shown (the actor blocked, the post
// deleted, the like taken back) is decided when it is read.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => members.id),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
    // Who did it. Null for moderation decisions, which come from "the moderators".
    actorId: uuid('actor_id').references(() => members.id),
    // reply: the reply. like, repost: the post liked or reposted. quote: the quote
    // post (not the post it quotes). mention: the post that mentions the recipient.
    // Moderation: the post decided on.
    postId: uuid('post_id').references(() => posts.id),
    // report_resolved about an account: that account.
    subjectId: uuid('subject_id').references(() => members.id),
    // moderator_granted / moderator_revoked: the community.
    communityId: uuid('community_id').references(() => communities.id),
    // report_resolved: 'actioned' or 'dismissed'. post_removed: the report reason.
    detail: text('detail'),
    createdAt: ts('created_at').notNull().defaultNow(),
    readAt: ts('read_at'),
    // Null until the email side has dealt with it: sent in a digest, or passed
    // over (read in the app first, email off, nothing left to show, too old).
    // Migration 0021 set it for everything that happened before email existed.
    emailSettledAt: ts('email_settled_at'),
    // Null until the push side has dealt with it (docs/adr/0011): pushed, or
    // passed over (read first, no device to push to, too old). Email waits for
    // this. Migration 0022 set it for everything that happened before push existed.
    pushSettledAt: ts('push_settled_at'),
    // When at least one of the member's devices took it as a push notification.
    // What has been pushed is not emailed as well.
    pushedAt: ts('pushed_at'),
  },
  (t) => [
    index('notifications_recipient_created_idx').on(t.recipientId, t.createdAt),
    // What the email job looks through: only what is still waiting, which is a
    // few minutes' worth.
    index('notifications_email_pending_idx')
      .on(t.recipientId, t.createdAt)
      .where(sql`email_settled_at is null`),
    // The same for the push job, which has seconds' worth.
    index('notifications_push_pending_idx')
      .on(t.recipientId, t.createdAt)
      .where(sql`push_settled_at is null`),
    // Deleting a post or a member must find the notifications pointing at it;
    // without these each delete scanned the whole table.
    index('notifications_actor_idx').on(t.actorId),
    index('notifications_post_idx').on(t.postId),
    // Liking, unliking and liking again (or reposting, or following again) notifies once.
    uniqueIndex('notifications_like_once_idx')
      .on(t.recipientId, t.actorId, t.postId)
      .where(sql`kind = 'like'`),
    uniqueIndex('notifications_repost_once_idx')
      .on(t.recipientId, t.actorId, t.postId)
      .where(sql`kind = 'repost'`),
    uniqueIndex('notifications_quote_once_idx')
      .on(t.recipientId, t.actorId, t.postId)
      .where(sql`kind = 'quote'`),
    uniqueIndex('notifications_mention_once_idx')
      .on(t.recipientId, t.actorId, t.postId)
      .where(sql`kind = 'mention'`),
    uniqueIndex('notifications_follow_once_idx')
      .on(t.recipientId, t.actorId)
      .where(sql`kind = 'follow'`),
  ],
)

// The kinds of notification a member may turn off: other members' activity.
// Moderation and account notices are not optional; members are always told
// about decisions that affect them.
export const OPTIONAL_NOTIFICATION_KINDS = [
  'reply',
  'like',
  'repost',
  'quote',
  'mention',
  'follow',
] as const satisfies readonly (typeof NOTIFICATION_KINDS)[number][]

// A kind of notification a member has turned off. Everything is on until they
// turn it off, so only what is off is stored. The check keeps the other kinds
// out whatever writes here.
export const notificationOptOuts = pgTable(
  'notification_opt_outs',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    kind: text('kind', { enum: OPTIONAL_NOTIFICATION_KINDS }).notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.memberId, t.kind] }),
    check(
      'notification_opt_outs_kind_check',
      sql.raw(`kind in (${OPTIONAL_NOTIFICATION_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
  ],
)

// A browser that agreed to show a member's notifications as push notifications
// (docs/adr/0011): the address its push service (Google, Mozilla, Apple or
// Microsoft) gave it, and the keys that encrypt what is sent there. One row per
// browser: when someone else signs in on it and turns push on, the row moves to
// them. Signing out deletes it.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    endpoint: text('endpoint').notNull(),
    // The browser's public key (P-256, base64url) and its 16-byte auth secret.
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    // When its push service last accepted a notification for it.
    lastPushedAt: ts('last_pushed_at'),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint), index('push_subscriptions_member_idx').on(t.memberId)],
)

// Signup is invite-only. Only the SHA-256 of a code is stored.
export const invites = pgTable('invites', {
  codeHash: text('code_hash').primaryKey(),
  note: text('note'),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: ts('expires_at'),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
})

// One row per account created with an invite. An identity is only accepted as a
// member if it has a row here, so this table is what enforces invite-only signup.
export const inviteRedemptions = pgTable('invite_redemptions', {
  identityId: uuid('identity_id').primaryKey(),
  codeHash: text('code_hash')
    .notNull()
    .references(() => invites.codeHash),
  createdAt: ts('created_at').notNull().defaultNow(),
})

// ---------------------------------------------------------------------------
// Identity, age and governance (ADRs 0005 and 0006). Groundwork only: identity
// verification, voting membership and binding votes are switched off, and the
// API refuses to start if anyone tries to switch them on (apps/api/src/env.ts).
//
// What would reveal something about a person beyond their public profile lives
// in its own Postgres schema, `restricted`, so that before verification opens it
// can get its own database role, encrypted storage and separate admin access.
// Ordinary reads (profiles, posts, feeds, search) never join it; the public
// badge has its own table below. Never store a raw NIN, a plain hash of one, a
// date of birth, a legal name or a provider's raw response anywhere.
// ---------------------------------------------------------------------------
export const restricted = pgSchema('restricted')

// Age is its own thing, separate from having an account, from identity
// verification and from voting membership (ADR 0006). Each row is one statement
// about which age band an account holder is in, and how we know it. Only a band
// is ever stored: never an age, a birth date or a document. An account with no
// live row has an unknown age, which never counts as an adult (accounts created
// before 16 October 2026 start that way). The status a feature acts on is worked
// out from these rows by ageStatus() in apps/api/src/governance/age.ts.
export const AGE_BANDS = ['under_18', '18_plus'] as const

// self_declared: the person said so (the "I am 18 or older" box on /join).
// moderator_review: a moderator decided it, e.g. under the mistaken-age process
// in the rules (not built). identity_provider: an age result from an identity
// check such as NINAuth. age_assurance_provider: an age check that is not an
// identity check (not chosen or built). The last two count as verified.
export const AGE_ASSURANCE_METHODS = ['self_declared', 'moderator_review', 'identity_provider', 'age_assurance_provider'] as const

export const ageAssurances = restricted.table(
  'age_assurances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The Kratos identity, which becomes members.id. No foreign key: the signup
    // webhook writes the first row before the members row exists.
    memberId: uuid('member_id').notNull(),
    band: text('band', { enum: AGE_BANDS }).notNull(),
    method: text('method', { enum: AGE_ASSURANCE_METHODS }).notNull(),
    // identity_provider: the verification the result came from, so revoking that
    // verification withdraws this too.
    verificationId: uuid('verification_id').references(() => identityVerifications.id),
    // moderator_review: who decided. Null when the member or a provider did.
    recordedBy: uuid('recorded_by'),
    // under_18 only: when to check the band again, at the latest the month the
    // person turns 18 (rounded up), so the account can move to adult without a
    // birth date being kept. Nothing writes under_18 yet.
    reviewAfter: ts('review_after'),
    assuredAt: ts('assured_at').notNull().defaultNow(),
    // Set when the statement stops counting: its source was revoked, consent was
    // withdrawn, or a moderator decision was overturned on appeal. Kept as history.
    withdrawnAt: ts('withdrawn_at'),
  },
  (t) => [
    index('age_assurances_member_idx').on(t.memberId, t.assuredAt),
    // One standing self-declaration per account.
    uniqueIndex('age_assurances_one_declaration_idx')
      .on(t.memberId)
      .where(sql`method = 'self_declared' and withdrawn_at is null`),
  ],
)

export const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected', 'expired', 'revoked'] as const

// One row per attempt to verify a member's identity with a provider (NINAuth).
// A member has at most one live (pending or verified) row; older ones are kept,
// marked expired, revoked or rejected, as the record of what happened.
export const identityVerifications = restricted.table(
  'identity_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    // Which provider answered, e.g. 'ninauth'.
    provider: text('provider').notNull(),
    status: text('status', { enum: VERIFICATION_STATUSES }).notNull(),
    // A keyed HMAC of the provider's pseudonymous identifier for the person, so
    // one person cannot verify two accounts. Null when the provider gives no
    // stable identifier, and then formal voting stays blocked for this member.
    // Requires provider confirmation that such an identifier exists.
    personKey: text('person_key'),
    // An age result from the same check, if any, is kept in age_assurances: who
    // someone is and how old they are are separate questions.
    // The wording the member agreed to, and when.
    consentVersion: text('consent_version').notNull(),
    consentedAt: ts('consented_at').notNull(),
    verifiedAt: ts('verified_at'),
    expiresAt: ts('expires_at'),
    // A person on the team checked this verification before any public badge.
    reviewedAt: ts('reviewed_at'),
    reviewedBy: uuid('reviewed_by').references(() => members.id),
    revokedAt: ts('revoked_at'),
    // A short code (duplicate_person, superseded, member_withdrew, fraud, ...),
    // never text from the provider.
    outcome: text('outcome'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('identity_verifications_member_idx').on(t.memberId, t.createdAt),
    uniqueIndex('identity_verifications_live_member_idx')
      .on(t.memberId)
      .where(sql`status in ('pending', 'verified')`),
    // One verified account per person, per provider.
    uniqueIndex('identity_verifications_person_idx')
      .on(t.provider, t.personKey)
      .where(sql`status = 'verified' and person_key is not null`),
  ],
)

export const GOVERNANCE_MEMBERSHIP_STATUSES = ['pending', 'active', 'suspended', 'resigned'] as const

// A platform user's voluntary online voting participation, NOT the legal
// association register. 'resigned' means online opt-out, not legal resignation.
// Formal legal admission needs its own reviewed register before activation.
// A member's explicit opt-in to voting membership. Separate from identity
// verification on purpose: verifying never makes anyone a voting member. Whether
// they may vote is worked out on read from this row, their verification and the
// rules (apps/api/src/governance/rules.ts). Never shown publicly.
export const governanceMemberships = restricted.table('governance_memberships', {
  memberId: uuid('member_id')
    .primaryKey()
    .references(() => members.id),
  status: text('status', { enum: GOVERNANCE_MEMBERSHIP_STATUSES }).notNull(),
  optedInAt: ts('opted_in_at').notNull(),
  // The governing documents they accepted, e.g. 'constitution-0.3'.
  documentsVersion: text('documents_version').notNull(),
  statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
  suspendedUntil: ts('suspended_until'),
  // Shown to the member and to reviewers of their appeal, never in public.
  suspensionReason: text('suspension_reason'),
})

export const GOVERNANCE_AUDIT_EVENTS = [
  'age_declared',
  'age_recorded',
  'age_withdrawn',
  'verification_recorded',
  'verification_rejected',
  'verification_reviewed',
  'verification_revoked',
  'badge_shown',
  'badge_hidden',
  'membership_opted_in',
  'membership_resigned',
  'membership_suspended',
  'membership_reinstated',
] as const

// Append-only trail of every change to the tables above: who (null when the
// system or the provider did it), what, to whom, and a short reason code. No
// free text and nothing from the provider, so the trail itself leaks nothing.
export const governanceAuditLog = restricted.table(
  'governance_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectId: uuid('subject_id').notNull(),
    actorId: uuid('actor_id'),
    event: text('event', { enum: GOVERNANCE_AUDIT_EVENTS }).notNull(),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('governance_audit_log_subject_idx').on(t.subjectId, t.createdAt)],
)

// The green identity tick, and Founder: one of the people who founded HeyNaija,
// given by hand with `pnpm founder:grant` and kept for good (it says nothing about identity).
export const PROFILE_BADGES = ['nin_identity_verified', 'founder'] as const

// Badges shown on public profiles and next to authors' names. A tick row exists
// only while the tick may be shown and its owner chose to show it; the API also
// hides the tick while NIN verification is switched off. Profiles read this
// table, never `restricted`.
export const profileBadges = pgTable(
  'profile_badges',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    kind: text('kind', { enum: PROFILE_BADGES }).notNull(),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    // Copied from the verification, so an expired badge disappears on read.
    expiresAt: ts('expires_at'),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.kind] })],
)

export const IDEA_KINDS = ['idea', 'problem'] as const
// Under review until Building HeyNaija's moderators decide. Not now and duplicate
// close an idea with a public reason; shipped closes it as done.
export const IDEA_STATUSES = ['under_review', 'planned', 'in_progress', 'shipped', 'not_now', 'duplicate'] as const

// An idea for HeyNaija, or a problem with it, sent to the board (/ideas, ADR
// 0015). It is an ordinary post in Building HeyNaija, whose first line is the
// title; this row holds what the board adds to it.
export const ideas = pgTable(
  'ideas',
  {
    postId: uuid('post_id')
      .primaryKey()
      .references(() => posts.id),
    kind: text('kind', { enum: IDEA_KINDS }).notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: IDEA_STATUSES }).notNull().default('under_review'),
    // Said in public: why it is not now, or a note with any other status.
    statusReason: text('status_reason'),
    // A duplicate's original. Its votes moved there when it was marked.
    duplicateOf: uuid('duplicate_of').references(() => posts.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ideas_status_created_idx').on(t.status, t.createdAt),
    check('ideas_kind_check', sql.raw(`kind in (${IDEA_KINDS.map((k) => `'${k}'`).join(', ')})`)),
    check('ideas_status_check', sql.raw(`status in (${IDEA_STATUSES.map((s) => `'${s}'`).join(', ')})`)),
    check('ideas_duplicate_check', sql`(status = 'duplicate') = (duplicate_of is not null) and duplicate_of is distinct from post_id`),
  ],
)

// A member's vote for an idea: one each, and separate from likes. Counted when
// read, from active members only.
export const ideaVotes = pgTable(
  'idea_votes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => ideas.postId),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.memberId] }), index('idea_votes_member_idx').on(t.memberId)],
)

// Every status an idea has had, and which moderator set it: the timeline on its
// page. The first row is its sending, with no moderator.
export const ideaStatusChanges = pgTable(
  'idea_status_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => ideas.postId),
    status: text('status', { enum: IDEA_STATUSES }).notNull(),
    reason: text('reason'),
    moderatorId: uuid('moderator_id').references(() => members.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('idea_status_changes_post_idx').on(t.postId, t.createdAt)],
)

// Where a problem happened, as the reporter's browser said when they sent it.
// Private: only the reporter and Building HeyNaija's moderators see it.
export const problemDetails = pgTable('problem_details', {
  postId: uuid('post_id')
    .primaryKey()
    .references(() => ideas.postId),
  page: text('page'),
  browser: text('browser'),
  appVersion: text('app_version'),
})
