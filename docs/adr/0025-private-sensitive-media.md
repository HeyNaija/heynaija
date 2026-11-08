# ADR 0025 — Pictures and video of posts marked sensitive are served privately, by signed URL

**Date:** 7 November 2026 · **Status:** Accepted · **Amends:** [ADR 0020](0020-under-18-accounts-and-adult-labels.md)
section 3 ("Media"), [ADR 0021](0021-video-hls-on-r2.md) section 4 ("18+ video") ·
**Related:** `docs/governance/under-18-rollout.md` section 4, `docs/deployment/cloudflare-r2.md`

## Decision

A post marked sensitive (`posts.adult_label`, ADR 0020) reaches only signed-in
adults and its author. Until now its pictures and video stayed in the public media
bucket under `/media`, which bypasses the API: anyone holding a URL could open them.
Now:

1. **A marked post's files live in the private bucket**, under `sensitive/` with
   the key they had (`sensitive/posts/<id>/640.webp`,
   `sensitive/videos/<id>/hls/240/piece-000.m4s`). Unmarked media stays in the
   public bucket, on the fast path, unchanged. `media.served_privately` (migration
   0041) records where a ready file is; the post's mark says where it should be.
2. **The only way to them is a signed URL the API makes while answering a read
   that has just passed the post's own check** (`adultContentAllowed`). Every read
   path builds post media URLs in one place (`MediaUrls`,
   `apps/api/src/media/media-urls.ts`): feeds, threads, profiles, search,
   hashtags, quoted and reposted posts, the uploader's own video status, the
   moderation queue and the data export. A viewer the post is withheld from never
   receives one.
3. **The URL signs a folder, not a file:**
   `/api/v1/media/private/<expiry>/<signature>/posts/<id>`, the signature an
   HMAC-SHA256 of `posts/<id>/<expiry>` under a key derived from
   `S3_SECRET_ACCESS_KEY` (a secret only the API has, so no new setting). The apps
   append `/640.webp` as they always have, and an HLS master playlist's relative
   lines resolve under the same signature. A URL works until the end of the next
   whole hour (one to two hours), and everyone is given the same one within an
   hour, so browsers reuse what they fetched.
4. **The API checks the signature without the database and never carries the
   bytes** (`PrivateMediaController`). A picture or poster is a `302` to a storage
   URL presigned for the same window. A master playlist is sent as it is. A
   quality's playlist is sent with its init segment and every piece replaced by a
   presigned storage URL, so video still comes straight from R2, as Cloudflare's
   terms require (ADR 0021 section 4). Anything wrong (signature, expiry, file
   name, a file that has moved) is `404`.
5. **Marking moves the files; unmarking moves them back.** A queued job
   (`place-post-media`) moves each file of the post's ready images and video
   (copy, then delete the source; a file already moved is skipped), updates
   `served_privately`, and purges the public URLs from Cloudflare. It is queued
   when a post is created marked (the composer's switch, or Settings' "mark
   everything I post"), when the author marks or unmarks it from the post's menu,
   and when a moderator marks it (`label_post`) or takes the mark off (`unlabel`).
   The hourly sweep places anything whose place and mark disagree: a failed job,
   or a post marked before this existed.
6. **Takedowns know the private place.** Removing a post moves its files to the
   quarantine from either place; restoring it puts them back where its mark says;
   deleting removes them from every place.
7. **Nothing private is ever in a shared cache.** Every answer from its routes,
   refusals included, says `Cache-Control: private` (`no-store`, or until the URL
   runs out for a redirect). Files in the private bucket carry
   `private, max-age=7200`, and a copy between buckets takes the destination's
   header instead of the source's year-long public one. Presigned URLs are on R2's
   S3 endpoint, not our zone, so Cloudflare's cache never sees them.

## Context

ADR 0020 asked for "short-lived signed URLs" and left video open; ADR 0021 noted
that R2 signs single objects only, so a signed master playlist's relative lines
would break. The rollout doc's section 4 makes private serving a condition of
admitting anyone under 18.

What constrained the choice:

- **Cloudflare's terms:** video must come from R2, never through our server
  (ADR 0021 section 4), so an API proxy for pieces is out.
- **The apps:** they build image URLs from a path plus a size suffix, and play
  video from URLs the post carries. Neither sends a session with an image or a
  video request.
- **No new infrastructure:** no Worker, no second bucket, no new secret, and the
  same code in development (MinIO), staging and production (R2).

## Options considered

- **API proxy with the session cookie.** Checks every request, but video bytes
  would pass through our server (against Cloudflare's terms), and the apps load
  images and video without a session.
- **Presigned storage URLs straight in the post.** One URL per size of every
  image changes the shape the web and the apps read, and a presigned master
  playlist cannot name its qualities.
- **A Cloudflare Worker in front of a private bucket, checking a token.** Fast at
  the edge, but new infrastructure to deploy and keep in step, and nothing like it
  in development.
- **Chosen: a folder-signed path the API checks, redirecting to presigned storage
  URLs, with playlists signed piece by piece.** The shapes stay as they are, the
  bytes stay on R2, and the API's part is an HMAC and a presign, with no database
  read.

## Consequences

- A signed URL is a capability: anyone it is shared with can open the file until
  it runs out, at most two hours. The unguessable public URL it replaces never ran
  out. A viewer whose access ends (blocked, or an age record withdrawn) keeps a URL
  already given for as long.
- For a few seconds after a mark changes, the files are moving: the post's
  pictures may briefly not load, and until the job runs, a newly marked post's
  public copies are still reachable by anyone who already has their address.
- Each marked picture or poster costs one request to the API (a redirect, which
  the browser keeps for the hour) before the bytes; a marked video's playlists come
  from the API. That is the "costs more to serve" ADR 0020 accepted, for a small
  share of posts.
- Link preview images (`links/...`) stay public: they are copies of a page's own
  public preview image, shared by every post that links that page. Avatars and
  community photos cannot be marked (ADR 0020 section 2).
- The video worker publishes to the public bucket. That is safe only because a
  video cannot be attached to a post until it is ready; if ADR 0021 section 6
  ("posted before it is ready") is built, the worker must publish a marked post's
  video to the private place.

## Setup (once per environment)

- `heynaija-uploads` needs a CORS rule allowing `GET` and `HEAD` from the site, for
  hls.js fetching a marked video's pieces from R2's S3 endpoint
  (`docs/deployment/cloudflare-r2.md` step 4).
- No lifecycle rule may cover `sensitive/` (step 5).
- No Cloudflare Cache Rule may make `/api/*` cacheable; check a private URL
  answers with `cf-cache-status: DYNAMIC` or `BYPASS` (step 8).
