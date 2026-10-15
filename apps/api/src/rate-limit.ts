import { HttpException, Injectable } from '@nestjs/common'

type Window = { count: number; resetAt: number }

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** What each kind of action is allowed, per member (or per caller, if anonymous). */
export const LIMITS = {
  post: [
    { max: 10, windowMs: MINUTE },
    { max: 60, windowMs: HOUR },
  ],
  // Likes, bookmarks, follows, joins, blocks and mutes share one budget.
  action: [{ max: 120, windowMs: MINUTE }],
  report: [{ max: 10, windowMs: HOUR }],
  search: [{ max: 60, windowMs: MINUTE }],
  inviteCheck: [{ max: 20, windowMs: MINUTE }],
  // Name and bio changes.
  profile: [{ max: 20, windowMs: HOUR }],
  // Profile photo changes.
  upload: [{ max: 10, windowMs: HOUR }],
  // Downloading your own data: it reads everything, so only a few times an hour.
  export: [{ max: 5, windowMs: HOUR }],
  // Images attached to posts: up to four a post, so a bigger budget than photos.
  postImage: [
    { max: 12, windowMs: MINUTE },
    { max: 60, windowMs: HOUR },
  ],
} satisfies Record<string, { max: number; windowMs: number }[]>

/**
 * Fixed-window counters held in memory. Enough for one API process: the counts
 * reset on restart and are not shared between instances, so this must move to
 * Redis before the API is scaled out.
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, Window>()

  /** Counts one action; throws 429 if `who` has used up any of the limits for `kind`. */
  hit(kind: keyof typeof LIMITS, who: string, now = Date.now()): void {
    if (this.windows.size > 50_000) this.sweep(now)

    const rules = LIMITS[kind]
    const windows = rules.map(({ windowMs }) => {
      const key = `${kind}:${windowMs}:${who}`
      let w = this.windows.get(key)
      if (!w || w.resetAt <= now) {
        w = { count: 0, resetAt: now + windowMs }
        this.windows.set(key, w)
      }
      return w
    })

    const exhausted = windows.find((w, i) => w.count >= rules[i]!.max)
    if (exhausted) {
      throw new HttpException(
        { code: 'rate_limited', message: 'Too many requests. Please slow down.', retryAfterMs: exhausted.resetAt - now },
        429,
      )
    }
    for (const w of windows) w.count++
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key)
  }
}
