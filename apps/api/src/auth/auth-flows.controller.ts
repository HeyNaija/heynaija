import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Inject, Param, Post, Query, Req, Res } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { AuthService } from './auth.service.js'
import type { AuthFlowKind, AuthRedirect } from './auth-flow.provider.js'

const kindSchema = z.enum(['login', 'registration', 'verification', 'settings'])
function kind(value: unknown): AuthFlowKind {
  const parsed = kindSchema.safeParse(value)
  if (!parsed.success) throw new BadRequestException('unsupported authentication flow')
  return parsed.data
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048) throw new BadRequestException('invalid authentication interaction')
  return value
}
const credentials = (request: FastifyRequest) => ({ cookieHeader: request.headers.cookie, authorizationHeader: request.headers.authorization, origin: request.headers.origin })
function redirect(reply: FastifyReply, result: AuthRedirect) {
  reply.header('cache-control', 'no-store')
  if (result.cookies.length) reply.header('set-cookie', result.cookies)
  return reply.code(303).header('location', result.location).send()
}

@Controller('v1/auth')
export class AuthFlowsController {
  constructor(@Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Pick<Env, 'WEB_PUBLIC_URL'>) {}

  @Get('flows/:kind/start')
  async begin(@Param('kind') flowKind: string, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const selected = kind(flowKind)
    const result = selected === 'settings'
      ? await this.auth.beginAccountChange(credentials(request))
      : await this.auth.beginFlow(selected, credentials(request))
    return redirect(reply, result)
  }

  @Get('flows/:kind')
  @Header('cache-control', 'no-store')
  resume(@Param('kind') flowKind: string, @Query('flow') id: unknown, @Req() request: FastifyRequest) {
    return this.auth.resumeFlow(kind(flowKind), identifier(id), credentials(request))
  }

  @Post('flows/:kind')
  async submit(@Param('kind') flowKind: string, @Query('flow') id: unknown, @Body() body: unknown,
    @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    if ((request.headers.origin && request.headers.origin !== new URL(this.env.WEB_PUBLIC_URL).origin) ||
        request.headers['sec-fetch-site'] === 'cross-site') throw new ForbiddenException('cross-origin write rejected')
    if (typeof body !== 'string' || !request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
      throw new BadRequestException('expected an authentication form')
    }
    return redirect(reply, await this.auth.submitFlow(kind(flowKind), identifier(id), body, credentials(request)))
  }

  @Get('logout/link')
  @Header('cache-control', 'no-store')
  async logoutLink(@Req() request: FastifyRequest) {
    return { url: await this.auth.logoutUrl(credentials(request)) }
  }

  @Get('reauthenticate')
  async reauthenticate(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return redirect(reply, await this.auth.reauthenticate(credentials(request)))
  }

  @Get('logout')
  async logout(@Query('token') token: unknown, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    return redirect(reply, await this.auth.completeLogout(identifier(token), credentials(request)))
  }

  @Get('account/email')
  @Header('cache-control', 'no-store')
  async email(@Req() request: FastifyRequest) {
    return { email: await this.auth.emailForRequest(credentials(request)) }
  }

  @Get('errors')
  @Header('cache-control', 'no-store')
  async error(@Query('id') id: unknown, @Req() request: FastifyRequest) {
    return { message: await this.auth.flowError(identifier(id), credentials(request)) }
  }
}
