import {
  ageAssurances,
  blocks,
  bookmarks,
  communities,
  communityMemberships,
  type Db,
  follows,
  governanceMemberships,
  identityVerifications,
  likes,
  media,
  members,
  moderationActions,
  mutes,
  notifications,
  posts,
  reports,
  reposts,
} from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { aliasedTable, and, asc, eq, isNotNull, or } from 'drizzle-orm'
import { avatarPath, postImagePath } from '../media/media.service.js'
import { DB } from '../tokens.js'

/** Bumped whenever the shape below changes, so people and tools can tell exports apart. */
export const EXPORT_FORMAT = 'heynaija-export/3'

/**
 * Everything HeyNaija holds about one member, for them to download (PLAN.md §1:
 * members own their data). It covers what they made and chose; other people's
 * data appears only as handles (who they follow, who follows them). Reports made
 * about them are left out, because those carry the reporter's identity; the
 * moderation decisions taken on their account and posts are included.
 */
@Injectable()
export class ExportService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async export(memberId: string, email: string | null) {
    const db = this.db
    const [me] = await db.select().from(members).where(eq(members.id, memberId))
    if (!me) return null

    const other = aliasedTable(members, 'other')

    const [
      ownPosts,
      images,
      liked,
      reposted,
      saved,
      following,
      followers,
      muted,
      blocked,
      joined,
      reported,
      decisions,
      received,
      ageRecords,
      verifications,
      [membership],
    ] = await Promise.all([
      db
        .select({
          id: posts.id,
          text: posts.text,
          createdAt: posts.createdAt,
          replyTo: posts.replyParentId,
          quoteOf: posts.quotePostId,
          community: communities.slug,
          deletedAt: posts.deletedAt,
          removedByModeratorAt: posts.removedAt,
        })
        .from(posts)
        .leftJoin(communities, eq(communities.id, posts.communityId))
        .where(eq(posts.authorId, memberId))
        .orderBy(asc(posts.createdAt)),
      db
        .select({ id: media.id, postId: media.postId, position: media.position, alt: media.alt, status: media.status })
        .from(media)
        .where(and(eq(media.ownerId, memberId), eq(media.kind, 'post_image'), isNotNull(media.postId)))
        .orderBy(asc(media.position)),
      db.select({ postId: likes.postId, at: likes.createdAt }).from(likes).where(eq(likes.memberId, memberId)).orderBy(asc(likes.createdAt)),
      db.select({ postId: reposts.postId, at: reposts.createdAt }).from(reposts).where(eq(reposts.memberId, memberId)).orderBy(asc(reposts.createdAt)),
      db.select({ postId: bookmarks.postId, at: bookmarks.createdAt }).from(bookmarks).where(eq(bookmarks.memberId, memberId)).orderBy(asc(bookmarks.createdAt)),
      db
        .select({ handle: other.handle, since: follows.createdAt })
        .from(follows)
        .innerJoin(other, eq(other.id, follows.followeeId))
        .where(eq(follows.followerId, memberId))
        .orderBy(asc(follows.createdAt)),
      db
        .select({ handle: other.handle, since: follows.createdAt })
        .from(follows)
        .innerJoin(other, eq(other.id, follows.followerId))
        .where(eq(follows.followeeId, memberId))
        .orderBy(asc(follows.createdAt)),
      db
        .select({ handle: other.handle, since: mutes.createdAt })
        .from(mutes)
        .innerJoin(other, eq(other.id, mutes.mutedId))
        .where(eq(mutes.muterId, memberId)),
      db
        .select({ handle: other.handle, since: blocks.createdAt })
        .from(blocks)
        .innerJoin(other, eq(other.id, blocks.blockedId))
        .where(eq(blocks.blockerId, memberId)),
      db
        .select({ community: communities.slug, name: communities.name, role: communityMemberships.role, since: communityMemberships.joinedAt })
        .from(communityMemberships)
        .innerJoin(communities, eq(communities.id, communityMemberships.communityId))
        .where(eq(communityMemberships.memberId, memberId)),
      db
        .select({
          postId: reports.postId,
          aboutHandle: other.handle,
          reason: reports.reason,
          details: reports.details,
          status: reports.status,
          at: reports.createdAt,
        })
        .from(reports)
        .leftJoin(other, eq(other.id, reports.memberId))
        .where(eq(reports.reporterId, memberId))
        .orderBy(asc(reports.createdAt)),
      db
        .select({ action: moderationActions.action, postId: moderationActions.postId, at: moderationActions.createdAt })
        .from(moderationActions)
        .leftJoin(posts, eq(posts.id, moderationActions.postId))
        .where(or(eq(moderationActions.memberId, memberId), eq(posts.authorId, memberId)))
        .orderBy(asc(moderationActions.createdAt)),
      db
        .select({ kind: notifications.kind, postId: notifications.postId, at: notifications.createdAt, readAt: notifications.readAt })
        .from(notifications)
        .where(eq(notifications.recipientId, memberId))
        .orderBy(asc(notifications.createdAt)),
      db
        .select({
          band: ageAssurances.band,
          method: ageAssurances.method,
          at: ageAssurances.assuredAt,
          reviewAfter: ageAssurances.reviewAfter,
          withdrawnAt: ageAssurances.withdrawnAt,
        })
        .from(ageAssurances)
        .where(eq(ageAssurances.memberId, memberId))
        .orderBy(asc(ageAssurances.assuredAt)),
      // The private person key is left out: it is derived with HeyNaija's secret,
      // means nothing outside HeyNaija, and would help anyone holding it link accounts.
      db
        .select({
          provider: identityVerifications.provider,
          status: identityVerifications.status,
          verifiedAt: identityVerifications.verifiedAt,
          expiresAt: identityVerifications.expiresAt,
          consentVersion: identityVerifications.consentVersion,
          consentedAt: identityVerifications.consentedAt,
          reviewedAt: identityVerifications.reviewedAt,
          revokedAt: identityVerifications.revokedAt,
          outcome: identityVerifications.outcome,
          at: identityVerifications.createdAt,
        })
        .from(identityVerifications)
        .where(eq(identityVerifications.memberId, memberId))
        .orderBy(asc(identityVerifications.createdAt)),
      db
        .select({
          status: governanceMemberships.status,
          optedInAt: governanceMemberships.optedInAt,
          documentsVersion: governanceMemberships.documentsVersion,
          suspendedUntil: governanceMemberships.suspendedUntil,
          suspensionReason: governanceMemberships.suspensionReason,
        })
        .from(governanceMemberships)
        .where(eq(governanceMemberships.memberId, memberId)),
    ])

    const imagesByPost = new Map<string, { url: string; description: string }[]>()
    for (const image of images) {
      if (!image.postId || image.status !== 'ready') continue
      const list = imagesByPost.get(image.postId) ?? []
      list.push({ url: postImagePath(image.id), description: image.alt })
      imagesByPost.set(image.postId, list)
    }

    return {
      format: EXPORT_FORMAT,
      exportedAt: new Date(),
      notes: [
        'Image and photo URLs are relative to the site, for example https://heynaija.ng/media/... .',
        'Posts you deleted, and posts a moderator removed, are included with the date that happened: HeyNaija keeps them for moderation records.',
      ],
      account: {
        id: me.id,
        handle: me.handle,
        email,
        displayName: me.displayName,
        bio: me.bio,
        photo: avatarPath(me.avatarMediaId),
        joinedAt: me.createdAt,
        lastSeenAt: me.lastSeenAt,
        role: me.role,
        active: me.active,
      },
      // Every statement about your age band and how it was made: empty for
      // accounts made before HeyNaija asked, which HeyNaija treats as unknown.
      age: ageRecords,
      identityVerifications: verifications,
      votingMembership: membership ?? null,
      posts: ownPosts.map((p) => ({ ...p, images: imagesByPost.get(p.id) ?? [] })),
      likes: liked,
      reposts: reposted,
      bookmarks: saved,
      following,
      followers,
      muted,
      blocked,
      communities: joined,
      reportsYouMade: reported,
      moderationDecisionsAboutYou: decisions,
      notifications: received,
    }
  }
}
