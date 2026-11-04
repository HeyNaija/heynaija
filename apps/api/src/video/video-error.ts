import { BadRequestException, ForbiddenException, type HttpException, NotFoundException } from '@nestjs/common'

export class VideoError extends Error {
  constructor(
    readonly code: 'not_found' | 'not_eligible' | 'too_large' | 'bad_type' | 'too_long' | 'bad_parts' | 'too_many_videos',
    message: string,
  ) {
    super(message)
  }
}

/** The HTTP answer to a video refusal, the same at upload and when a video is put on a post. */
export function videoHttpError(err: VideoError): HttpException {
  if (err.code === 'not_found') return new NotFoundException()
  if (err.code === 'not_eligible') return new ForbiddenException({ code: err.code, message: err.message })
  return new BadRequestException({ code: err.code, message: err.message })
}
