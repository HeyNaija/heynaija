import { randomUUID } from 'node:crypto'
import { type Db, linkPreviews } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { eq, type SQL, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { CONTENT_SCANNER, type ContentScanner, NoScanner, OBJECT_STORE } from '../media/media.service.js'
import type { ObjectStore } from '../media/object-store.js'
import { DB } from '../tokens.js'
import { decodePage, readPageMeta } from './page-meta.js'
import { type PageFetcher, SafeFetcher } from './safe-fetch.js'

export const LINK_JOBS = Symbol('LINK_JOBS')
export const PAGE_FETCHER = Symbol('PAGE_FETCHER')

/** What the link service needs from the job queue: somewhere to send work. */
export interface LinkJobs {
  /** Queues the reading of a page for its preview. Safe to repeat. */
  buildPreview(url: string): Promise<void>
}

/** Where a preview's thumbnail is served from, without the size suffix: the web app appends `/640.webp`. */
export const linkImagePath = (imageId: string): string => `/media/links/${imageId}`
const imageKey = (imageId: string) => `links/${imageId}/640.webp`

// A good preview is shown for a week before it is looked at again; a page that
// could not be read is tried again after an hour; a request that was queued but
// never finished (a lost job) is repeated after ten minutes.
const FRESH_FOR = "interval '7 days'"
const RETRY_FAILED_AFTER = "interval '1 hour'"
const LOST_AFTER = "interval '10 minutes'"

export const PAGE_MAX_BYTES = 512 * 1024
export const THUMBNAIL_MAX_BYTES = 4 * 1024 * 1024
const THUMBNAIL_EDGE = 640
// Smaller than this is a logo or an icon, not a picture worth a card of its own.
const THUMBNAIL_MIN = { width: 200, height: 100 }
const THUMBNAIL_FORMATS = ['jpeg', 'png', 'webp', 'gif', 'avif']

/**
 * Link previews: what a web address in a post leads to, fetched once for everyone.
 * Pages are read by `PageFetcher` (which refuses anything but the public web) and
 * the picture is copied to our own storage, so readers never contact the linked
 * site and a site cannot swap the picture after the post is made.
 */
@Injectable()
export class LinksService {
  private readonly log = new Logger(LinksService.name)

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(LINK_JOBS) private readonly jobs: LinkJobs,
    @Optional() @Inject(PAGE_FETCHER) private readonly fetcher: PageFetcher = new SafeFetcher(),
    @Optional() @Inject(CONTENT_SCANNER) private readonly scanner: ContentScanner = new NoScanner(),
  ) {}

  /**
   * Asks for a preview of `url` (as `previewUrlOf` gives it) unless a recent one
   * exists. Never throws: a post is made whether or not its link can be read.
   */
  async request(url: string): Promise<void> {
    try {
      const { rows } = await this.db.execute<{ url: string }>(sql`
        insert into link_previews (url) values (${url})
        on conflict (url) do update set requested_at = now(),
          status = case when link_previews.status = 'failed' then 'pending' else link_previews.status end
        where (link_previews.status = 'failed' and link_previews.fetched_at < now() - ${sql.raw(RETRY_FAILED_AFTER)})
          or (link_previews.status = 'ready' and link_previews.fetched_at < now() - ${sql.raw(FRESH_FOR)})
          or (link_previews.status = 'pending' and link_previews.requested_at < now() - ${sql.raw(LOST_AFTER)})
        returning url`)
      if (rows.length) await this.jobs.buildPreview(url)
    } catch (error) {
      this.log.warn(`could not ask for a preview of a link: ${error instanceof Error ? error.message : error}`)
    }
  }

  /**
   * The background job. A page that cannot be read, or has nothing to show,
   * leaves the post without a card; a storage error throws so the job is retried.
   */
  async buildPreview(url: string): Promise<void> {
    const [row] = await this.db.select().from(linkPreviews).where(eq(linkPreviews.url, url))
    if (!row) return

    let page
    try {
      page = await this.fetcher.get(url, {
        accept: ['text/html', 'application/xhtml+xml'],
        maxBytes: PAGE_MAX_BYTES,
        partial: true,
      })
    } catch (error) {
      return this.giveUp(url, error instanceof Error ? error.message : 'unreadable')
    }
    const meta = readPageMeta(decodePage(page.body, page.contentType), page.url)
    if (!meta.title && !meta.description) return this.giveUp(url, 'nothing to show')

    // A picture that cannot be used leaves a card without one rather than no card.
    const image = meta.image ? await this.thumbnail(meta.image).catch(() => null) : null
    await this.db
      .update(linkPreviews)
      .set({
        status: 'ready',
        title: meta.title ?? meta.siteName,
        description: meta.description,
        siteName: meta.siteName,
        imageId: image?.id ?? null,
        imageWidth: image?.width ?? null,
        imageHeight: image?.height ?? null,
        fetchedAt: new Date(),
      })
      .where(eq(linkPreviews.url, url))
    if (row.imageId) await this.store.remove('media', imageKey(row.imageId))
  }

  private async giveUp(url: string, reason: string): Promise<void> {
    this.log.debug(`no preview for ${url}: ${reason}`)
    // A refresh that fails keeps the old card; only a first attempt leaves none.
    await this.db.execute(sql`
      update link_previews set fetched_at = now(), status = case when status = 'ready' then status else 'failed' end
      where url = ${url}`)
  }

  /** The page's picture, shrunk and stored as ours. Null when it is missing, unsuitable or blocked. */
  private async thumbnail(imageUrl: string): Promise<{ id: string; width: number; height: number } | null> {
    const got = await this.fetcher.get(imageUrl, { accept: ['image/'], maxBytes: THUMBNAIL_MAX_BYTES })
    let image: ReturnType<typeof sharp>
    try {
      image = sharp(got.body, { limitInputPixels: 25_000_000 })
      const meta = await image.metadata()
      // An allow-list: SVG, for one, is code and is not re-drawn here.
      if (!meta.format || !THUMBNAIL_FORMATS.includes(meta.format)) return null
      if ((meta.width ?? 0) < THUMBNAIL_MIN.width || (meta.height ?? 0) < THUMBNAIL_MIN.height) return null
    } catch {
      return null
    }
    if ((await this.scanner.scan(got.body)) !== 'clear') return null
    const { data, info } = await image
      .rotate()
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer({ resolveWithObject: true })
    const id = randomUUID()
    await this.store.write('media', imageKey(id), data, 'image/webp')
    return { id, width: info.width, height: info.height }
  }

  /**
   * Forgets previews no post links to and nobody has asked for in a week, with
   * their pictures. Runs hourly.
   */
  async sweep(): Promise<void> {
    const { rows } = await this.db.execute<{ image_id: string | null }>(sql`
      delete from link_previews lp
      where lp.requested_at < now() - interval '7 days'
        and not exists(select 1 from posts p where p.link_url = lp.url)
      returning lp.image_id`)
    for (const { image_id } of rows) if (image_id) await this.store.remove('media', imageKey(image_id))
  }
}

/** A preview as a reader sees it. */
export type LinkPreview = {
  url: string
  title: string
  description: string | null
  siteName: string | null
  image: { src: string; width: number; height: number } | null
}

export type LinkPreviewRow = {
  url: string
  title: string
  description: string | null
  siteName: string | null
  imageId: string | null
  imageWidth: number | null
  imageHeight: number | null
}

export const toLinkPreview = (row: LinkPreviewRow | null): LinkPreview | null =>
  row
    ? {
        url: row.url,
        title: row.title,
        description: row.description,
        siteName: row.siteName,
        image:
          row.imageId && row.imageWidth && row.imageHeight
            ? { src: linkImagePath(row.imageId), width: row.imageWidth, height: row.imageHeight }
            : null,
      }
    : null

/**
 * A post's preview card as JSON, for any query with the post in scope: its first
 * address's preview, when one has been read. `linkUrl` is the post's `link_url`.
 */
export const linkPreviewOf = (linkUrl: SQL) =>
  sql<LinkPreviewRow | null>`case when ${linkUrl} is null then null else (
    select json_build_object('url', lp.url, 'title', lp.title, 'description', lp.description, 'siteName', lp.site_name,
      'imageId', lp.image_id, 'imageWidth', lp.image_width, 'imageHeight', lp.image_height)
    from link_previews lp where lp.url = ${linkUrl} and lp.status = 'ready') end`
