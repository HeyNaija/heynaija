# ADR 0019 — Video posts: short clips, uploaded from the device, scanned before anyone sees them

**Date:** 31 October 2026 · **Status:** Proposed. Phase 1 is implemented in PR #70
(`feat/video-phase1`), not yet merged; nothing is in main. Where PR #70 differs
from this ADR, section 7 lists what it must change. · **Roadmap:** `video`
(depends on `upload-scanning`; this ADR adds `low-data-controls`) ·
**Related:** [ADR 0017](0017-calls-and-meetings.md) (cost-model style),
`docs/safety/abuse-material-scanning.md`, `docs/deployment/cloudflare-r2.md`,
[ADR 0006](0006-age-status-model.md), `docs/governance/under-18-rollout.md`.
Merged work this builds on: low-data controls (PR #49), database feature flags
(PR #53, `docs/feature-flags.md`) and account deletion (PR #59,
[ADR 0016](0016-account-deletion.md)). Merged as proposals, not built:
[ADR 0018](0018-age-verification.md) (PR #61) and
[ADR 0020](0020-under-18-accounts-and-adult-labels.md) (PR #77, 18+ labels,
which covers video: section 4.6).

Nothing here is legal advice; legal points are for Nigerian counsel (section 4.6).
Outside facts are cited in Sources with the date read (31 October 2026). Anything
marked **(unverified)** was not confirmed from a primary source. Prices change.

## Decision

Members can attach **one short video (up to 60 seconds, 100 MB, 1080p) to a
post**, uploaded from their device, never a link, never live. It is **built dark**
behind a `videoPosts` flag that is off in production, and **cannot be switched on
in production while the scanner is `NoScanner`**: that is enforced in code, not by
convention (section 4.7).

1. **Upload:** straight from the browser to the private `uploads` bucket as an S3
   multipart upload with a signed URL per 5 MiB part, so a dropped connection loses
   one part, not the clip. Resumable after a reload.
2. **Process:** a separate `video-worker` container (ffmpeg, on the existing
   BullMQ/Redis) probes the file, **scans sampled frames first**, then makes
   240p, 360p and 480p H.264/AAC MP4s, a poster and a duration. Original deleted
   on success. Not Cloudflare Stream or Mux in v1; Stream is the named fallback.
3. **Serve:** from the public media bucket's own Cloudflare custom domain, **not**
   through our nginx, because Cloudflare's terms restrict serving video through
   the proxied CDN without a paid service (section 3.3). This needs Cloudflare's
   written confirmation first, and the web app pointing video at that domain;
   both are launch-gate items. Video marked 18+ (ADR 0020) is the exception: it is
   served privately, by signed URL.
4. **Play:** poster first, tap to play, no autoplay in v1, quality picked by the
   member's data setting. No captions in v1 (section 5.3 says what that costs).
5. **Safety:** frame sampling into the PhotoDNA path (the poster frame included),
   fail closed, audio ignored in v1, quarantine and takedown like images. A video
   reported as illegal is hidden at once and decided by a named safety reviewer,
   never by an ordinary moderator, and a false report costs the uploader nothing.

**Launch gate (all required, section 4.7):** `upload-scanning` un-blocked and
PhotoDNA live in production; Microsoft's written answer that frame-by-frame
video use fits its terms; Cloudflare's written answer on video via R2; video
served from the media domain, not `/media` on the site; the existing
abuse-material checklist fully ticked; counsel's answers; phase 4 drills passed;
a named person signs off. Cost at 10,000 videos a month is about $13 a month on
R2 versus roughly $800 on Stream (section 6).

## Context

- Members upload images and GIFs today (the pipeline is in
  `apps/api/src/media/media.service.ts`): browser to the private `uploads` bucket
  with a 300-second signed PUT that pins type and size; a BullMQ job (`media`
  queue, concurrency 2, in the API process) reads the file **whole into memory**
  (`ObjectStore.read` returns a `Buffer`), scans it, re-encodes with sharp, writes
  WebP to the public `media` bucket, deletes the original. Matches go to
  `quarantine/originals/…` in the private bucket, the row becomes `blocked`, an
  "Illegal content" report and an email alert follow. Moderator removal moves
  published files to `quarantine/…` and queues a CDN purge.
- `ContentScanner.scan(image: Buffer)` is bound to `NoScanner` until
  `PHOTODNA_SUBSCRIPTION_KEY` is set. The roadmap entry `upload-scanning` is
  `blocked` ("waiting for PhotoDNA approval"). The `video` entry records the
  owner's decision of 18 October 2026: **not before a real upload scanner is
  bound.**
- Media is served at `/media/*` on the site's hostname: Cloudflare, then nginx
  (`infra/deploy/nginx/heynaija.conf.template`), which proxies to the R2 custom
  domain. Fine for 20 KB images; wrong for megabytes (section 3.3).
- Production is one netcup RS 2000: 8 dedicated cores, 16 GB, shared by web
  (4 processes), API, Postgres, Kratos and Redis (`docs/deployment/production.md`).
  Staging is a shared Contabo box that ADR 0017 calls memory-tight.
- Members are on low-end Android and metered, patchy data. A 360p clip is about
  2 MB; a feed image is tens of KB. Video is the first media that can cost a
  member real money to open, which is why low-data (section 5) is part of the
  design and not an add-on.
- Under-18 accounts are refused today (ADR 0006); every member is an adult at the
  account level. ADR 0020 (proposed) would open them in its phase 2.

## 1. Scope of v1

| | v1 |
|---|---|
| Source | Upload from the device only (a file input, so the phone's own camera works) |
| Per post | One video, **and no images or GIFs beside it** (simpler layout, one thing to scan and take down) |
| Duration | 3 to 60 seconds (recommended; a constant, `VIDEO_MAX_SECONDS`) |
| Size | 100 MB original (`VIDEO_MAX_BYTES`); a 60 s 1080p phone clip is about 75 to 125 MB, so some minute-long clips are over the limit: the composer shows the size before upload |
| Resolution | Longest edge up to 1920 px, up to 60 fps (output is capped at 30 fps). Above 60 fps, such as a slow-motion clip saved at 120 or 240 fps, is refused with its own reason, `too_high_frame_rate`, so the member is told what to change; the cap bounds decoding work |
| Containers | MP4, MOV (QuickTime), WebM. The server decides by probing, not by the browser's type |
| Output | 240p, 360p, 480p MP4 (H.264 + AAC), a poster, a duration |
| Not in v1 | Live video, editing or trimming, remote URLs or embeds, audio-only, captions, downloads, video in profile photos or bios, video in replies (**recommend: posts only at first**) |

Recommendation for replies: top-level posts and quotes only in phase 2, replies
after launch once moderation load is known.

## 2. Upload path

Options: (a) one signed PUT as for images; (b) S3 multipart with signed parts;
(c) a tus server (tusd or in the API); (d) Cloudflare Stream direct upload.

**Recommend (b).** A single PUT restarts from zero when a mobile connection drops
at 90 percent of 100 MB. Multipart uploads in 5 MiB parts (R2's minimum; every
part but the last the same size, up to 10,000 parts, objects up to 5 TiB) lose one
part at a time. R2 aborts incomplete multipart uploads after 7 days by default.
(c) is a proper resumable protocol (tus 1.0.0: `HEAD` for the offset, `PATCH` from
there) but adds a server in the upload path and keeps bytes passing through our
box; (d) ties us to Stream.

**Unverified and the first thing phase 1 tests:** R2's documentation of presigned
URLs lists GET, HEAD, PUT and DELETE only and does not mention `UploadPart`.
The AWS presigner can sign it, but whether R2 accepts it must be tried against
real R2 (the project has so far only run against MinIO). **If R2 refuses, fall
back to (c), tusd behind the API, writing to R2.** Do not start phase 2 before this
is answered.

Flow (state in a `media` row of kind `post_video`, status as for images, plus `uploading` and `rejected`, section 7):

1. `POST /v1/me/videos/upload` with `{contentType, bytes, durationMs?}`: checks the
   flag, the gate, quotas and rate limits; creates the row; `CreateMultipartUpload`;
   returns `mediaId`, `partSize`, and signed part URLs (valid 30 minutes each, with
   `content-length` signed as images do).
2. The browser uploads two parts at a time, retries a failed part three times with
   backoff, and shows progress and "Resume".
3. After a reload or a lost tab: `GET /v1/me/videos/:id/upload` lists parts done
   (`ListParts`) and returns fresh URLs for the rest, until the upload window ends.
4. `POST /v1/me/videos/:id/complete`, with no body: the API asks storage which parts
   it holds (`ListParts`), checks each is exactly the declared size, completes the
   multipart upload, checks the total size, sets `processing`, queues the job. No
   ETags pass through the browser, so the bucket CORS rule needs nothing beyond
   allowing `PUT` from the site, as for images.
5. The browser polls `GET /v1/me/videos/:id` (its own rate-limit budget, section 7)
   every few seconds, more slowly after the first minute, until `ready`,
   `rejected`, `failed` or `quarantined`. The uploader is never told a scanner
   matched: a `blocked` video comes back as `rejected` with no reason. A `rejected`
   with a reason shows its class (too long, too short, too large, too big a
   picture, too high a frame rate, not a video); a `rejected` with no reason and a
   `quarantined` show "That video cannot be used"; `failed` shows a generic "could
   not be processed, try again". Processing continues if the tab closes; the draft
   keeps the media ID.

**Client-side checks** are courtesy only: file type, size, and duration from the
element's metadata (it may fail for formats the browser cannot decode, such as
HEVC on some browsers; then upload anyway and let the server decide). No
client-side transcoding: too heavy for the phones we serve. The server probes
everything again.

**Abandoned uploads.** The existing hourly sweep marks `pending` uploads over an
hour old as deleted. A video gets **24 hours** (resume needs time), after which the
sweep calls `AbortMultipartUpload`, removes the object, and marks the row deleted.
Add `videos/` to the uploads bucket's lifecycle rules (1 day, like `avatars/` and
`posts/`), never `quarantine/`; the 7-day multipart abort is the backstop. That
rule is right only while originals are deleted once processed (open question 1,
recommended). If the answer is to keep them, a kept original moves to
`originals/videos/<id>`, a prefix no lifecycle rule covers, instead of staying
under `videos/`, where the rule would delete it a day later without any error.
Unattached `ready` videos (never put on a post) are cleared after an hour, as
images are.

## 3. Processing

### 3.1 What it makes

For a landscape or portrait clip, with the **short edge** at 240, 360 and 480 px
(so a 1080x1920 phone clip does not become a 1920-pixel-wide file), **never
enlarged**: a clip whose short edge is under 480 gets only the rungs at or below
it, and one under 240 gets a single rendition at its own size (`200.mp4` for a
200 px short edge). So a video has one to three renditions, named by their short
edge; the rows in `video_renditions` (section 7) are the list, and nothing
assumes all three exist:

| Rendition | Video | Audio | About, 30 s |
|---|---|---|---|
| 240 | 300 kbps | 48 kbps AAC | 1.3 MB |
| 360 | 550 kbps | 64 kbps AAC | 2.3 MB |
| 480 | 900 kbps | 64 kbps AAC | 3.6 MB |

H.264 Main, `yuv420p`, 30 fps cap, `+faststart` (so playback starts before the
file is loaded), closed GOP of 2 s. Plus `poster.webp` at 640 px (a frame 1 s in;
clips are at least 3 s), cut from a frame the scanner has seen (section 4.1), and
`duration_ms`. The bitrates are
starting points to be tuned on real Nigerian phone footage in phase 1. Audio-less
clips get no audio track. Location and device metadata are dropped (`-map_metadata -1`),
as sharp drops EXIF for images.

**Progressive MP4, not HLS, for v1.** Clips are 60 seconds at most. HLS adds
segments (tens of small objects per rendition, more PUTs and purges), a player
library, and a manifest to take down. The member's data setting chooses the
rendition up front (section 5), which is the only "adaptive" behaviour needed.
Revisit HLS if clips grow past a few minutes.

### 3.2 Where it runs: self-hosted worker or a managed service

| | Self-hosted ffmpeg worker (recommended) | Cloudflare Stream | Mux |
|---|---|---|---|
| Cost at 10,000/month | About $13/month storage (R2), compute on our server | About $800/month | About $580/month, list rates (section 6) |
| Data protection | Files stay in our R2; one fewer processor | Cloudflare is already our processor | New processor, new DPA, new transfer question |
| Control over scanning | Full: we sample frames before anything is encoded or published | Stream's FAQ says nothing about scanning (unverified for CSAM) | Not stated; frame access would need their API |
| Control over takedown | Move or delete files, purge by URL | Delete the video | Delete the asset |
| Nigerian latency | R2 is in Europe (no African region, per our R2 doc); Cloudflare's edge caches repeat views | Cloudflare's network, same edge | Fastly or its own CDN (unverified) |
| Our work | Most: worker, ffmpeg sandbox, retries | Least | Least |
| Lock-in | None | Storage prepaid in $5 steps per 1,000 minutes | Pay as you go |

Recommendation: **self-host**. Cost at our size is trivial, the originals and
frames never leave our storage, and scanning order is ours. The work is real
(about 11 owner-days for phase 1) but is mostly the pipeline we need for scanning
anyway. **Fallback:** if Cloudflare says R2 video through our zone is not allowed
(section 3.3), switch the delivery side to Stream and keep our upload and scan
steps, calling Stream only after the scan has cleared the frames.

### 3.3 Cloudflare's terms on serving video (checked)

Cloudflare's Service-Specific Terms, under "Content Delivery Network (Free, Pro,
or Business)": non-Enterprise customers "must use" specific Paid Services "to serve
video and other large files via the CDN", and Cloudflare "reserves the right to
disable or limit your access to or use of the CDN if you use or are suspected of
using the CDN without such Paid Services to serve video or a disproportionate
percentage of pictures, audio files, or other large files." The Paid Services it
names are Stream, the Developer Platform and Images. The clause is unnumbered on
the page. R2 is not mentioned by name there.

What this means for us (my reading, not Cloudflare's, and not legal advice):

- **Today's path breaks the clause for video.** `/media/*` on `heynaija.ng` is a
  proxied hostname served from our nginx, which proxies on to R2. Video there is
  video served "via the CDN" by a non-Stream plan. It would also pull video bytes
  through our server on every cache miss.
- **Serve video from the R2 custom domain directly** (`media.heynaija.ng`), where
  R2 is the Developer Platform product the clause names. This needs the web app
  to emit absolute media-host URLs for a video's renditions and poster. PR #70
  still emits `/media/videos/<id>` on the site's hostname; changing that is phase
  2 work and a launch-gate item (section 4.7), because without it every other gate
  item can be met while video still goes through the proxied path. Pages have no
  Content-Security-Policy today (the only one in `apps/web/next.config.ts` is on
  `/sw.js`), so nothing blocks the media host; a page CSP added later must allow it
  in `media-src` and `img-src`.
- **Video marked 18+ is not served from the public bucket.** ADR 0020 (section 3)
  keeps labelled media, video included, in the private bucket and serves it to
  allowed viewers by short-lived signed URLs; adding the label later moves the
  files and purges the CDN, as removal does. R2 signs URLs only on its S3 endpoint,
  not on custom domains (Sources), so those plays come from R2 directly: not
  edge-cached, slower from Nigeria, a Class B read per range request. Build the
  private path with phase 2's serving work, not after it. This applies only once
  ADR 0020's labels are accepted; until then no video can be labelled.
- **Confirm in writing with Cloudflare before launch** that an R2 public bucket on
  a custom domain, serving this volume of video, is within the terms on our plan,
  and that the CSAM Scanning Tool and cache purge cover that hostname (the tool's
  docs name images; they do not say whether video is scanned: unverified).
- Whether R2 custom domains cache and range-serve large MP4s the way a player
  needs (`Accept-Ranges`) is **unverified**; phase 1 tests it.

### 3.4 Sizing on our servers

Estimates, **unverified until measured in phase 1** (acceptance: a 60 s 1080p30
phone clip finishes in under 90 s wall time at 2 cores, with the worker and ffmpeg
together under 1 GB, so the 1.5 GB limit keeps a margin):

- The transcode is one ffmpeg process: decode once, three encodes (`-preset veryfast`,
  `-threads 2` per encode). Sampling frames for the scan decodes the original twice
  more (one a second, then scene changes). Expect roughly 15 to 30 s of encoding
  for a 30 s clip, plus the sampling and the scan calls.
- 10,000 videos a month is about 14 an hour on average. A 10x evening peak is 140
  an hour; at about 30 s or more each, that is over an hour of work an hour for one
  worker at concurrency 1, so the queue grows during the peak and drains after it.
  Fine at 1,000 a month (a peak of 14 an hour); at 10,000, see the last point.
- The worker is its own container with `cpus: 2`, `mem_limit: 1.5g`, **concurrency 1**,
  `nice`, so web rendering and Postgres keep their cores. On staging: 1 cpu, with
  the memory the phase 1 measurement shows it needs (1 GB if it fits); slower is
  fine within the job deadline (section 3.5).
- Disk: a scratch of 2 GB (one 100 MB original, outputs, frames) on a **disk
  volume, not `tmpfs`**: `tmpfs` pages count against the container's memory limit,
  so a 2 GB `tmpfs` under a 1.5 GB limit can never be used in full and an encode
  can be killed for memory. (PR #70 mounts a 2 GB `tmpfs`; it must change, or
  raise `mem_limit` to cover it.) ffmpeg works on files on disk. **The existing
  `ObjectStore.read` loads whole files into memory and cannot be used for 100 MB
  originals**: add `download(key, path)` and `upload(key, path)` that stream, and
  a server-side `copy` for quarantine.
- Above roughly 1,000 videos a month, re-measure; at 10,000 move the worker to its
  own small server (the queue already allows it; ADR 0017 did the same for LiveKit).

Container: a new `video-worker` target in the `Dockerfile` (Debian bookworm-slim
plus the `ffmpeg` package; not added to the API image), same queue library, a new
`video` queue so a slow encode cannot block image jobs or purges. Security:
ffmpeg parses untrusted files, so non-root user, read-only root filesystem,
`-protocol_whitelist file,pipe`, a 5 minute limit per ffmpeg run and 8 minutes per
job, and a pinned version updated with security releases. Network: a private
network holding only the worker, Postgres (it writes the `media` and video rows)
and Redis; outbound HTTPS to R2 and to PhotoDNA (every frame batch); SMTP for
safety alerts. Nothing else: not Kratos, the API or the web app. An egress firewall
that also blocked PhotoDNA or SMTP would fail every video closed and silence match
alerts, so phase 4's review must keep those three open. Per-host egress filtering
is a firewall job; compose cannot do it.

### 3.5 Failure, retry, and keeping the original private

- **Order: probe, extract sample frames, scan, then transcode.** The scan is cheap
  and a scanner outage should not waste an encode. Nothing is written to the public
  bucket until the scan has cleared and the encode has finished.
- **Bad file** (not a video, over limits, no decodable stream): permanent. Row
  `rejected` (with a `rejection_reason`), original deleted, BullMQ `UnrecoverableError` so it is not retried. The
  uploader sees "That video could not be used" and a reason class (too long, too
  short, too large, too big a picture, too high a frame rate, not a video: the six
  `rejection_reason` values, section 7).
- **ffmpeg runs past its time limit:** usually the file, but it can be the host:
  the worker is niced and shares cores with web rendering and Postgres (and, on
  staging, with another project on the same server). So a timeout is retried once, with the
  queue's backoff; a second timeout is permanent: the row becomes `failed`
  (`failure_reason` set, original deleted) and the queue is told not to retry
  (`UnrecoverableError`).
- **Scanner cannot answer, storage or Redis errors, ffmpeg exits with an error:** the job throws and
  BullMQ retries (3 attempts, exponential from 30 s). After that the row is
  `failed` with `failure_reason`, an error-level log line, and the member can try again.
  Fail closed: no clear verdict means no publication.
- **Idempotent:** keys are fixed per media ID (`videos/<id>/360.mp4`), reruns
  overwrite, `ready` is set last in a conditional update (as `processPostImage`
  does), and a job that finds the row no longer `processing` deletes any files it wrote.
- **The original never reaches the public bucket.** It lives in `uploads/videos/<id>`
  (private, signed access only) and is deleted when the row turns `ready`, `failed` or `rejected`.
  A match moves it to `quarantine/originals/videos/<id>` by server-side copy, and
  so does a video no scanner cleared (`NoScanner`, so only outside production:
  section 4.7), which is held `quarantined`. A matched original is evidence and is
  never swept. A held one is not known to be anything: in production it waits for
  a scanner, and outside production the hourly sweep deletes it, with its row,
  after 7 days.
  Public objects are only the renditions and poster the worker made.

## 4. Safety (the hard part)

### 4.1 Scanning before publication

`ContentScanner.scan(image: Buffer)` takes one file. Add
`scanFrames(frames: Buffer[])` to the interface, implemented by `PhotoDnaScanner`
(each frame through the same `matches()` call; same JPEG size rules: at least
160 px short side, at most 2048 px long side) and by `NoScanner`, which answers
`unscanned`, never `clear`, so with no scanner a video is held, not published. The
worker, not the scanner, extracts frames with ffmpeg from the **original** (not
from our re-encode, which could blur a match away).

Sampling (recommended): **one frame per second (the first is at 0 s), plus the
last frame, plus the poster frame, plus scene-change frames (up to 20) in whatever
room is left, never more than 80 in all**. Any `match` on any frame blocks the
whole video. The poster frame is taken **before** the scan and sent with the rest,
and the published `poster.webp` is made from that same frame, so no image readers
see is unscanned. (A one-a-second sample near 1 s is not enough: it comes from a
different decode and need not be the same frame. PR #70 takes the poster after
the scan and never scans it; it must change.)

**Honest limits.**

- Sampling is weaker than hashing every frame. Abuse material shown for less than
  a second between samples could be missed. Microsoft has a separate PhotoDNA for
  Video product; the Cloud Service page we read mentions only images
  (**unverified** whether it covers or permits frame-by-frame video use). The
  existing GIF path already samples frames, so this is the same risk class, larger.
  Ask Microsoft in the application thread; the answer is a launch-gate item.
- Up to 80 calls per video against PhotoDNA's rate limit: the limit is **not
  published** in what we read; the existing doc already says to check it after approval.
  Frames are sent two at a time, and a 429 counts as "cannot answer" (retry).
- **Audio is ignored in v1.** Audio can carry abusive content that no hash list
  here catches. Mitigations: member reports, the same takedown path, and the
  quota and trust limits below. Say so in the rules and the moderator guide.
- Cloudflare's tool is a second layer for images; for video it is **unverified**,
  so treat video as having one automated layer, not two.

### 4.2 What is stored for reporting

Same posture as images: on a match, keep the original privately in
`quarantine/originals/videos/<id>`, nothing public, row `blocked`, an "Illegal
content" report naming the media ID, an email alert (`SAFETY_ALERT_EMAIL`), the
uploader told only that the video cannot be used. Additions for video, all
additive columns on a new table (section 7): the SHA-256 of the original, the
timestamp (`match_frame_ms`) of the first matching frame, and the number of frames scanned.
Still **no IP addresses** (we do not store them; the existing doc says Kratos
session data may help law enforcement). The matching frame itself is not stored
separately: it can be re-extracted from the preserved original by authorised people.

**What counsel must confirm (not decided here):** whether and to whom we must
report (Nigeria Police cybercrime unit, NCMEC's CyberTipline, an INHOPE hotline, or
several: question 1 already sent on 26 October 2026) and in what format for video;
how long to keep a quarantined video and how it must be stored (a video is a much
larger evidence object than an image); whether we may keep the SHA-256 and
timestamps; whether preservation requires anything formal; whether staff viewing a
video to decide a report is permitted and under what rules; and what the privacy
policy says about frame sampling.

### 4.3 Takedown and quarantine

The states: `ready`, `quarantined` (moderator removal, an `illegal` report waiting
for review, or no scanner cleared it), `blocked` (scanner), `deleted`, `failed`
(retries used up, or a second ffmpeg timeout), and, for videos only, `uploading`
and `rejected` (section 7). Removal moves the video's MP4s (one to three, section
3.1) and the poster to
`quarantine/` **by server-side copy then delete** (the image code reads and
re-writes whole buffers; that does not work for video), and queues a CDN purge
for every file (two to four keys per video, from `video_renditions`, under both
the media host and `SITE_URL` paths as the images runbook says). Release reverses it. An author deleting a post
with an open report quarantines instead of deleting, as for images. The hourly
sweep also re-quarantines a video whose post was removed but whose files are still
public. R2 copy between buckets is **unverified** against R2; the phase 1 tests
cover it, and the lifecycle rule stays off `quarantine/`.

### 4.4 Member reporting

A video is part of a post, so "report post" is the report. The reason list is
unchanged. A report with reason `illegal` on a post with a video also **hides the
video from all readers at once (quarantine, pending review)**; this differs from
images and is deliberate: video is costlier to leave up and to review. (Open
question 6.)

Hiding on one report makes `illegal` a takedown button anyone can press, so it
comes with these rules:

- **Who can hide.** Only a reporter who meets the same trust rule as uploaders
  (account at least 7 days old, nothing upheld against them in 90 days) hides a
  video at once, and only for their first 3 `illegal` reports a day. Anyone else's
  `illegal` report goes to the queue like any other and hides nothing.
- **Who decides.** Not an ordinary moderator. An `illegal` report on a video goes
  to the named safety reviewer (open question 3's role, or people they train),
  who decides under the runbook's viewing rules (section 4.2: counsel confirms
  whether and how staff may view). The video stays hidden until then.
- **What a decision does.** Upheld: removed, and it counts against the uploader
  (the 90-day trust rule, section 4.7). Dismissed: released at once if nothing
  else keeps it down, and it counts against **nobody but the reporter**; a reporter
  with 2 dismissed `illegal` reports in 90 days loses the power to hide.
- A hide that is never decided is not a removal: it does not count against the
  uploader.

### 4.5 Moderator tooling

- The queue shows a video card: duration, size, uploader, scanner result, report
  reasons, **no autoplay and no preview for `illegal` reports**. Ordinary
  moderators do not decide those: the card says it is waiting for the safety
  reviewer (section 4.4). Nobody removes a video on its metadata alone.
- For other reasons (spam, harassment, graphic), the poster is behind a "Show"
  click, then play is a second click, in a plain player with no download.
- Actions: remove (quarantine), restore (release), suspend account, as today.
  Every view of a quarantined or reported video logs moderator ID and time.
- Moderators get one new filter: reported videos.

### 4.6 Minors

All accounts are 18 or over today, so no age gate on video is needed at launch. But
before under-18 accounts open (`under-18-rollout.md`): **minors cannot post video
(default deny), and adult-restricted content stays hidden from them**; this ADR does
not create video-specific age rules beyond that. Video that depicts children is not
detected by hash lists unless already known; reports are the net. The scan does not
change under 18 rules. Video does not need ADR 0018's age verification.

ADR 0020 (proposed) adds an 18+ label for a post and everything on it, video
included, in its phase 1, with adults still the only members. That changes
serving, not this section's rules: a labelled video's renditions and poster live in
the private bucket and are served by signed URL (section 3.3), and adding the label
moves the files and purges the CDN through the takedown path above (section 4.3).

### 4.7 Quotas, trust and the launch gate

Per member (all constants, tuned after launch): new video uploads 3 an hour and 10
a day; accounts **at least 7 days old** and with no upheld moderation action in the
last 90 days; at most 50 live videos. First weeks: an **allow-list** of members
through the feature-flag system, then everyone eligible.

**The gate is enforced in code, not just by the flag.** `docs/feature-flags.md`
says switches that guard against work not yet allowed are deliberately not flags,
because an admin can flip a flag in the database. Video upload is that kind of
work. So:

> `videoPosts` is effective only when the flag is on **and** (the bound scanner is
> not `NoScanner` **or** `APP_ENV` is not `production`).

In production with `NoScanner`, the routes that create video answer 404 and
`/v1/me` reports `features.videoPosts: false` even if an admin turns the flag on. A
test pins this.

**Staging is not a place for strangers' video.** It is on the internet, and the
rule above lets it take uploads with `NoScanner`, each held unscanned. So
`videoPosts` is the one flag whose staging default is **off**
(`development: true, staging: false, production: false`), an exception to the
registry's "staging has everything on" policy, stated next to the entry; the team
turns it on for itself on staging with an allow-list. Held originals outside
production are swept after 7 days (section 3.5). To exercise publishing end to end
in development or staging, point the PhotoDNA settings at a stand-in Match
endpoint (`docs/safety/video-scanning.md`), never with real material.

**Launch gate, all required before the flag is turned on in production:**

1. `upload-scanning` is un-blocked: PhotoDNA key set in production and shown to work
   on staging (an ordinary video publishes; a stand-in match is blocked); the
   roadmap entry's status changed.
2. Microsoft's written answer that frame-by-frame video use is within its terms.
3. Cloudflare's written answer on video via R2 and the custom domain (section 3.3);
   CSAM Scanning Tool confirmed on that hostname.
4. The web app serves every video's renditions and poster from the media domain,
   not `/media` on the site (section 3.3), shown on staging; and, if ADR 0020's
   labels exist by then, 18+ video from the private bucket by signed URL.
5. Every item in the checklist in `docs/safety/abuse-material-scanning.md` is
   ticked, including "API error alerts reach a person" and counsel's answers
   (extended with section 4.2's video questions), and the privacy policy covers
   scanning, quarantine and retention of video. Its line that `/media` must stay
   on the proxied hostname covers images; for video, items 3 and 4 take its place,
   and the checklist gains a line saying so when phase 2 lands.
6. Phase 4 drills passed on staging: quarantine, release, purge and a scanner
   outage, using stand-ins, never real material.
7. **A named person signs off** in writing (the PR that turns the flag on, linking
   the evidence), and the flip is audited in `feature_flag_changes`.

## 5. Playback

### 5.1 Behaviour

- A player is a `<video>` with the browser's own controls, `preload="none"`, a
  poster, `playsinline`, and **no `loop`**. It reserves its box from the stored
  width and height, so the page does not jump.
- **Tap to play. No autoplay in v1.** Never autoplay with sound, ever.
- **Muted autoplay (phase 3, a separate "Autoplay videos" setting, default off)** only
  when all hold: the setting is on, the low-data mode is not "saver", the browser
  has not asked for less motion, and the clip is visible. Network-Information-API
  checks are Chromium-only and **unverified** as a signal, so not relied on.
- Only one video plays at a time; starting one pauses the other; leaving the page
  or scrolling it fully out of view pauses it.
- **Reduced motion:** no autoplay, poster only, no `loop`. Play is the member's act,
  so it is allowed.
- **Keyboard and seek:** native controls give Space to play, arrow keys to seek and
  Tab focus in the browsers we target (**unverified per browser**; checked in the
  phase 2 e2e). No custom controls in v1 to avoid breaking this.
- **320px:** the player is full width of the card, controls at least 44 px, the
  poster is `object-fit: contain`, with a "Play video, 0:32" label, never icon-only.
- **Quotes, reposts and feed cards of a quoted post show the poster with a play
  badge and do not play**, as GIFs show their still there.

### 5.2 Data setting and quality

The low-data work (merged, PR #49; `apps/web/lib/low-data.ts`: `DATA_MODES` `auto` |
`saver` | `full`, the `hn_data` cookie, `dataSaver()`) already holds images back as
a "Tap to load" placeholder (`media-held`). Video follows it:

| Mode | Before tap | Rendition on play |
|---|---|---|
| `saver` (or `auto` with `Save-Data: on`) | No poster fetched. Placeholder: "Tap to load video, 0:32, about 1.3 MB" (size from the bytes of the rendition it would play) | 240 |
| `auto` otherwise | Poster (about 20 KB), tap to play | 360 |
| `full` | Poster, tap to play | 480 |

A video has only the renditions its size allows (section 3.1). When the one the
mode wants is missing, play the largest one below it, or, when there is none
below, the smallest there is: a 360p clip in `full` mode plays 360, and a clip
whose only file is `200.mp4` plays that in every mode.

Phase 3 adds a "Quality" button for the current video (lower or higher) that
re-requests another rendition at the current time. The player never switches
rendition by itself mid-play in v1.

### 5.3 Captions and accessibility

**v1 has no captions.** That means members who are deaf or hard of hearing, or who
watch with sound off in public, get no text for speech in a video; WCAG 2.2
success criterion 1.2.2 (captions for prerecorded video with audio, Level A) is
**not met for member-posted video** (**cited from memory, not re-read this session**).
We say so in the accessibility statement and do not claim otherwise.

Plan: (1) **phase 2: an optional "Describe this video" text field** (like image
alt text, shown under the player and used by screen readers as the player's label),
with a nudge to describe speech if it matters; (2) **after launch: authors can
upload a WebVTT caption file**, validated and stored beside the renditions;
(3) **later, only if governance accepts it:** server transcription, which processes
audio (cost, privacy, a form of recording: the same questions as ADR 0017's captions
item). Decide (3) separately.

### 5.4 Link sharing and embeds

Post permalinks only. The Open Graph image is the poster; no `og:video`, no embed
iframe, no oEmbed in v1. The link-preview fetcher never fetches videos (it ignores
non-HTML; it keeps ignoring them). No video downloads from our UI.

## 6. Data and bandwidth cost model

Assumptions (mine; **not measured**; change them and the table moves):

- Average clip 30 s (half the 60 s limit). Ladder 1.3 + 2.3 + 3.6 = **7.2 MB** per
  video, plus a 20 KB poster. Original deleted after processing.
- **100 plays per video** (community-sized audience; a hit will exceed it). Rendition
  mix 30 percent 240, 60 percent 360, 10 percent 480 gives about **2.1 MB per play**
  at full watch (no credit for partial watches, so these are ceilings).
- Month 12 of a steady rate, nothing ever deleted (storage is cumulative).

| Videos a month | 100 | 1,000 | 10,000 |
|---|---|---|---|
| Stored added per month | 0.72 GB | 7.2 GB | 72 GB |
| Stored at month 12 | 8.6 GB | 86 GB | 864 GB |
| Delivered per month | 21 GB | 210 GB | 2.1 TB |
| Self-hosted on R2: storage at month 12 | $0 (free 10 GB) | about $1.1 | about $12.8 |
| R2 egress | $0 | $0 | $0 |
| R2 operations | free tier | free tier | under $2 even uncached |
| **Self-hosted total** | **$0** | **about $1** | **about $13** |
| Stream: stored minutes at month 12 (0.5 min per video) | 600 | 6,000 | 60,000 |
| Stream: delivered minutes per month (50 per video) | 5,000 | 50,000 | 500,000 |
| **Stream total** ($5 per 1,000 stored, $1 per 1,000 delivered) | **$10** | **$80** | **$800** |
| **Mux total** (list: $0.003 per stored min, $0.001 per delivered min after 100,000 free) | **about $2** | **about $18** | **about $580** |

Prices (retrieved 31 October 2026): R2 Standard storage $0.015 per GB-month, Class A
$4.50 and Class B $0.36 per million, **egress free**, free tier 10 GB, 1 million A,
10 million B. Stream: $5 per month per 1,000 minutes stored (prepaid), $1 per 1,000
minutes delivered, encoding and ingress free. Mux page: 1080p storage $0.003 per
minute per month, delivery $0.001 per minute after 100,000 free a month, on-demand
encoding free; **rates for lower resolutions are not stated on the page**, so the
Mux row uses the 1080p list rate as a ceiling, and committed pricing is lower.

Not costed: server compute (our existing server, no marginal bill until section 3.4's
thresholds), netcup traffic (video does not pass through it once it is served from
the media domain, launch-gate item 4), 18+ video served by signed URL (ADR 0020:
not edge-cached, so every play is R2 Class B reads, one per range request; still
cents at these volumes), and **the
member's own data cost** (Nigerian mobile data prices **not checked**). Per play the
member pays about 2 MB, roughly 100 times a feed image; that is the reason for
section 5.2. R2 "egress free" is a price, not a licence to serve video through the
proxied CDN: section 3.3 is the real constraint.

## 7. Schema, API, flag, limits, retention

**Schema (additive; `scripts/migrations.mjs` rules).** `media.kind` and `media.status`
are TypeScript enums over `text`, so `post_video` needs no DDL. New columns on an
existing table must be nullable or defaulted and must not be `NOT NULL` without a
default; new indexes on `media` need a waiver. To avoid all of that, **only new
tables**, in one migration:

- `video_details` (migration `0035_video_posts.sql` in PR #70; PR #78 also claims
  `0035`, so whichever merges second renumbers): `media_id` uuid primary key,
  references `media` (on delete cascade); all nullable unless noted: `upload_id`
  text and `part_size` integer (the open multipart upload, so a reload can resume),
  `duration_ms` integer, `width` and `height` integer (the video's as shown, from
  the probe), `fps` real,
  `original_sha256` text, `frames_scanned` integer, `match_frame_ms` integer (the
  first matching frame), `scan_result` text, one of `clear`, `match`, `unscanned`
  (no scanner configured: the video stays quarantined), `poster_key` text,
  `rejection_reason` text, one of `too_long`, `too_short`, `too_large`,
  `too_big_picture`, `too_high_frame_rate`, `not_a_video` (a class the uploader
  may be told; a TypeScript enum, so the sixth needs no DDL),
  `failure_reason` text (for the log), and `attempts` integer not null default 0.
- `video_renditions`: `media_id` (references `media`, on delete cascade), `height`
  (the rendition's label, its short edge: 240, 360, 480, or the clip's own size
  below 240), `width`, `bytes`, `bitrate_kbps`, all integer not null; primary key
  `(media_id, height)`. One to three rows per video (section 3.1).

Two `media.status` values exist for videos only, added to the enum (still no DDL):
`uploading`, the video's `pending` (a multipart upload is open; see `upload_id`),
and `rejected`, a permanent refusal of the file (too long, too short, too large,
too big a picture, too high a frame rate, not a video; see `rejection_reason`).
`failed` is kept for a job whose retries are used up or whose ffmpeg run timed out
twice (`video-processor.ts`). A video no scanner has cleared stays `quarantined`;
it is never made `ready` by default.

One video per post, and no images beside it, is checked in the API when attaching
(in the same transaction that locks the post), not by an index on `media`. Nothing
is dropped or renamed; the old release ignores the new tables on rollback.

**API.** Under the `videoPosts` guard (the flag plus the scanner rule), only what
creates video: `POST /v1/me/videos/upload`; `GET /v1/me/videos/:id/upload`
(resume); `POST /v1/me/videos/:id/complete`; and post create with a `videoId`
(one). Outside the guard, for the uploader only (signed in, their own video,
404 otherwise): `GET /v1/me/videos/:id` (status) and `DELETE /v1/me/videos/:id`
(unattached only). "Gate creation, not existing data" (`docs/feature-flags.md`):
when the flag goes off, or an allow-list drops a member, mid-upload, the composer
still learns what happened and the member can still drop their video, and an
unfinished upload is aborted by the sweep. In production with no scanner those two
routes have nothing to find. Post payloads carry `{id, durationMs, width, height,
posterUrl, renditions: [{height, url, bytes}], description}` for readers.
Moderation adds a reported-videos filter.

**Flag:** `videoPosts` in `apps/api/src/flags/registry.ts` (merged, PR #53):
development `true`, **staging `false`** (an allow-list for the team; section 4.7),
**production `false`** because the code is not in `main`;
`LIVE_IN_MAIN.videoPosts = false`. "Gate creation, not existing data": turning it
off stops new uploads and leaves published videos playing.

**Rate limits (`apps/api/src/rate-limit.ts`):** `videoUpload` 3 an hour and 10 a day;
`videoPart` (resume, part URLs and `complete`) 120 a minute; `videoStatus` (polls)
60 a minute, a budget of its own: a job can run for minutes, and sharing
`postImage` (12 a minute, 60 an hour) would cut polling off mid-job and spend the
member's image uploads. Quotas as in section 4.7.

**Retention.** Published renditions live until the post is deleted (or quarantined
if reported). Originals are deleted on `ready`, `failed` or `rejected`. A held
original (no scanner cleared it) is deleted after 7 days outside production
(section 3.5). Quarantined video is
kept until counsel says how long and who may access it (section 4.2). **Account
deletion and export (merged, PR #59; [ADR 0016](0016-account-deletion.md)).** Video
is added to its inventory (rows for videos and for the media bucket, and step 5,
storage), and `VideoService.eraseFilesOf(ownerId)` runs right after the image
erase:

- Every video of theirs that the erase transaction marked deleted, in any state
  but `blocked` (`uploading`, `processing`, `ready`, `quarantined`,
  `rejected`, `failed`; the erase SQL also takes a `pending` row, which videos do not use), on a post that is not evidence: an open multipart upload is aborted
  (`AbortMultipartUpload`, using the upload ID in `video_details`); the original
  (`uploads` bucket, `videos/<id>`), the public renditions
  (`videos/<id>/<label>.mp4`, one per `video_renditions` row) and poster
  (`videos/<id>/poster.webp`), and any
  copies under `quarantine/` are removed; a CDN purge is queued for the public
  keys; then their `video_renditions` and `video_details` rows (scan result,
  original SHA-256, failure reason) are deleted. The `media` row stays, as for
  images. A failed abort fails the erase while the row still holds the upload ID,
  so the retry can abort it; the rows go last, so a retry finds the same keys.
- A `ready` video on a post kept as report evidence is not deleted: its files are
  copied to the private bucket (`quarantine/videos/<id>/…`), removed from the
  public bucket, the CDN purged, and the row set to `quarantined`. Its
  `video_details` stay with it.
- `blocked` videos (a scanner match) and the original kept at
  `quarantine/originals/videos/<id>` stay as they are: evidence, never swept.
- **Export** (format `heynaija-export/12` in PR #70; PR #78's `/13` assumes this
  merges first): each post carries `videos: [{url,
  poster}]`, the video path and `/poster.webp` under it, only for the member's own
  videos that are `ready` and on a post, as for images. The export links to
  files; it does not embed them.

This is implemented in PR #70 (`feat/video-phase1`; `video.service.ts`,
`export.service.ts`, `account-deletion.service.ts`), not yet merged, and its tests
are the check that these rules hold.

**Where PR #70 differs from this ADR**, the ADR is the design, and PR #70 changes
before it merges:

- the poster frame is taken before the scan and scanned (section 4.1);
- above 60 fps is refused as `too_high_frame_rate`, not `too_long` (section 1);
- the worker's scratch is a disk volume, or `mem_limit` covers the `tmpfs`
  (section 3.4);
- an ffmpeg timeout is retried once before it is permanent (section 3.5);
- status and `DELETE` sit outside `VideoPostsGuard`; `complete` uses `videoPart`
  and status gets `videoStatus` (this section);
- `videoPosts` is off by default on staging, and held originals are swept after 7
  days outside production (sections 3.5 and 4.7);
- an `illegal` report hides only for trusted reporters within their daily cap, and
  waits for the safety reviewer (section 4.4).

Serving from the media domain, and signed URLs for 18+ video, are phase 2 work and
launch-gate items, not PR #70's.

## 8. Phased delivery (each shippable dark, behind the flag and the scanner rule)

Owner-sized days, not dates; one person; include tests.

| Phase | What | Days |
|---|---|---|
| 1 | Flag and scanner rule, migration, streaming/copy/multipart in `ObjectStore`, `video-worker` image and compose, ffprobe, frame sampling, scan, ladder, poster, quarantine and purge, sweeper, tests against stand-ins; **spikes: R2 presigned `UploadPart`, R2 copy, range serving, encode timings.** No UI planned (PR #70 also carries phase 2's composer upload and player) | 11 |
| 2 | Composer upload with resume, status and draft, player, 320px layout, description field, quotes show poster, e2e (`newMember`, never the sign-up pages) | 9 |
| 3 | Low-data integration (held placeholder, rendition choice, quality button, optional muted autoplay setting), moderator queue tooling, reporting and logs; builds on the merged low-data work (PR #49) | 6 |
| 4 | Load test (`docs/loadtest.md` style) of upload and worker on a production-sized box, security review of the ffmpeg container, drills (section 4.7 item 6), docs and runbook updates | 5 |

About 31 days, say 37 with the usual surprises. The launch gate is separate from
the phases: the code can be finished and idle for weeks.

## Options considered (summary)

- **A. Do not build video.** Cheapest, safest; closes off a common expectation.
- **B. Self-hosted worker, R2 delivery (recommended).** Section 3.
- **C. Cloudflare Stream.** Least work, about $800 a month at 10,000; the named fallback.
- **D. Mux.** Cheaper than Stream at volume, a new processor; not recommended.
- **E. Link out or embed other sites' video.** No hosting cost but no safety control
  and weaker privacy; excluded from v1.

## Consequences

- We take on running ffmpeg on untrusted input, a new container, and new
  multipart-upload code; in return video costs about $13 a month at 10,000 clips.
- v1 is deliberately weaker than it looks in two places: frame sampling is not
  full-frame hashing, and audio is not scanned. Both are in the rules and the
  moderator guide.
- v1 has no captions. We say so, and ship a description field first.
- Video is gated twice: by a flag, and by a code rule that no admin can flip. On
  staging the flag is off by default too, since staging is public and has no scanner.
- The data setting becomes a feature of video, not decoration; the player builds on
  the merged low-data work (PR #49).
- Delivery depends on Cloudflare's confirmation. If it comes back "no", cost
  becomes Stream's.

## Open questions

1. **Original retention.** Delete the original once the renditions are ready?
   Recommend yes (privacy and cost); keep only blocked ones. *Answer:*
2. **Limits.** 60 seconds, 100 MB, 1080p, one video per post, no images beside it?
   Recommend yes; reduce to 30 s if moderation capacity is thin. *Answer:*
3. **Who signs off the launch gate, and who reviews `illegal` reports on videos
   (section 4.4)?** Recommend a named safety owner for both, not the author of the
   code; they may train others to review. *Answer:*
4. **Self-host or Stream.** Confirm self-hosting, with Stream as the fallback if
   Cloudflare's written answer is no. *Answer:*
5. **Who may post video first?** Recommend an allow-list, then accounts at least 7
   days old with no upheld action in 90 days. *Answer:*
6. **Does an `illegal` report hide the video at once?** Recommend yes, unlike images,
   but only with section 4.4's limits: trusted reporters, 3 a day, a decision by the
   safety reviewer, and a dismissed report costing the uploader nothing. The cost is
   that a hidden video waits for one person, and false reports from a trusted
   account can still hide a video for that long. *Answer:*
7. **Replies with video.** Recommend not at launch. *Answer:*
8. **Autoplay.** Recommend none in v1; a default-off muted-autoplay setting in phase 3.
   *Answer:*
9. **Description field.** Optional with a nudge in v1; required later? Recommend
   optional. *Answer:*
10. **Ask Microsoft about video** in the same thread as the PhotoDNA application,
    and ask Cloudflare in writing (section 3.3) now, since both answers gate
    everything. Recommend yes, this week. *Answer:*
11. **Roadmap.** The `video` entry gains this ADR as evidence and `low-data-controls`
    as a dependency (done with this PR). *Answer:*

## Could not verify

R2 accepting presigned `UploadPart`; R2 cross-bucket copy; range requests and large
MP4 caching on an R2 custom domain; whether PhotoDNA Cloud Service covers or
permits video frames and its rate limit; whether Cloudflare's CSAM tool scans
video; Stream's and Mux's own safety tooling; Cloudflare Lagos presence and Nigerian
latency; encode time and memory on our hardware; WCAG wording (from memory);
NCMEC or Nigerian reporting duties for video; Nigerian data prices; netcup and
Contabo traffic terms; browser keyboard behaviour in native video controls.

## Sources (retrieved 31 October 2026)

- Cloudflare Service-Specific Terms (CDN video clause): https://www.cloudflare.com/service-specific-terms-application-services/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 multipart limits and 7-day abort: https://developers.cloudflare.com/r2/objects/multipart-objects/
- R2 presigned URLs (no `UploadPart` mentioned; custom domains unsupported for signing): https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare Stream pricing: https://developers.cloudflare.com/stream/pricing/
- Cloudflare Stream FAQ (30 GB limit; no mention of scanning): https://developers.cloudflare.com/stream/faq/
- Cloudflare CSAM Scanning Tool (images named; video not stated): https://developers.cloudflare.com/cache/reference/csam-scanning/
- Mux pricing: https://www.mux.com/pricing
- Microsoft PhotoDNA Cloud Service (images only on the page): https://www.microsoft.com/en-us/photodna/cloudservice
- tus resumable upload protocol 1.0.0: https://tus.io/protocols/resumable-upload
- WCAG 2.2 (1.2.2 Captions, Prerecorded): https://www.w3.org/TR/WCAG22/ (not re-read; from memory)
- NCMEC CyberTipline FAQ: attempted, returned 404, not used.
- In-repo: `apps/api/src/media/*`, `docs/safety/abuse-material-scanning.md`,
  `docs/deployment/cloudflare-r2.md`, `docs/deployment/production.md`,
  `infra/deploy/nginx/heynaija.conf.template`, `scripts/migrations.mjs`,
  `apps/api/src/rate-limit.ts`, `docs/feature-roadmap.json`; merged:
  `apps/web/lib/low-data.ts` and `apps/web/app/ui/post-images.tsx` (PR #49),
  `docs/feature-flags.md` (PR #53), [ADR 0016](0016-account-deletion.md) (PR #59),
  [ADR 0018](0018-age-verification.md) (PR #61) and
  [ADR 0020](0020-under-18-accounts-and-adult-labels.md) (PR #77), both proposals;
  open: PR #70 (`feat/video-phase1`) for the erase and export details, and
  PR #78 for its migration and export numbers.
