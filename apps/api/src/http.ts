import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import { InvalidCursorError } from './cursor.js'

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
})

export const handleParam = z.string().regex(/^[a-z0-9_]{3,20}$/)

export const slugParam = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40)

/** Parses request input, turning a schema failure into a 400. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error))
  return parsed.data
}

/** Runs a paginated read, turning a tampered cursor into a 400. */
export async function paged<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (err instanceof InvalidCursorError) throw new BadRequestException(err.message)
    throw err
  }
}
