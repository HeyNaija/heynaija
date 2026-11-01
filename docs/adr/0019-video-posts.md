# ADR 0019 — Video posts: short clips, uploaded from the device, scanned before anyone sees them

**Date:** 31 October 2026 · **Status:** Proposed, design only. Nothing is built:
no schema, no migration, no endpoint, no worker, no UI. · **Roadmap:** `video`
(depends on `upload-scanning`; this ADR adds `low-data-controls`) ·
**Related:** [ADR 0017](0017-calls-and-meetings.md) (cost-model style),
`docs/safety/abuse-material-scanning.md`, `docs/deployment/cloudflare-r2.md`,
[ADR 0006](0006-age-status-model.md), `docs/governance/under-18-rollout.md`.
Branches this builds on and does not assume are merged: `feat/low-data-controls`
(PR #49), `feat/db-feature-flags` (PR #53, `docs/feature-flags.md`), account
deletion (PR #59).

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
   written confirmation first; it is a launch-gate item.
4. **Play:** poster first, tap to play, no autoplay in v1, quality picked by the
   member's data setting. No captions in v1 (section 5.3 says what that costs).
5. **Safety:** frame sampling into the PhotoDNA path, fail closed, audio ignored
   in v1, quarantine and takedown like images, moderators never open a video
   reported as illegal.

**Launch gate (all required, section 4.7):** `upload-scanning` un-blocked and
PhotoDNA live in production; Microsoft's written answer that frame-by-frame
video use fits its terms; Cloudflare's written answer on video via R2; the
existing abuse-material checklist fully ticked; counsel's answers; phase 4 drills
passed; a named person signs off. Cost at 10,000 videos a month is about $13 a
month on R2 versus roughly $800 on Stream (section 6).

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
  account level.

## 1. Scope of v1

| | v1 |
|---|---|
| Source | Upload from the device only (a file input, so the phone's own camera works) |
| Per post | One video, **and no images or GIFs beside it** (simpler layout, one thing to scan and take down) |
| Duration | 3 to 60 seconds (recommended; a constant, `VIDEO_MAX_SECONDS`) |
| Size | 100 MB original (`VIDEO_MAX_BYTES`); a 60 s phone clip is about 75 to 125 MB, so most 1080p minute-long clips fit only just: the composer shows the size before upload |
| Resolution | Longest edge up to 1920 px, any frame rate (output is capped at 30 fps) |
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

Flow (state in a `media` row of kind `post_video`, status as today plus nothing new):

1. `POST /v1/me/videos/upload` with `{contentType, bytes, durationMs?}`: checks the
   flag, the gate, quotas and rate limits; creates the row; `CreateMultipartUpload`;
   returns `mediaId`, `partSize`, and signed part URLs (valid 30 minutes each, with
   `content-length` signed as images do).
2. The browser uploads two parts at a time, retries a failed part three times with
   backoff, and shows progress and "Resume".
3. After a reload or a lost tab: `GET /v1/me/videos/:id/upload` lists parts done
   (`ListParts`) and returns fresh URLs for the rest, until the upload window ends.
4. `POST /v1/me/videos/:id/complete` with the part ETags: the API completes the
   multipart upload, checks the size, sets `processing`, queues the job. The bucket
   CORS rule must add `ExposeHeaders: ["ETag"]` or the browser cannot read them.
5. The browser polls `GET /v1/me/videos/:id` (as for images) until `ready` or
   `failed`. Processing continues if the tab closes; the draft keeps the media ID.

**Client-side checks** are courtesy only: file type, size, and duration from the
element's metadata (it may fail for formats the browser cannot decode, such as
HEVC on some browsers; then upload anyway and let the server decide). No
client-side transcoding: too heavy for the phones we serve. The server probes
everything again.

**Abandoned uploads.** The existing hourly sweep marks `pending` uploads over an
hour old as deleted. A video gets **24 hours** (resume needs time), after which the
sweep calls `AbortMultipartUpload`, removes the object, and marks the row deleted.
Add `videos/` to the uploads bucket's lifecycle rules (1 day, like `avatars/` and
`posts/`), never `quarantine/`; the 7-day multipart abort is the backstop.
Unattached `ready` videos (never put on a post) are cleared after an hour, as
images are.

## 3. Processing

### 3.1 What it makes

For a landscape or portrait clip, with the **short edge** at 240, 360 and 480 px
(so a 1080x1920 phone clip does not become a 1920-pixel-wide file):

| Rendition | Video | Audio | About, 30 s |
|---|---|---|---|
| 240 | 300 kbps | 48 kbps AAC | 1.3 MB |
| 360 | 550 kbps | 64 kbps AAC | 2.3 MB |
| 480 | 900 kbps | 64 kbps AAC | 3.6 MB |

H.264 Main, `yuv420p`, 30 fps cap, `+faststart` (so playback starts before the
file is loaded), closed GOP of 2 s. Plus `poster.webp` at 640 px (a frame 1 s in,
or the middle for clips under 2 s) and `duration_ms`. The bitrates are
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
  to emit absolute media URLs for video and the CSP (`default-src 'self'` today,
  `apps/web/next.config.ts`) to allow that host in `media-src` and `img-src`.
- **Confirm in writing with Cloudflare before launch** that an R2 public bucket on
  a custom domain, serving this volume of video, is within the terms on our plan,
  and that the CSAM Scanning Tool and cache purge cover that hostname (the tool's
  docs name images; they do not say whether video is scanned: unverified).
- Whether R2 custom domains cache and range-serve large MP4s the way a player
  needs (`Accept-Ranges`) is **unverified**; phase 1 tests it.

### 3.4 Sizing on our servers

Estimates, **unverified until measured in phase 1** (acceptance: a 60 s 1080p30
phone clip finishes in under 90 s wall time at 2 cores, peak memory under 1.5 GB):

- One ffmpeg process: decode once, three encodes (`-preset veryfast`, `-threads 2`).
  Expect roughly 15 to 30 s for a 30 s clip.
- 10,000 videos a month is about 14 an hour on average; a 10x evening peak is 140
  an hour, roughly 2 cores busy. 1,000 a month is a rounding error.
- The worker is its own container with `cpus: 2`, `mem_limit: 1.5g`, **concurrency 1**,
  `nice`, so web rendering and Postgres keep their cores. On staging: 1 cpu, 1 GB;
  slower is fine.
- Disk: a `tmpfs`-or-volume scratch of 2 GB (one 100 MB original, outputs, frames).
  ffmpeg works on files on disk. **The existing `ObjectStore.read` loads whole files
  into memory and cannot be used for 100 MB originals**: add `download(key, path)`
  and `upload(key, path)` that stream, and a server-side `copy` for quarantine.
- Above roughly 1,000 videos a month, re-measure; at 10,000 move the worker to its
  own small server (the queue already allows it; ADR 0017 did the same for LiveKit).

Container: a new `video-worker` target in the `Dockerfile` (Debian bookworm-slim
plus the `ffmpeg` package; not added to the API image), same queue library, a new
`video` queue so a slow encode cannot block image jobs or purges. Security:
ffmpeg parses untrusted files, so non-root user, read-only root filesystem, no
network except R2 and Redis, `-protocol_whitelist file,pipe`, a 5 minute wall
timeout, and a pinned version updated with security releases. Phase 4 reviews it.

### 3.5 Failure, retry, and keeping the original private

- **Order: probe, extract sample frames, scan, then transcode.** The scan is cheap
  and a scanner outage should not waste an encode. Nothing is written to the public
  bucket until the scan has cleared and the encode has finished.
- **Bad file** (not a video, over limits, no decodable stream): permanent. Row
  `failed`, original deleted, BullMQ `UnrecoverableError` so it is not retried. The
  uploader sees "That video could not be used" and a reason class (too long, too
  large, not a video).
- **Scanner cannot answer, storage or Redis errors, ffmpeg killed:** the job throws and
  BullMQ retries (3 attempts, exponential from 30 s). After that the row is
  `failed` with `failure_reason`, an error-level log line, and the member can try again.
  Fail closed: no clear verdict means no publication.
- **Idempotent:** keys are fixed per media ID (`videos/<id>/360.mp4`), reruns
  overwrite, `ready` is set last in a conditional update (as `processPostImage`
  does), and a job that finds the row no longer `processing` deletes any files it wrote.
- **The original never reaches the public bucket.** It lives in `uploads/videos/<id>`
  (private, signed access only) and is deleted when the row turns `ready` or `failed`.
  A match moves it to `quarantine/originals/videos/<id>` by server-side copy.
  Public objects are only the renditions and poster the worker made.

## 4. Safety (the hard part)

### 4.1 Scanning before publication

`ContentScanner.scan(image: Buffer)` takes one file. Add
`scanFrames(frames: Buffer[])` to the interface, implemented by `PhotoDnaScanner`
(each frame through the same `matches()` call; same JPEG size rules: at least
160 px short side, at most 2048 px long side) and by `NoScanner`. The worker, not
the scanner, extracts frames with ffmpeg from the **original** (not from our
re-encode, which could blur a match away).

Sampling (recommended): **one frame per second, plus the first and last frame, plus
up to 20 extra frames at scene changes**, at most 80 frames for a 60 s clip. Any
`match` on any frame blocks the whole video. The poster is one of the scanned frames.

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
index and timestamp of the first matching frame, and the number of frames scanned.
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

Same states as images: `ready`, `quarantined` (moderator removal), `blocked`
(scanner), `deleted`, `failed`. Removal moves the three MP4s and the poster to
`quarantine/` **by server-side copy then delete** (the image code reads and
re-writes whole buffers; that does not work for video), and queues a CDN purge
for every file (four keys per video, under both the media host and `SITE_URL`
paths as the images runbook says). Release reverses it. An author deleting a post
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

### 4.5 Moderator tooling

- The queue shows a video card: duration, size, uploader, scanner result, report
  reasons, **no autoplay and no preview for `illegal` reports**. The runbook
  already says do not keep looking; for those reports the moderator acts on the
  metadata and removes, then follows the runbook.
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

In production with `NoScanner`, the upload routes answer 404 and `/v1/me` reports
`features.videoPosts: false` even if an admin turns the flag on. A test pins this.
Staging and development may run with the stand-in scanner so the pipeline can be
built and tested.

**Launch gate, all required before the flag is turned on in production:**

1. `upload-scanning` is un-blocked: PhotoDNA key set in production and shown to work
   on staging (an ordinary video publishes; a stand-in match is blocked); the
   roadmap entry's status changed.
2. Microsoft's written answer that frame-by-frame video use is within its terms.
3. Cloudflare's written answer on video via R2 and the custom domain (section 3.3);
   CSAM Scanning Tool confirmed on that hostname.
4. Every item in the checklist in `docs/safety/abuse-material-scanning.md` is
   ticked, including "API error alerts reach a person" and counsel's answers
   (extended with section 4.2's video questions), and the privacy policy covers
   scanning, quarantine and retention of video.
5. Phase 4 drills passed on staging: quarantine, release, purge and a scanner
   outage, using stand-ins, never real material.
6. **A named person signs off** in writing (the PR that turns the flag on, linking
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

The low-data work (PR #49; `apps/web/lib/low-data.ts`: `DATA_MODES` `auto` |
`saver` | `full`, the `hn_data` cookie, `dataSaver()`) already holds images back as
a "Tap to load" placeholder (`media-held`). Video follows it:

| Mode | Before tap | Rendition on play |
|---|---|---|
| `saver` (or `auto` with `Save-Data: on`) | No poster fetched. Placeholder: "Tap to load video, 0:32, about 1.3 MB" (size from the 240 rendition's bytes) | 240 |
| `auto` otherwise | Poster (about 20 KB), tap to play | 360 |
| `full` | Poster, tap to play | 480 |

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
thresholds), netcup traffic (video does not pass through it by design), and **the
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

- `video_details`: `media_id` uuid primary key references `media`, `duration_ms`
  integer, `width`, `height` (the poster's), `fps`, `original_sha256` text,
  `frames_scanned` integer, `match_frame_ms` integer null, `failure_reason` text
  null, `attempts` integer default 0.
- `video_renditions`: `media_id`, `height` integer, `width` integer, `bytes` integer,
  `bitrate_kbps` integer; primary key `(media_id, height)`.

One video per post, and no images beside it, is checked in the API when attaching
(in the same transaction that locks the post), not by an index on `media`. Nothing
is dropped or renamed; the old release ignores the new tables on rollback.

**API (all under the `videoPosts` guard, `@Feature('videoPosts')` plus the scanner
rule):** `POST /v1/me/videos/upload`; `GET /v1/me/videos/:id/upload` (resume);
`POST /v1/me/videos/:id/complete`; `GET /v1/me/videos/:id` (status);
`DELETE /v1/me/videos/:id` (unattached only). Post create accepts one `videoId`.
Post payloads carry `{id, durationMs, width, height, posterUrl, renditions: [{height,
url, bytes}], description}` for readers. Moderation adds a reported-videos filter.

**Flag:** `videoPosts` in `apps/api/src/flags/registry.ts` (PR #53): staging and
development `true`, **production `false`** because the code is not in `main`;
`LIVE_IN_MAIN.videoPosts = false`. "Gate creation, not existing data": turning it
off stops new uploads and leaves published videos playing.

**Rate limits (`apps/api/src/rate-limit.ts`):** `videoUpload` 3 an hour and 10 a day;
`videoPart` (resume and part URLs) 120 a minute; status polls share the `postImage`
style budget. Quotas as in section 4.7.

**Retention.** Published renditions live until the post is deleted (or quarantined
if reported). Originals are deleted on `ready` or `failed`. Quarantined video is
kept until counsel says how long and who may access it (section 4.2). **Account
deletion (PR #59):** it must include `post_video` media and `video_details` in what
it removes, and must not delete quarantined evidence. This ADR does not design
around that; it only needs the deletion code to treat video as media and keep the
quarantine prefix.

## 8. Phased delivery (each shippable dark, behind the flag and the scanner rule)

Owner-sized days, not dates; one person; include tests.

| Phase | What | Days |
|---|---|---|
| 1 | Flag and scanner rule, migration, streaming/copy/multipart in `ObjectStore`, `video-worker` image and compose, ffprobe, frame sampling, scan, ladder, poster, quarantine and purge, sweeper, tests against stand-ins; **spikes: R2 presigned `UploadPart`, R2 copy, range serving, encode timings.** No UI | 11 |
| 2 | Composer upload with resume, status and draft, player, 320px layout, description field, quotes show poster, e2e (`newMember`, never the sign-up pages) | 9 |
| 3 | Low-data integration (held placeholder, rendition choice, quality button, optional muted autoplay setting), moderator queue tooling, reporting and logs; needs PR #49 merged | 6 |
| 4 | Load test (`docs/loadtest.md` style) of upload and worker on a production-sized box, security review of the ffmpeg container, drills (section 4.7 item 5), docs and runbook updates | 5 |

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
- Video is gated twice: by a flag, and by a code rule that no admin can flip.
- The data setting becomes a feature of video, not decoration; the player depends
  on PR #49 landing before phase 3.
- Delivery depends on Cloudflare's confirmation. If it comes back "no", cost
  becomes Stream's.

## Open questions

1. **Original retention.** Delete the original once the renditions are ready?
   Recommend yes (privacy and cost); keep only blocked ones. *Answer:*
2. **Limits.** 60 seconds, 100 MB, 1080p, one video per post, no images beside it?
   Recommend yes; reduce to 30 s if moderation capacity is thin. *Answer:*
3. **Who signs off the launch gate?** Recommend a named safety owner, not the
   author of the code. *Answer:*
4. **Self-host or Stream.** Confirm self-hosting, with Stream as the fallback if
   Cloudflare's written answer is no. *Answer:*
5. **Who may post video first?** Recommend an allow-list, then accounts at least 7
   days old with no upheld action in 90 days. *Answer:*
6. **Does an `illegal` report hide the video at once?** Recommend yes, unlike images.
   *Answer:*
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
  `apps/api/src/rate-limit.ts`, `docs/feature-roadmap.json`; on branches:
  `apps/web/lib/low-data.ts` and `apps/web/app/ui/post-images.tsx` (`feat/low-data-controls`),
  `docs/feature-flags.md` (`feat/db-feature-flags`), ADR 0018 (`docs/age-verification`).
