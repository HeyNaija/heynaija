import type { NestFastifyApplication } from '@nestjs/platform-fastify'

/** Preserve encoded form bytes, including repeated fields and provider CSRF tokens. */
export function registerAuthFormParser(app: NestFastifyApplication): void {
  app.useBodyParser('application/x-www-form-urlencoded', { bodyLimit: 64 * 1024 },
    (_request, body, done) => done(null, body.toString('utf8')))
}
