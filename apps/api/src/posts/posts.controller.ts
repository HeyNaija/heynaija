import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Optional,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { REPLY_AUDIENCES } from '@heynaija/db'
import {
  type AuthedRequest,
  type MaybeAuthedRequest,
  OptionalSessionGuard,
  SessionGuard,
} from '../auth/session.guard.js'
import { paged, pageQuery, parse, slugParam } from '../http.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { Feature, FeatureGuard } from '../flags/feature.guard.js'
import { LinksService } from '../links/links.service.js'
import { MediaService } from '../media/media.service.js'
import type { FlagKey } from '../flags/registry.js'
import { RateLimiter } from '../rate-limit.js'
import { VideoError } from '../video/video-error.js'
import { VideoGate } from '../video/video-gate.js'
import { VideoService } from '../video/video.service.js'
import {
  CommunityNotFoundError,
  ImagesNotReadyError,
  NotACommunityMemberError,
  NotACommunityModeratorError,
  ParentNotFoundError,
  PollAlreadyVotedError,
  PollClosedError,
  PollNotFoundError,
  PollOptionsError,
  newPost,
  PostsService,
  QuotedPostNotFoundError,
  ReplyNotAllowedError,
  VideoNotReadyError,
} from './posts.service.js'
import { DISCOVER_RULES, discoverPageQuery } from './discover.js'
import { parseHashtag } from './hashtags.js'
import { replyOrderQuery, replyPageQuery } from './reply-cursor.js'

const createPostBody = newPost(slugParam)
const replyAudienceBody = z.object({ audience: z.enum(REPLY_AUDIENCES) })
const pollVoteBody = z.object({ optionIds: z.array(z.uuid()).min(1).max(10) })

// Same answer for "not yours", "deleted" and "never existed": nothing to learn by probing.
const postId = (id: string): string => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

/** Runs a community pin change, turning "not one of its moderators" into a 403. */
async function forbidden<T>(change: () => Promise<T>): Promise<T> {
  try {
    return await change()
  } catch (err) {
    if (err instanceof NotACommunityModeratorError) throw new ForbiddenException({ code: 'not_a_moderator', message: err.message })
    throw err
  }
}

@Controller('v1')
export class PostsController {
  constructor(
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(LinksService) private readonly links: LinksService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    // Video (ADR 0019). Without the gate video is closed: a post cannot be made with one.
    @Optional() @Inject(VideoGate) private readonly videoGate?: VideoGate,
    @Optional() @Inject(VideoService) private readonly videos?: VideoService,
  ) {}

  /** A new post using something that is switched off is refused, not quietly stripped of it. */
  private async requireFeature(req: AuthedRequest, key: FlagKey, what: string): Promise<void> {
    if (!(await this.flags.isEnabled(key, req.member.id))) {
      throw new BadRequestException({ code: 'feature_unavailable', message: `${what} are not available yet` })
    }
  }

  @Get('feed')
  @UseGuards(OptionalSessionGuard)
  feed(@Req() req: MaybeAuthedRequest, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    return paged(() => this.posts.feed(req.member?.id ?? null, limit, cursor))
  }

  @Get('feed/following')
  @UseGuards(SessionGuard)
  following(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    return paged(() => this.posts.followingFeed(req.member.id, limit, cursor))
  }

  /** Discover: recent posts ranked by published rules (ADR 0014). Visitors get the ranking every visitor gets. */
  @Get('feed/discover')
  @UseGuards(OptionalSessionGuard)
  discover(@Req() req: MaybeAuthedRequest, @Query() query: unknown) {
    const { limit, cursor, at } = parse(discoverPageQuery, query)
    return paged(() => this.posts.discover(req.member?.id ?? null, limit, { cursor, at }))
  }

  /** The rules Discover ranks by, for the page that explains them. The same for everyone, so it needs no session. */
  @Get('feed/discover/rules')
  discoverRules() {
    return DISCOVER_RULES
  }

  @Get('bookmarks')
  @UseGuards(SessionGuard)
  bookmarks(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    return paged(() => this.posts.bookmarked(req.member.id, limit, cursor))
  }

  /** Everything tagged with one hashtag, however it is spelled. Not a hashtag: 404, as for an unknown community. */
  @Get('hashtags/:tag/posts')
  @UseGuards(OptionalSessionGuard)
  hashtag(@Req() req: MaybeAuthedRequest, @Param('tag') written: string, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    const tag = parseHashtag(written)
    if (!tag) throw new NotFoundException()
    return paged(() => this.posts.withHashtag(req.member?.id ?? null, tag, limit, cursor))
  }

  @Get('trending')
  @UseGuards(OptionalSessionGuard)
  trending(@Req() req: MaybeAuthedRequest) {
    return this.posts.trending(req.member?.id ?? null, 5)
  }

  @Get('posts/:id')
  @UseGuards(OptionalSessionGuard)
  async thread(@Req() req: MaybeAuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const { order } = parse(replyOrderQuery, query)
    const thread = await this.posts.thread(req.member?.id ?? null, postId(id), order)
    if (!thread) throw new NotFoundException()
    return thread
  }

  @Get('posts/:id/replies')
  @UseGuards(OptionalSessionGuard)
  async replies(@Req() req: MaybeAuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const { limit, cursor, order } = parse(replyPageQuery, query)
    const page = await paged(() => this.posts.replies(req.member?.id ?? null, postId(id), limit, cursor, order))
    if (!page) throw new NotFoundException()
    return page
  }

  @Get('posts/:id/post')
  @UseGuards(OptionalSessionGuard)
  async post(@Req() req: MaybeAuthedRequest, @Param('id') id: string) {
    const post = await this.posts.post(req.member?.id ?? null, postId(id))
    if (!post) throw new NotFoundException()
    return post
  }

  @Post('posts')
  @UseGuards(SessionGuard)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { text, replyTo, community, images, video, quote, poll, replyAudience } = parse(createPostBody, body)
    if (video && !(await this.videoGate?.isOpen(req.member.id))) {
      throw new BadRequestException({ code: 'feature_unavailable', message: 'Videos are not available yet' })
    }
    if (poll) await this.requireFeature(req, 'polls', 'Polls')
    if (replyAudience !== 'everyone') await this.requireFeature(req, 'replyControls', 'Reply controls')
    if (quote) await this.requireFeature(req, 'quotePosts', 'Quote posts')
    await this.limits.hit('post', req.member.id)
    try {
      const { id, linkUrl } = await this.posts.create(req.member.id, text, {
        replyTo,
        communitySlug: community,
        images,
        video,
        quote,
        poll,
        replyAudience,
      })
      // The card appears once the page has been read, a few seconds on; the post does not wait for it.
      if (linkUrl && (await this.flags.isEnabled('linkPreviews', req.member.id))) await this.links.request(linkUrl)
      return { id }
    } catch (err) {
      // The trust rules, re-checked at attach: same answers as starting an upload.
      if (err instanceof VideoError) {
        if (err.code === 'not_eligible') throw new ForbiddenException({ code: err.code, message: err.message })
        throw new BadRequestException({ code: err.code, message: err.message })
      }
      if (err instanceof ReplyNotAllowedError) {
        throw new ForbiddenException({ code: 'reply_not_allowed', message: err.message })
      }
      const code =
        err instanceof ParentNotFoundError
          ? 'parent_gone'
          : err instanceof QuotedPostNotFoundError
            ? 'quote_gone'
            : err instanceof CommunityNotFoundError
            ? 'community_gone'
            : err instanceof NotACommunityMemberError
              ? 'not_a_member'
              : err instanceof ImagesNotReadyError
                ? 'images_not_ready'
                : err instanceof VideoNotReadyError
                  ? 'video_not_ready'
                : err instanceof PollOptionsError
                  ? 'poll_options_invalid'
                  : null
      if (code) throw new BadRequestException({ code, message: (err as Error).message })
      throw err
    }
  }

  @Put('posts/:id/reply-audience')
  @HttpCode(204)
  @UseGuards(SessionGuard, FeatureGuard)
  @Feature('replyControls')
  async setReplyAudience(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { audience } = parse(replyAudienceBody, body)
    await this.limits.hit('action', req.member.id)
    if (!(await this.posts.setReplyAudience(req.member.id, postId(id), audience))) throw new NotFoundException()
  }

  @Put('posts/:id/poll/vote')
  @HttpCode(204)
  @UseGuards(SessionGuard, FeatureGuard)
  @Feature('polls')
  async votePoll(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { optionIds } = parse(pollVoteBody, body)
    await this.limits.hit('action', req.member.id)
    try {
      await this.posts.votePoll(req.member.id, postId(id), optionIds)
    } catch (err) {
      if (err instanceof PollNotFoundError) throw new NotFoundException()
      if (err instanceof PollClosedError) throw new BadRequestException({ code: 'poll_closed', message: err.message })
      if (err instanceof PollAlreadyVotedError) throw new BadRequestException({ code: 'poll_already_voted', message: err.message })
      if (err instanceof PollOptionsError) throw new BadRequestException({ code: 'poll_options_invalid', message: err.message })
      throw err
    }
  }

  @Get('posts/:id/poll/votes')
  @UseGuards(OptionalSessionGuard)
  async pollVotes(@Req() req: MaybeAuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    const votes = await paged(() => this.posts.pollVoters(req.member?.id ?? null, postId(id), limit, cursor))
    if (!votes) throw new NotFoundException()
    return votes
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!(await this.posts.remove(req.member.id, postId(id)))) throw new NotFoundException()
    // Deleting a post takes its images down too.
    await this.media.discardPostImages(id)
    await this.videos?.discardPostVideos(id)
  }

  @Put('posts/:id/like')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async like(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    if (!(await this.posts.like(req.member.id, postId(id)))) throw new NotFoundException()
  }

  @Delete('posts/:id/like')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unlike(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.posts.unlike(req.member.id, postId(id))
  }

  @Put('posts/:id/repost')
  @HttpCode(204)
  @UseGuards(SessionGuard, FeatureGuard)
  @Feature('reposts')
  async repost(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    if (!(await this.posts.repost(req.member.id, postId(id)))) throw new NotFoundException()
  }

  @Delete('posts/:id/repost')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unrepost(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.posts.unrepost(req.member.id, postId(id))
  }

  /** Keeps one of your own top-level posts at the top of your profile, in place of any other. */
  @Put('posts/:id/pin')
  @HttpCode(204)
  @UseGuards(SessionGuard, FeatureGuard)
  @Feature('profilePins')
  async pin(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    if (!(await this.posts.pinToProfile(req.member.id, postId(id)))) throw new NotFoundException()
  }

  @Delete('posts/:id/pin')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unpin(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.posts.unpinFromProfile(req.member.id, postId(id))
  }

  /** Keeps a top-level post at the top of its community. For that community's moderators and site-wide ones. */
  @Put('posts/:id/community-pin')
  @HttpCode(204)
  @UseGuards(SessionGuard, FeatureGuard)
  @Feature('communityPins')
  async pinInCommunity(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    const pinned = await forbidden(() => this.posts.pinInCommunity(req.member.id, postId(id)))
    if (!pinned) throw new NotFoundException()
  }

  @Delete('posts/:id/community-pin')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unpinInCommunity(@Req() req: AuthedRequest, @Param('id') id: string) {
    await forbidden(() => this.posts.unpinInCommunity(req.member.id, postId(id)))
  }

  @Put('posts/:id/bookmark')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async bookmark(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    if (!(await this.posts.bookmark(req.member.id, postId(id)))) throw new NotFoundException()
  }

  @Delete('posts/:id/bookmark')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unbookmark(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.posts.unbookmark(req.member.id, postId(id))
  }
}
