import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

// A member of the network. `id` is the Ory Kratos identity ID: Kratos owns the
// email, password and sessions; this table holds only what the app itself needs.
export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey(),
    // Copy of the Kratos `handle` trait, refreshed whenever the member is seen.
    // Not unique here: Kratos enforces uniqueness, and this copy can briefly lag it.
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
  },
  (t) => [index('members_handle_idx').on(t.handle)],
)

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
    status: text('status', { enum: ['pending', 'processing', 'ready', 'failed', 'deleted'] })
      .notNull()
      .default('pending'),
    // What the browser said it would send; the upload URL only accepts exactly this.
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    // Dimensions of the largest processed version, so pages can reserve the space.
    width: integer('width'),
    height: integer('height'),
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
    // At most one community per post. Replies inherit their parent's.
    communityId: uuid('community_id').references(() => communities.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    // Soft delete: the row stays for moderation and audit, but leaves every feed.
    deletedAt: ts('deleted_at'),
    // Taken down by a moderator (as opposed to deleted by its author). Reversible.
    removedAt: ts('removed_at'),
  },
  (t) => [
    index('posts_created_idx').on(t.createdAt, t.id),
    index('posts_author_created_idx').on(t.authorId, t.createdAt),
    index('posts_reply_parent_idx').on(t.replyParentId),
    index('posts_community_created_idx').on(t.communityId, t.createdAt),
    // Full-text search. 'simple' (no stemming) suits mixed English, Pidgin and names.
    index('posts_text_search_idx').using('gin', sql`to_tsvector('simple', ${t.text})`),
  ],
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
// files about themselves (reason 'appeal'), so it lands in the same queue.
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => members.id),
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
    note: text('note').notNull().default(''),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('moderation_actions_created_idx').on(t.createdAt)],
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
