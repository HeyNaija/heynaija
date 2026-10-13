import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at'),
  },
  (t) => [index('members_handle_idx').on(t.handle)],
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
    createdAt: ts('created_at').notNull().defaultNow(),
    // Soft delete: the row stays for moderation and audit, but leaves every feed.
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('posts_created_idx').on(t.createdAt, t.id),
    index('posts_author_created_idx').on(t.authorId, t.createdAt),
    index('posts_reply_parent_idx').on(t.replyParentId),
  ],
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
