import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'
import { HLS_CONTENT_TYPES } from '../video/hls.js'
import { hlsKey, playlistKey, posterKey } from '../video/video-keys.js'
import { VIDEO_STORE } from '../video/video.service.js'
import { POST_IMAGE_SIZES } from './media.service.js'
import { MEDIA_URLS, type MediaUrls, type PrivateFolder, signPlaylist } from './media-urls.js'
import type { VideoStore } from './object-store.js'
import { placed } from './places.js'

/** What a browser or Cloudflare may keep of an answer here: nothing shared, ever. */
const NOT_STORED = 'private, no-store'
const IMAGE_FILES = new Set([...POST_IMAGE_SIZES.map((px) => `${px}.webp`), 'still.webp'])
const MASTER_FILES = new Set(['master.m3u8', 'master-480.m3u8'])
const SIGNATURE = /^[\w-]{43}$/

/**
 * The files of posts marked sensitive (ADR 0025), behind the signed URLs
 * `MediaUrls` makes. No session is needed: the signature is the permission, given
 * only to a viewer who passed the post's own check, and it runs out within two
 * hours. Nothing here reads the database.
 *
 * Bytes never pass through: a picture or a video's poster is a redirect to a
 * storage URL as short-lived as this one, and a quality's playlist is sent with
 * each of its pieces signed the same way, so video stays on R2 as Cloudflare's
 * terms require (ADR 0021 section 4). Every answer, refusals included, says
 * `private`, so Cloudflare never caches one for everybody.
 */
@Controller('v1/media/private')
export class PrivateMediaController {
  constructor(
    @Inject(MEDIA_URLS) private readonly urls: MediaUrls,
    @Inject(VIDEO_STORE) private readonly store: VideoStore,
  ) {}

  @Get(':expiry/:signature/posts/:id/:file')
  async image(@Param() p: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const id = this.check(p, 'posts', reply)
    if (!IMAGE_FILES.has(p.file!)) throw new NotFoundException()
    await this.redirect(`posts/${id}/${p.file}`, p.expiry!, reply)
  }

  @Get(':expiry/:signature/videos/:id/poster.webp')
  async poster(@Param() p: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const id = this.check(p, 'videos', reply)
    await this.redirect(posterKey(id), p.expiry!, reply)
  }

  /** A master playlist as it is: its lines name each quality's playlist relative to it, under this same signature. */
  @Get(':expiry/:signature/videos/:id/hls/:file')
  async master(@Param() p: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const id = this.check(p, 'videos', reply)
    if (!MASTER_FILES.has(p.file!)) throw new NotFoundException()
    return this.playlist(hlsKey(id, p.file!), reply)
  }

  /**
   * One quality's playlist, with its init segment and pieces signed straight to storage. Its pieces are
   * never served here: a player that asks for one by this path is refused.
   */
  @Get(':expiry/:signature/videos/:id/hls/:label/:file')
  async quality(@Param() p: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    const id = this.check(p, 'videos', reply)
    if (!/^\d{1,4}$/.test(p.label!) || p.file !== 'index.m3u8') throw new NotFoundException()
    const key = playlistKey(id, Number(p.label))
    const folder = key.slice(0, key.lastIndexOf('/') + 1)
    const window = this.urls.window()
    const text = await this.playlist(key, reply)
    return signPlaylist(text, (name) => this.store.presignRead(...placed('private', folder + name), window))
  }

  /** The media ID, once the URL's signature holds for it; refused as not found otherwise, whatever was wrong. */
  private check(p: Record<string, string>, folder: PrivateFolder, reply: FastifyReply): string {
    void reply.header('cache-control', NOT_STORED)
    const ok =
      z.uuid().safeParse(p.id).success &&
      SIGNATURE.test(p.signature ?? '') &&
      this.urls.verify(p.expiry ?? '', p.signature!, folder, p.id!)
    if (!ok) throw new NotFoundException()
    return p.id!
  }

  /**
   * Sends the browser to the file in storage. The browser may keep the redirect
   * until this URL runs out (a minute early): it is the same for everyone that
   * hour, and the storage URL lasts at least as long.
   */
  private async redirect(key: string, expiry: string, reply: FastifyReply): Promise<void> {
    const url = await this.store.presignRead(...placed('private', key), this.urls.window())
    const left = Math.max(0, Number(expiry) - Math.floor(Date.now() / 1000) - 60)
    void reply.status(302).header('location', url).header('cache-control', `private, max-age=${left}`)
  }

  private async playlist(key: string, reply: FastifyReply): Promise<string> {
    const [bucket, privateKey] = placed('private', key)
    // Gone: moved back to public, taken down or deleted since the URL was made.
    if ((await this.store.size(bucket, privateKey)) === null) throw new NotFoundException()
    void reply.header('content-type', HLS_CONTENT_TYPES['.m3u8']!)
    return (await this.store.read(bucket, privateKey)).toString('utf8')
  }
}
