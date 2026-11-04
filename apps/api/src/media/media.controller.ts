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
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { parse, slugParam } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { AVATAR_MAX_BYTES, IMAGE_TYPES, MediaError, MediaService, POST_IMAGE_MAX_BYTES, POST_IMAGE_TYPES } from './media.service.js'

const startBody = <T extends readonly [string, ...string[]]>(types: T, maxBytes: number) =>
  z.object({
    contentType: z.enum(types),
    bytes: z.number().int().min(1).max(maxBytes),
  })

const mediaIdParam = (id: string): string => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

const slugOf = (raw: string): string => {
  const parsed = slugParam.safeParse(raw)
  if (!parsed.success) throw new NotFoundException()
  return parsed.data
}

/** Turns the media service's refusals into HTTP answers. */
async function answer<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof MediaError) {
      if (err.code === 'not_found') throw new NotFoundException()
      if (err.code === 'forbidden') throw new ForbiddenException()
      if (err.code === 'scan_unavailable') throw new ServiceUnavailableException({ code: err.code, message: err.message })
      throw new BadRequestException({ code: err.code, message: err.message })
    }
    throw err
  }
}

@Controller('v1/me/avatar')
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** Returns a short-lived URL the browser uploads the image to directly. */
  @Post('upload')
  @UseGuards(SessionGuard)
  async start(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { contentType, bytes } = parse(startBody(IMAGE_TYPES, AVATAR_MAX_BYTES), body)
    await this.limits.hit('upload', req.member.id)
    return this.media.startAvatarUpload(req.member.id, contentType, bytes)
  }

  /** Call once the upload has finished; checks, processes and publishes the image. */
  @Post(':mediaId/complete')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async finish(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    const id = mediaIdParam(mediaId)
    return { avatar: await answer(() => this.media.finishAvatarUpload(req.member.id, id)) }
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async remove(@Req() req: AuthedRequest) {
    await this.media.removeAvatar(req.member.id)
  }
}

/**
 * Images for a post the member is writing. Same two steps as a profile photo,
 * but processing happens in a background job: the browser polls the status and
 * the post can only be made once every image on it is ready.
 */
@Controller('v1/me/images')
export class PostImagesController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Post('upload')
  @UseGuards(SessionGuard)
  async start(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { contentType, bytes } = parse(startBody(POST_IMAGE_TYPES, POST_IMAGE_MAX_BYTES), body)
    await this.limits.hit('postImage', req.member.id)
    return this.media.startPostImageUpload(req.member.id, contentType, bytes)
  }

  @Post(':mediaId/complete')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async finish(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    const id = mediaIdParam(mediaId)
    return { status: await answer(() => this.media.finishPostImageUpload(req.member.id, id)) }
  }

  @Get(':mediaId')
  @UseGuards(SessionGuard)
  async status(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    const status = await this.media.postImageStatus(req.member.id, mediaIdParam(mediaId))
    if (!status) throw new NotFoundException()
    return { status }
  }
}

/**
 * A community's square photo. Same steps as a profile photo; the community's
 * moderators and site moderators may use them, anyone else is refused.
 */
@Controller('v1/communities/:slug/photo')
export class CommunityPhotoController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Post('upload')
  @UseGuards(SessionGuard)
  async start(@Req() req: AuthedRequest, @Param('slug') slug: string, @Body() body: unknown) {
    const { contentType, bytes } = parse(startBody(IMAGE_TYPES, AVATAR_MAX_BYTES), body)
    const where = slugOf(slug)
    await this.limits.hit('upload', req.member.id)
    return answer(() => this.media.startCommunityPhotoUpload(req.member.id, where, contentType, bytes))
  }

  @Post(':mediaId/complete')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async finish(@Req() req: AuthedRequest, @Param('slug') slug: string, @Param('mediaId') mediaId: string) {
    const [where, id] = [slugOf(slug), mediaIdParam(mediaId)]
    return { photo: await answer(() => this.media.finishCommunityPhotoUpload(req.member.id, where, id)) }
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async remove(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    const where = slugOf(slug)
    await answer(() => this.media.removeCommunityPhoto(req.member.id, where))
  }
}
