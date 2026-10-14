import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { AVATAR_MAX_BYTES, AVATAR_TYPES, MediaError, MediaService } from './media.service.js'

const startBody = z.object({
  contentType: z.enum(AVATAR_TYPES),
  bytes: z.number().int().min(1).max(AVATAR_MAX_BYTES),
})

@Controller('v1/me/avatar')
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** Returns a short-lived URL the browser uploads the image to directly. */
  @Post('upload')
  @UseGuards(SessionGuard)
  start(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { contentType, bytes } = parse(startBody, body)
    this.limits.hit('upload', req.member.id)
    return this.media.startAvatarUpload(req.member.id, contentType, bytes)
  }

  /** Call once the upload has finished; checks, processes and publishes the image. */
  @Post(':mediaId/complete')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async finish(@Req() req: AuthedRequest, @Param('mediaId') mediaId: string) {
    if (!z.uuid().safeParse(mediaId).success) throw new NotFoundException()
    try {
      return { avatar: await this.media.finishAvatarUpload(req.member.id, mediaId) }
    } catch (err) {
      if (err instanceof MediaError) {
        if (err.code === 'not_found') throw new NotFoundException()
        throw new BadRequestException({ code: err.code, message: err.message })
      }
      throw err
    }
  }

  @Delete()
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async remove(@Req() req: AuthedRequest) {
    await this.media.removeAvatar(req.member.id)
  }
}
