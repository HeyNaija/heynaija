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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { InvalidCursorError, PostsService, postText } from './posts.service.js'

const createPostBody = z.object({ text: postText })
const feedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
})

@Controller('v1')
export class PostsController {
  constructor(@Inject(PostsService) private readonly posts: PostsService) {}

  @Post('posts')
  @UseGuards(SessionGuard)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = createPostBody.safeParse(body)
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error))
    return this.posts.create(req.member.id, parsed.data.text)
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    // Same answer for "not yours" and "does not exist": nothing to learn by probing.
    if (!z.uuid().safeParse(id).success || !(await this.posts.remove(req.member.id, id))) {
      throw new NotFoundException()
    }
  }

  @Get('feed')
  async feed(@Query() query: unknown) {
    const parsed = feedQuery.safeParse(query)
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error))
    try {
      return await this.posts.feed(parsed.data.limit, parsed.data.cursor)
    } catch (err) {
      if (err instanceof InvalidCursorError) throw new BadRequestException(err.message)
      throw err
    }
  }
}
