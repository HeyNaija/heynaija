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
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, OptionalSessionGuard, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { VIDEO_TYPES } from './video-config.js'
import { VideoPostsGuard } from './video-gate.js'
import { VideoError, VideoService } from './video.service.js'

// The size and length checks here are shape checks only; the limits are the service's, from its settings.
const startBody = z.object({
  contentType: z.enum(VIDEO_TYPES),
  bytes: z.number().int().min(1),
  durationMs: z.number().int().min(0).optional(),
})

const mediaIdParam = (id: string): string => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

/** Turns the video service's refusals into HTTP answers. */
async function answer<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof VideoError) {
      if (err.code === 'not_found') throw new NotFoundException()
      if (err.code === 'not_eligible') throw new ForbiddenException({ code: err.code, message: err.message })
      throw new BadRequestException({ code: err.code, message: err.message })
    }
    throw err
  }
}

/**
 * Video for a post (ADR 0019). Closed means these routes do not exist: the
 * optional session is read first so an allow-list can see the viewer, the video
 * guard answers 404 while video is off (the flag, and the scanner rule in
 * production), and only then is sign-in required.
 */
@Controller('v1/me/videos')
@UseGuards(OptionalSessionGuard, VideoPostsGuard, SessionGuard)
export class VideosController {
  constructor(
    @Inject(VideoService) private readonly videos: VideoService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** Opens a multipart upload and returns a signed URL per part for the browser to send straight to storage. */
  @Post('upload')
  async start(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(startBody, body)
    await this.limits.hit('videoUpload', req.member.id)
    return answer(() => this.videos.startUpload(req.member.id, input))
  }

  /** After a reload: the parts already stored, and fresh URLs for the rest. */
  @Get(':mediaId/upload')
  async resume(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    const id = mediaIdParam(mediaId)
    await this.limits.hit('videoPart', req.member.id)
    return answer(() => this.videos.resumeUpload(req.member.id, id))
  }

  /** Every part is sent: assemble the file and queue it for the worker. */
  @Post(':mediaId/complete')
  @HttpCode(200)
  async complete(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    const id = mediaIdParam(mediaId)
    return answer(() => this.videos.completeUpload(req.member.id, id))
  }

  /** The uploader's own view, polled until it is ready or refused. Anyone else gets 404. */
  @Get(':mediaId')
  async status(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    const status = await this.videos.status(req.member.id, mediaIdParam(mediaId))
    if (!status) throw new NotFoundException()
    return status
  }

  /** Drops a video not yet on a post. */
  @Delete(':mediaId')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    const id = mediaIdParam(mediaId)
    const removed = await answer(() => this.videos.remove(req.member.id, id))
    if (!removed) throw new BadRequestException({ code: 'video_in_use', message: 'delete the post that has this video instead' })
  }
}
