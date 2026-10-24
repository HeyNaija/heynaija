import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import {
  type AuthedRequest,
  type MaybeAuthedRequest,
  OptionalSessionGuard,
  SessionGuard,
} from '../auth/session.guard.js'
import { paged, pageQuery, parse, slugParam } from '../http.js'
import { LinksService } from '../links/links.service.js'
import { MediaService } from '../media/media.service.js'
import { RateLimiter } from '../rate-limit.js'
import {
  CommunityNotFoundError,
  ImagesNotReadyError,
  NotACommunityMemberError,
  ParentNotFoundError,
  newPost,
  PostsService,
  QuotedPostNotFoundError,
} from './posts.service.js'
import { parseHashtag } from './hashtags.js'
import { replyPageQuery } from './reply-cursor.js'

const createPostBody = newPost(slugParam)

// Same answer for "not yours", "deleted" and "never existed": nothing to learn by probing.
const postId = (id: string): string => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

@Controller('v1')
export class PostsController {
  constructor(
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(LinksService) private readonly links: LinksService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

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
  async thread(@Req() req: MaybeAuthedRequest, @Param('id') id: string) {
    const thread = await this.posts.thread(req.member?.id ?? null, postId(id))
    if (!thread) throw new NotFoundException()
    return thread
  }

  @Get('posts/:id/replies')
  @UseGuards(OptionalSessionGuard)
  async replies(@Req() req: MaybeAuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const { limit, cursor } = parse(replyPageQuery, query)
    const page = await paged(() => this.posts.replies(req.member?.id ?? null, postId(id), limit, cursor))
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
    const { text, replyTo, community, images, quote } = parse(createPostBody, body)
    await this.limits.hit('post', req.member.id)
    try {
      const { id, linkUrl } = await this.posts.create(req.member.id, text, { replyTo, communitySlug: community, images, quote })
      // The card appears once the page has been read, a few seconds on; the post does not wait for it.
      if (linkUrl) await this.links.request(linkUrl)
      return { id }
    } catch (err) {
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
                : null
      if (code) throw new BadRequestException({ code, message: (err as Error).message })
      throw err
    }
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!(await this.posts.remove(req.member.id, postId(id)))) throw new NotFoundException()
    // Deleting a post takes its images down too.
    await this.media.discardPostImages(id)
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
  @UseGuards(SessionGuard)
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
