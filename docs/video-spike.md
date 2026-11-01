# Video phase 1: the multipart spike and what was built

Companion to ADR 0019 (video posts, on `docs/video-posts`). Phase 1 is the upload,
process and quarantine pipeline. **Read `docs/safety/video-scanning.md` first: with no
scanner configured, no video is ever published.**

## The R2 presigned-multipart spike: local MinIO only

**R2 is unverified.** There is no R2 account. Everything below was run against local
MinIO (S3-compatible) by `apps/api/src/video/multipart.spike.test.ts`, which skips
unless `VIDEO_SPIKE_S3_ENDPOINT`, `_KEY` and `_SECRET` are set, and makes and removes
its own buckets. Do not read a MinIO pass as an R2 pass.

Found on MinIO (each is an assertion in the spike):

| Question | Finding |
|---|---|
| Do presigned `UploadPart` URLs work straight from a browser-style `fetch`? | Yes, with a plain `PUT` and no extra headers. The part's `ETag` comes back in the response header. |
| Is `Content-Length` enforceable? | Yes. A part signed for N bytes refuses a body of another size (the signature includes it). The API signs the exact size of each part. |
| Can an interrupted upload resume? | Yes. `ListParts` after a "reload" returns the parts held and their sizes, so only the rest is sent. The API's `GET /v1/me/videos/:id/upload` does this and signs fresh URLs for the rest. |
| Does `CompleteMultipartUpload` assemble the object, and can the server check the size after? | Yes. The API takes `HeadObject`'s size and rejects an object that is not exactly what was declared. |
| Does abort remove parts? | Yes. After abort the object is absent and `ListParts` fails. The abandoned-upload sweep relies on this. |
| Server-side copy between buckets, and streaming to and from disk | Works (the worker downloads the original to disk and uploads renditions from disk; nothing is held in memory). |
| Does a public object answer `Range` with `206`? | Yes, with `Accept-Ranges: bytes` and the right `Content-Range`. This is what a video player needs. |

**Still to check on R2 itself, before production** (none can be answered here):

1. That R2 accepts presigned `UploadPart` with `Content-Length` signed. R2 documents
   presigned multipart as supported; whether it enforces the signed length the way
   MinIO does is not tested.
2. R2's minimum part size (5 MiB, as S3) and 10,000-part limit, against `VIDEO_PART_BYTES`.
3. CORS on the uploads bucket for `PUT` from the web origin, exposing `ETag`
   (`ExposeHeaders: ETag`). Without that, the browser cannot read each part's ETag
   and the upload cannot complete. MinIO in development did not need it because the
   API, not the browser, collects ETags: **the API lists parts on complete and does not
   trust browser-supplied ETags**, which makes the CORS point moot for this design, but
   the PUT itself still needs CORS from the web origin.
4. Cloudflare's rules on serving video from R2 through a custom domain (ADR section
   3.3), and the CSAM tool on that hostname.
5. `Range` and caching headers through Cloudflare's edge.

## What phase 1 contains

- **Flag** `videoPosts`: off in production, on in staging and development. Effective
  only if the flag is on and (a scanner is bound or `APP_ENV` is not `production`).
- **Migration** `0031_video_posts.sql`, additive. (The brief said 0030; the base branch
  already has an 0030, so this is 0031. Renumber at merge as usual.)
- **API** under `/v1/me/videos`: start an upload, resume, complete, status, delete.
  Owner-only while not `ready`. Every route is the uniform 404 when the gate is shut.
- **Worker** (`pnpm --filter @heynaija/api video:worker`; the `video-worker` Docker
  target and a `video` compose profile): probe, reject, transcode 240/360/480p MP4 and
  a WebP poster, sample frames, scan, publish.
- **Web**: attach in the composer, progress, processing state, playback from a poster.

## Measured: one 60 s 1080p clip on this laptop

A 60 s, 1920x1080, 30 fps clip at 8 Mb/s (60.6 MB), on a busy 5-load laptop, through
the real functions:

- probe 40 ms; frame sampling 1.9 s (61 frames); one-pass transcode to all three
  renditions 2.1 s (2.7, 4.7 and 7.4 MB); poster 74 ms; process memory 92 MB.

This is a synthetic test pattern, which encodes far faster than real footage, so
**treat it as a floor, not a forecast**. The ADR's capacity question should be
answered on staging hardware with real clips.

## Not verified

- Anything on R2 (above).
- Playback in real browsers (not run; the web typecheck passes and the pure helpers
  are tested).
- The Docker image build (no Docker from a worktree, per the brief).
- A real PhotoDNA call. The frame scan is tested against a stand-in.
- Low-data holding: the player has a `held` prop, but the low-data setting (PR #49) is
  not in this branch, so nothing sets it. The player is tap-to-play: the `<video>`
  element is not created until the tap, so no video bytes load before it, but the
  poster image does.

## Defaults chosen for the ADR's open questions

Each is an environment setting (`apps/api/src/video/video-config.ts`):

| Question | Default | Setting |
|---|---|---|
| Keep originals after processing | No: delete once renditions are ready. A blocked match is always kept. | `VIDEO_KEEP_ORIGINALS=false` |
| Limits | 60 s, 100 MB, 1080p longest edge, one video per post | `VIDEO_MAX_SECONDS`, `VIDEO_MAX_BYTES`, `VIDEO_MAX_EDGE` |
| Who may post first | Flag allow-list, then accounts 7 days old with nothing upheld in 90 days; 50 live videos at most | `VIDEO_MIN_ACCOUNT_AGE_DAYS`, `VIDEO_UPHELD_LOOKBACK_DAYS`, `VIDEO_MAX_LIVE_PER_MEMBER` |
| An illegal report hides the video at once | Yes | (code) |
| Upload window before an open upload is aborted | 24 hours | `VIDEO_UPLOAD_WINDOW_HOURS` |
| Part size | 5 MiB | `VIDEO_PART_BYTES` |
