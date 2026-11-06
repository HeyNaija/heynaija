import { Inject, Injectable } from '@nestjs/common'
import { LinksService } from '../links/links.service.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import {
  type GistReplyPage,
  ParentNotFoundError,
  type PostView,
  PostsService,
  ReplyNotAllowedError,
  type ReplyPage,
} from '../posts/posts.service.js'
import type { ReplyOrder } from '../posts/reply-cursor.js'
import { GistError, type GistReplyAudience, GistsService } from './gists.service.js'

type Viewer = { id: string; handle: string }
type Paging = { order: ReplyOrder; cursor?: string; limit?: number }

export type GistReplies = GistReplyPage & {
  count: number
  viewerIsHost: boolean
  replyAudience: GistReplyAudience
}

/**
 * The comment section of a Gist (docs/adr/0017): replies are posts with a gist_id, read
 * only here and only by someone who may see the Gist. Whether anyone may write is the
 * `gistReplies` flag and the Gist's reply controls; reading and deleting your own never
 * depend on the flag, so a switched-off flag strands nothing.
 */
@Injectable()
export class GistRepliesService {
  constructor(
    @Inject(GistsService) private readonly gists: GistsService,
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(FeatureFlags) private readonly flags: Pick<FeatureFlags, 'isEnabled'>,
    @Inject(LinksService) private readonly links: Pick<LinksService, 'request'>,
  ) {}

  async list(viewer: Viewer, gistId: string, { order, cursor, limit = 20 }: Paging): Promise<GistReplies> {
    const gist = await this.gists.viewable(viewer, gistId)
    const [page, count] = await Promise.all([
      this.posts.gistReplies(viewer.id, gist.id, limit, order, cursor),
      this.posts.gistReplyCount(gist.id),
    ])
    return { ...page, count, viewerIsHost: gist.hostId === viewer.id, replyAudience: gist.replyAudience }
  }

  async branch(viewer: Viewer, gistId: string, parentId: string, { order, cursor, limit = 20 }: Paging): Promise<ReplyPage & { viewerIsHost: boolean }> {
    const gist = await this.gists.viewable(viewer, gistId)
    const page = await this.posts.repliesInGist(viewer.id, gist.id, parentId, limit, cursor, order)
    if (!page) throw new GistError('not_found')
    return { ...page, viewerIsHost: gist.hostId === viewer.id }
  }

  async get(viewer: Viewer, gistId: string, postId: string): Promise<PostView> {
    const gist = await this.gists.viewable(viewer, gistId)
    const post = await this.posts.postInGist(viewer.id, gist.id, postId)
    if (!post) throw new GistError('not_found')
    return post
  }

  /** At the top of the Gist's comment section, or under `replyTo`, a reply in the same Gist. */
  async create(viewer: Viewer, gistId: string, input: { text: string; replyTo?: string }): Promise<{ id: string }> {
    const gist = await this.gists.viewable(viewer, gistId)
    if (!(await this.flags.isEnabled('gistReplies', viewer.id))) throw new GistError('not_found')
    try {
      const { id, linkUrl } = await this.posts.create(viewer.id, input.text, { gist: gist.id, replyTo: input.replyTo, gistAccess: await this.gists.flagAllows() })
      if (linkUrl && (await this.flags.isEnabled('linkPreviews', viewer.id))) await this.links.request(linkUrl)
      return { id }
    } catch (err) {
      if (err instanceof ReplyNotAllowedError) throw new GistError('reply_not_allowed')
      if (err instanceof ParentNotFoundError) throw new GistError('not_found')
      throw err
    }
  }

  async like(viewer: Viewer, gistId: string, postId: string): Promise<void> {
    const gist = await this.gists.viewable(viewer, gistId)
    if (!(await this.posts.likeInGist(viewer.id, gist.id, postId, await this.gists.flagAllows()))) throw new GistError('not_found')
  }

  async unlike(viewer: Viewer, postId: string): Promise<void> {
    await this.posts.unlike(viewer.id, postId)
  }

  /** Host only. Hiding is the host's, apart from a moderator's takedown, and can be undone. */
  async hide(viewer: Viewer, gistId: string, postId: string, hidden: boolean): Promise<void> {
    const gist = await this.gists.viewable(viewer, gistId)
    if (gist.hostId !== viewer.id) throw new GistError('forbidden')
    if (!(await this.posts.hideInGist(gist.id, postId, hidden))) throw new GistError('not_found')
  }

  setReplyAudience(viewer: Viewer, gistId: string, audience: GistReplyAudience): Promise<void> {
    return this.gists.setReplyAudience(viewer, gistId, audience)
  }
}
