# ADR 0021 — Video as HLS on R2: up to 3 minutes and 4K in, 240p to 720p out, posted before it is ready

**Date:** 4 November 2026 · **Status:** Proposed. The six decisions in section 1
were agreed by the owner on 4 November 2026; the rest is the design that follows
from them. Nothing is built except the HLS command and the trial tool
(`apps/api/src/video/hls.ts`, `apps/api/src/cli/video-trial.ts`, PR #85, not yet
merged). · **Supersedes:** in [ADR 0019](0019-video-posts.md), the limits in
section 1, sections 3.1 (what the worker makes), 3.3's conclusion on serving,
3.4 (sizing), 5.2's rendition table, 6 (cost) and launch-gate items 1 to 4. The
upload path, failure handling, safety, moderation, captions, retention and the
code rule that keeps video off in production without a scanner all stand. ·
**Roadmap:** `video` · **Related:** `docs/video-trial.md`,
`docs/safety/video-scanning.md`, `docs/deployment/cloudflare-r2.md`,
[ADR 0020](0020-under-18-accounts-and-adult-labels.md) (18+ labels).

Measured numbers come from the trial of 4 November 2026: eight clips from the
team's phones on a rented Hetzner CCX33 (8 dedicated vCPUs), in the
`video-worker` image with its 1.5 GB limit. Anything marked **(unverified)** was not
measured or read from a primary source. Prices change.

## Decision

Members can attach **one video of up to 3 minutes and 1 GB, recorded at up to 4K
and 60 fps**, to a post. The worker checks the whole original with Arachnid
Shield, then encodes it **once, in one ffmpeg run, into HLS**: 4-second pieces at
240p, 360p, 480p and 720p, at most 30 fps, with HDR tone-mapped to ordinary colour.
R2 stores the pieces and Cloudflare's CDN delivers them from the media domain, so
watching costs us nothing per view. **The member previews the clip from their own
device and posts without waiting for processing**: the post is hidden, marked
"Processing" for its author, and appears by itself when the video is ready.

1. **Accept** H.264, HEVC or VP9, up to 3840 pixels on the long side, up to 60 fps,
   3 seconds to 3 minutes, 1 GB on the website (section 2).
2. **Make** HLS in fMP4 pieces with a master playlist, plus the poster (section 3).
3. **Store and serve** each video as one folder, `videos/<id>/`, in the public
   media bucket, from the media domain with a Cache Rule; a takedown moves the
   folder and purges it by prefix (section 4).
4. **Encode** on a server of the worker's own, 4 cores for the pilot (a netcup
   RS 1000) and 8 as it grows: measured on the RS 1000, a 3-minute clip is ready
   in about 50 seconds (1080p H.264) to 5 or 6 minutes (4K 60 fps HDR) (section 5).
5. **Preview, then post before ready**: the composer plays the member's own file
   at once; Post can be pressed straight away and goes when the upload completes;
   no wait for processing (section 6).
6. **Play** with the browser's own HLS on iPhones and hls.js elsewhere, starting
   low and stepping up, capped by the member's data setting (section 7).

Cost: about €22 a month for the pilot on one 4-core server, €33 at 10,000 minutes
uploaded a month on the same server, and €220 at 100,000 on two 8-core servers;
Cloudflare Stream would be $25, $1,150 and $21,500 for the same use (section 8).
Video stays off in production until the launch gate (section 11) is met, and on
staging it stays on for allow-listed testers only.

## Context

- Phase 1 (PR #70, merged) works end to end on staging and is not good enough:
  60 seconds at most, 100 MB, 1080p, three MP4 files at 240p to 480p. Most phones
  record 4K by default, and phase 1 refuses it as too big a picture. The member
  waits twice, for the upload and then for processing, before they can post.
  After trying it on staging, the owner paused video until there was a better plan.
- Arachnid Shield has been bound since PR #82. It is sent the whole original and
  matches every frame itself, so the 78-second ceiling on `VIDEO_MAX_SECONDS`,
  which exists because PhotoDNA is sent at most 80 sampled frames
  (`MAX_SAMPLE_FRAMES` in `ffmpeg.ts`), no longer has to bind.
- ADR 0019 section 3.3 kept video off the proxied CDN because of Cloudflare's
  terms and asked for Cloudflare's written answer. Cloudflare's updated terms
  (Sources) allow video stored in R2 to be served through the CDN; the clause
  restricts video hosted elsewhere. Our media domain is an R2 custom domain, so
  serving from it is within the terms. (My reading, not legal advice.)
- HLS was rejected in ADR 0019 section 3.1 for clips of 60 seconds or less, and
  revisited "if clips grow past a few minutes". At 3 minutes and 4K originals it
  pays for itself: a member who watches 10 seconds fetches three small pieces, not
  the head of a whole MP4, and the player chooses a quality the connection can
  carry instead of one fixed by a setting.
- Native apps start after this phase. They use the same upload API and play HLS
  with the platforms' own players.

## 1. The six decisions (agreed 4 November 2026)

| Decision | Agreed | Instead of (ADR 0019) |
|---|---|---|
| Length | 3 minutes | 60 seconds, at most 78 |
| What we accept | Up to 4K and 60 fps, in H.264, HEVC or VP9 | Longest edge 1920 |
| File size | 1 GB on the website; the native apps shrink clips before sending | 100 MB |
| What we serve | HLS at 240p, 360p, 480p and 720p; 1080p later, if members ask | MP4 at 240p, 360p, 480p |
| Posting | Post at once; the post is hidden until its video is ready. The composer previews the member's own file before they post (owner, 4 November 2026) | Wait for `ready`, then post |
| Trial server | An hourly Hetzner cloud server, deleted after | (not in ADR 0019) |

## 2. What we accept

| | Limit | Setting | Why |
|---|---|---|---|
| Length | 3 to 180 seconds | `VIDEO_MAX_SECONDS` 180 (its ceiling rises from 78 to 180) | Reels' length; Shield checks the whole file |
| Size | 1 GB | `VIDEO_MAX_BYTES` 1024 MiB | 3 minutes of 4K at 30 fps is about 510 MB; 4K at 60 fps is about 1.2 GB, so those are told to trim or record at 1080p before they upload |
| Picture | Long side up to 3840 px | `VIDEO_MAX_EDGE` 3840 | What phones record |
| Frame rate | Up to 60 fps | `MAX_FPS` (unchanged) | Slow motion at 120 or 240 fps stays refused as `too_high_frame_rate` |
| Codecs | H.264, HEVC, VP9 | probe | What phones and browsers record |

**With PhotoDNA alone, the old ceiling stays.** Its frame sampling covers at most
78 seconds, so when Arachnid Shield is not bound the effective limit is the lower
of `VIDEO_MAX_SECONDS` and 78, and `/v1/me` reports that. With both scanners
bound, both are asked as today: PhotoDNA's 80 frames are spread over the whole
clip, and Shield checks every frame.

**Data.** Before sending a file over 200 MB the composer shows its size and asks;
low-data members are asked for every file. The limits reach the browser and the
apps from `/v1/me` (`videoLimits`), as they do today.

## 3. What the worker makes

One ffmpeg run (`hlsArgs` in `apps/api/src/video/hls.ts`): decode once, cap at
30 fps, tone-map HDR or scale down to the top quality, then split into one encode
per quality.

| Quality (short edge) | Video | Audio | A minute (the Mac test) |
|---|---|---|---|
| 240 | 300 kbps | 48 kbps | about 2.7 MB |
| 360 | 550 kbps | 64 kbps | about 4.6 MB |
| 480 | 900 kbps | 64 kbps | about 7.0 MB |
| 720 | 1,800 kbps | 96 kbps | about 13.5 MB |
| **All four, what R2 keeps** | | | **27.7 MB; 28 to 30 MB in the trial** |

- **Never enlarged**, and portrait stays portrait: a quality above the original's
  short edge is skipped, and a clip under 240 gets one quality at its own size, as
  in ADR 0019.
- **HLS details:** fMP4 pieces of 4 seconds (`piece-NNN.m4s`) after one init file
  per quality (`init_<n>.mp4`); a keyframe every 2 seconds, so every piece starts
  on one; VOD playlists; H.264 Main, `veryfast`; AAC stereo; metadata dropped.
- **HDR** (PQ or HLG, which iPhone 12 and later record by default) is tone-mapped
  with zscale and Hable's curve, after scaling down to 720p, not at 4K: at 4K it
  cost 11 CPU-seconds per second of video and 1.55 GB. Without it HDR looks grey.
  The trial's HDR clips were watched on Android; an iPhone check is still to do.
- **Four decoder threads** (`DECODER_THREADS`): as fast as letting ffmpeg choose,
  and a quarter less memory on 4K.
- **Poster** as today: `poster.webp`, 640 px, from a frame the scanners have seen.
- **Order unchanged:** probe, Shield (and PhotoDNA's frames when bound), then
  encode. A match stops the job before anything is encoded or written to the
  public bucket.

1080p is left out on purpose: it would nearly double what we store and deliver,
and on a phone screen 720p is hard to tell apart. Add it if members ask.

## 4. Where it lives and how it is served

**Keys.** Everything a reader fetches is under one folder per video, so takedown,
release and deletion act on the folder:

```
media bucket (public)
  videos/<id>/poster.webp
  videos/<id>/hls/master.m3u8         every quality
  videos/<id>/hls/master-480.m3u8     240p to 480p, for the auto data setting
  videos/<id>/hls/<label>/index.m3u8  one quality
  videos/<id>/hls/<label>/init_<n>.mp4
  videos/<id>/hls/<label>/piece-NNN.m4s
uploads bucket (private), unchanged
  videos/<id>                         the original, deleted once encoded
  quarantine/originals/videos/<id>    a matched or unscanned original: evidence
  quarantine/videos/<id>/...          a taken-down video's folder
```

`master-480.m3u8` is the master playlist without its 720p line, written by the
worker after ffmpeg. Everything is written once and never changed, so it carries
the same `Cache-Control` as images (`public, max-age=31536000, immutable`).

**Served from the media domain** (`MEDIA_ORIGIN`, an R2 custom domain), never from
`/media` on the site: the site's path goes through nginx on our server, and
Cloudflare's terms allow video served from R2, not from our server. The API
gives readers absolute URLs on the media domain.

**Cloudflare setup, once per zone:**

- A **Cache Rule** on the media domain: when the path ends in `.m3u8` or `.m4s`,
  eligible for cache. Cloudflare does not cache those two by default; `.mp4` and
  `.webp` it does.
- A **CORS rule** on the media bucket allowing `GET` and `HEAD` from the site's
  origin, because hls.js fetches the playlists and pieces with `fetch`. The
  trial's test page was on the media domain itself, so this is **(unverified)**.
- **Purge by prefix**, `videos/<id>/` on the media domain, which Cloudflare offers
  on every plan now (5 a minute on Free). Today's purger sends single URLs; PR 3
  adds prefixes, through the existing purge queue so the rate limit is respected.

**Takedown and release** move the whole folder between the public bucket and
`quarantine/videos/<id>/` in the private one (list, server-side copy, delete
many), then purge the prefix. Deletion and account erasure (ADR 0016) remove the
folder. A browser that already cached pieces keeps them, as for images today.

**18+ video (ADR 0020).** ADR 0019 planned to serve labelled video privately, by
signed URL. That does not carry over to HLS as it is: a playlist names its pieces
by relative path, and R2 signs single objects on its S3 endpoint only. When labels
are built, either the API returns playlists rewritten with a signed URL per piece
(45 pieces per quality for 3 minutes), or a Cloudflare Worker in front of the
private bucket checks a short-lived token. Decided with ADR 0020's phase 1; until
labels exist no video can be labelled.

**Videos made before this.** Production has none. Staging has the team's test
videos as MP4s. There is no MP4 path after PR 2: those are removed by a one-off
on staging (open question 3).

## 5. Encoding capacity

Measured with the trial command and the production limits, on the same eight
clips: on a Hetzner CCX33 (8 vCPUs) on 4 November, and on the pilot's netcup
RS 1000 (4 cores) on 5 November. CPU-seconds per second of video is the work; a
clip's time on N busy cores is about its length times this, divided by N.

| Original | CPU-s per s (CCX33 / RS 1000) | Peak memory (CCX33 / RS 1000) | A 3-minute clip on the RS 1000 | On 8 vCPUs (about 6 busy) |
|---|---|---|---|---|
| 1080p, 30 fps, H.264 (already compressed) | 0.85 / 0.77 | 521 / 407 MB | about 50 s | about 25 s |
| 1080p, 60 fps, HEVC (Android) | 2.26 to 2.50 / 2.28 to 2.43 | 531 / 413 MB | about 2.4 min | about 75 s |
| 1080p, 30 fps, HEVC, HDR (iPhone) | 2.48 to 2.66 / 2.20 to 2.32 | 608 / 477 MB | about 2.2 min | about 80 s |
| 4K, 60 fps, HEVC (Android) | 4.30 / 4.78 | 662 / 548 MB | 5 to 7 min | about 2.2 min |
| 4K, 60 fps, HEVC, HDR (iPhone) | 6.06 / 6.08 | 815 / 694 MB | 5 to 6 min | about 3 min |

netcup's cores do the same work per second of video as Hetzner's, within about
10% clip by clip, and with fewer threads need less memory. As on the CCX33, one
encode keeps about three-quarters of the cores busy: 2.5 to 3.6 of the RS 1000's
4. So its column scales each clip's own encode time to 3 minutes, and where that
differs from the work spread over 3 busy cores, gives both. The 3-minute columns
are extrapolated from clips of 4 to 79 seconds; the Android 4K row rests on one
4-second clip, which kept only 2 cores busy. The pass mark was "ready within 3
minutes on 8 vCPUs"; the worst case sits on it, and takes 5 to 6 minutes on the
pilot's 4 cores. Since members no longer wait for it (section 6), that is
acceptable.

- **Cores.** A server of the worker's own. The pilot starts on 4 cores, a netcup
  RS 1000 (owner, 5 November 2026; open question 1). Flat out, it encodes about
  1,800 minutes a day of ordinary 1080p phone video, or about 800 of 4K 60 fps
  HDR, against 10 a day for the pilot and 330 a day at the Growing stage
  (section 8). 8 cores (an RS 2000) roughly double that and bring the worst clip
  to about 3 minutes: move up when clips start to queue, or before the Large
  stage. netcup upgrades a server to a bigger plan of the same generation in its
  control panel, free and keeping the data, and cannot go back down.
  `VIDEO_WORKER_CPUS` is set to the server's cores; compose's default of 2 would
  make a 3-minute 4K HDR clip take 10 minutes or more.
- **One video at a time per worker** (concurrency 1): one encode keeps about
  three-quarters of the cores busy (6 of 8, 3 of 4). More throughput is more
  workers on more servers, reading the same
  queue.
- **Memory.** 1.5 GB stays the limit; the worst clip peaked at 815 MB on the
  CCX33 and 694 MB on the RS 1000.
- **Scratch on disk, not `tmpfs`.** The worker mounts a 2 GB `tmpfs` today, and
  `tmpfs` pages count against the container's memory limit. With a 1 GB original
  in it beside an 815 MB encode, the worker would be killed. PR 2 moves the scratch
  to a disk volume of at least 3 GB (the original, its pieces and the sampled
  frames), as ADR 0019 section 3.4 already asked.
- **Time limits from the clip's length**, not a fixed 5 minutes per ffmpeg run:
  about 5 minutes plus 4 times the clip's length, so a 3-minute clip gets 17
  minutes, which covers a 2-core staging worker. The job's limit is that plus the
  Shield upload. Exact numbers are set in PR 2.
- **Shield** answered in 0.4 to 3 seconds per clip from the CCX33 and 0.6 to 5.4
  from the RS 1000, the largest 93.5 MB. Its size
  and rate limits are not published, and a 1 GB file has not been tried
  **(unverified)**. Its time limit is 5 minutes per file today; the original is
  streamed from disk, so a large file does not cost memory.
- **Where it runs** is PR 6 and open question 1. A worker on another server than
  Postgres and Redis needs a private network to them (WireGuard), or to report to
  the API over HTTPS instead of writing to the database.

## 6. Posting before the video is ready

**Preview first, from the member's own file.** As soon as a video is picked, the
composer plays it from the device (an object URL in a `<video>`), while it
uploads: the member checks it is the right clip, writes the text, and can remove
it. Bluesky's website does exactly this (its code is public), and Instagram is
reported to start the upload before Share, as we do. Where the browser cannot play the file (iPhone HEVC on some
desktop browsers), the composer says so and shows the poster once the worker has
made it. A preview that fails never removes the video or stops its upload
(Bluesky's code guards against the same mistake). The preview is of the
original, so HDR may look a little different from what readers get after
tone-mapping.

**Then post, without waiting for processing.** The member can press Post at
once. If the upload is still running, the composer holds the press, says it will
post when the upload finishes and to keep the tab open, and then posts by itself,
as Bluesky's composer does; the member can cancel, and if the upload fails nothing is
posted and the text stays in the composer. (The post can only be created once
the upload completes, since closing the tab stops it; the native apps upload in
the background and can let the member leave sooner.) The post is created with
its video still `processing`:

- **Until the video is `ready` only its author sees the post**, marked
  "Processing". It is left out of every feed, profile seen by others, search,
  notification, count and link preview, and cannot be replied to, quoted or
  reposted. The rule sits in the post queries, in one place, like the
  moderation filters.
- **When the video becomes `ready`** the post appears, and its mentions and
  notifications are sent then, not before. It takes its place in feeds, and its
  time, as of the moment it appears (open question 4).
- **When the video is `blocked`, `rejected` or `failed`**, the post is removed and
  its author is told, with the post's text so it can be posted again. A blocked
  video comes back as "That video cannot be used", with no reason, as today.
- **The author can delete the post while it processes**; that deletes the video
  and the job finds the row gone, as an unattached delete does today.
- **If the worker is down** the post simply stays hidden. Nothing is published
  without a clear scan.

This needs no HLS and can be built before it (PR 5 works with phase 1's MP4s).

**How other apps do it** (checked 5 November 2026; sources at the end):

- **Bluesky and Mastodon** create the post only once its video is processed, and
  keep the member in the composer until then (Mastodon's server refuses a post
  whose video has not finished). That suits processing that takes seconds; ours
  takes minutes for 4K (section 5), so we create the post at upload and hide it,
  and the member can close the tab.
- **Instagram** holds the post in the app after Share, with a progress bar, and
  members report being asked to keep the app open until it finishes.
- **Facebook** tells the member when the video is ready to share. It splits the
  video into pieces (on the phone where it can) and encodes each as it arrives, so
  the wait after the upload is short; some analysis of the whole video runs only
  after the member is told. Ours cannot work that way: nothing is shown before
  Shield has passed the whole original.
- **YouTube** lets a video go public once its standard quality is done and adds
  the higher qualities later, hours later for long 4K. Not copied: the worker
  makes every size in one pass, and most of its time goes on reading the original
  (in the trial, 6.06 CPU-seconds per second for iPhone 4K60 HDR against 0.85
  for 1080p H.264, with the same outputs), which a low-quality pass would still
  need.
- **TikTok and X**: nothing reliable found.

## 7. Playback

ADR 0019 section 5.1 stands: tap to play, no autoplay, the poster first, one video
at a time, the box reserved from the stored size. What changes:

- **The player:** the browser's own HLS where it has it (Safari, every browser on
  iPhone), **hls.js** elsewhere (Chrome on Android, desktop browsers), from npm in
  the web bundle, not a CDN. Pinned; the trial used 1.5.17.
- **Starting low and stepping up:** the first piece at 240p is about 175 KB, so
  playback can start within 2 seconds on mobile data; hls.js then picks the
  quality the connection carries. Start times on mobile data were not written
  down in the trial **(unverified)**.
- **The data setting caps the quality** by the playlist it plays, which works the
  same in hls.js and in the browser's own player:

| Mode | Before tap | Plays | At most |
|---|---|---|---|
| `saver` (or `auto` with `Save-Data: on`) | No poster. "Tap to load video, 0:32, about 1.4 MB" (from the 240p bytes) | `240/index.m3u8` | 240p, about 2.7 MB a minute |
| `auto` otherwise | Poster, tap to play | `master-480.m3u8` | 480p, about 7 MB a minute |
| `full` | Poster, tap to play | `master.m3u8` | 720p, about 13.5 MB a minute |

  A clip without the capped quality plays the largest it has below it, as in
  ADR 0019 section 5.2.
- **Security headers.** Pages have no Content-Security-Policy today. One added
  later must allow the media domain in `media-src`, `img-src` and `connect-src`,
  and `blob:` in `worker-src` for hls.js's worker.

## 8. Cost

Storage is 29 MB per minute kept (measured) at R2's $0.015 per GB-month; about 66
objects are written per minute of video; each minute watched is 15 pieces, 95 of
100 assumed to come from the CDN's copies; delivery is free. Encoding is the only
real cost.

| Stage | Uploaded a month | Encoding | R2 | Total a month | Stream, same use |
|---|---|---|---|---|---|
| Pilot | 300 min (10 a day) | one 4-core server, netcup RS 1000, €21.73 | under $1 | about €22 | $25 |
| Growing | 10,000 min (330 a day) | the same server | about $12 | about €33 | $1,150 |
| Large | 100,000 min (3,300 a day) | two 8-core servers, netcup RS 2000, €81.40 | about $150 | about €220 | $21,500 |

netcup's prices are on a 12-month term and include German VAT at 19%, which may
differ by country (the RS 1000 is €25.00 on a 1-month term, €18.47 on 24 months;
the RS 2000 €46.81 and €34.60). netcup's cores encode like those of Hetzner's
CCX33 (€138.99 a month): the trial command ran on the RS 1000 on 5 November
before it took any jobs, and did the same work per second of video, within about
10% (section 5). Not counted: developer time, monitoring, and the traffic of
sending originals to Shield.

## 9. Schema, API and settings

- **No migration.** `video_renditions` keeps one row per quality (`height` is the
  label: 240, 360, 480, 720, or the clip's own below 240) with its `width`, `bytes`
  and `bitrate_kbps`; the bytes now count a quality's pieces. `video_details` is
  unchanged.
- **Reader payload:** `{id, durationMs, width, height, posterUrl, playlists: {all,
  upTo480}, renditions: [{height, playlistUrl, bytes}], description}`, every URL
  absolute on the media domain. `renditions[].url` to MP4s goes.
- **Post create** accepts a `videoId` that is `processing` as well as `ready`
  (section 6); the post rows gain what PR 5 needs to hide and reveal them.
- **Settings** (`video-config.ts`): the defaults in section 2. `VIDEO_MAX_BYTES`
  already allows up to 2 GB.
- **The code rule is unchanged:** `videoPosts` is effective only when the flag is
  on and (a scanner is bound or `APP_ENV` is not `production`).

## 10. Native apps

Built for the apps that come next: the upload API is plain HTTP with signed parts
and resume, so an app uses it as the website does, in the background if it likes;
HLS plays in the platforms' own players; limits come from `/v1/me`; and
"Your video is ready" can be a push, since posting no longer waits. **The apps
shrink 4K and very large clips to about 1080p on the phone before sending** (PR 7),
so a 3-minute clip leaves as about 180 MB instead of up to 1.2 GB. Facebook
re-encodes on the phone only when the file is large, the connection is slow and
the phone has the hardware for it, to spare the battery when it would gain
little. The apps always shrink 4K, because that also spares the worker most of
its work (6.06 CPU-seconds per second for iPhone 4K60 HDR against 0.85 for
1080p H.264 in the trial), and use Facebook's three tests for clips that are
already 1080p or smaller. The website keeps sending originals; no in-browser
encoder.

## 11. Delivery and the launch gate

Pull requests into staging, each reviewable on its own. Sizes: S about a day, M
two or three, L about a week.

| # | Pull request | What changes | Waits for | Size |
|---|---|---|---|---|
| 0 | The trial | `hls.ts`, the trial command and guide (PR #85) | | done |
| 1 | This ADR | the decision, written down | the trial | S |
| 2 | HLS encoder and 4K input | the worker writes section 3's files; the limits in section 2; scratch on disk; time limits from length; the API hands readers playlists | 1 | L |
| 3 | Folders in storage | list and delete many in `ObjectStore`; takedown, release and deletion move folders; purge by prefix | 2's layout | M |
| 4 | The player | hls.js and the browser's own HLS, the data-setting playlists, the Cache Rule and CORS rule | 2's playlists | M |
| 5 | Post before ready | section 6 | nothing | L |
| 6 | Worker capacity and alerts | the worker's server and limits; queue length and time to ready in the logs; an alert when the queue backs up | the trial | S |
| 7 | Shrink before upload, in the apps | section 10 | the native apps | M |

After 2 to 6: reopen video on staging for allow-listed testers, fix what they
find, then decide on production.

**Launch gate**, all required before `videoPosts` is turned on in production. It
replaces ADR 0019 section 4.7's items 1 to 4; its items 5 to 7 (the abuse-material
checklist and counsel's answers, the drills, a named person's sign-off) stand.

1. A scanner is bound in production and shown to work on staging: Arachnid Shield
   (an ordinary video publishes, Shield's test file is blocked), or PhotoDNA with
   Microsoft's written answer that video frames are within its terms.
2. Every video's playlists, pieces and poster come from the media domain, not
   `/media` on the site, shown on staging.
3. The Cache Rule and the CORS rule are in place on the production media domain,
   and a takedown on staging is shown to purge a whole folder.
4. A 3-minute 4K clip and a 1 GB file have been through the worker and Shield on
   the production worker's server.

## Options considered

- **A. Keep phase 1** (MP4, 60 seconds, 1080p). No new work, and the experience
  that led to video being switched off.
- **B. HLS on R2, encoded by our worker (chosen).** Most work; cheapest by far at
  any size; files and scanning stay ours.
- **C. Cloudflare Stream.** Least work; $5 per 1,000 minutes stored and $1 per 1,000
  delivered, which is $1,150 a month at 10,000 minutes uploaded and $21,500 at
  100,000. Kept as the fallback for delivery.
- **D. Bunny Stream or Mux.** Cheaper than Stream, a new processor each; not tried.
- **E. Encode in the browser.** Too slow and too hard on the phones we serve; the
  native apps do it instead (PR 7).
- **F. Keep the post in the composer until its video is ready**, as Bluesky and
  Mastodon do. No hidden posts and no rule in the post queries; but the member
  waits with the tab open for minutes on a 4K clip, and loses the post if they
  close it.

## Consequences

- Members can post the videos their phones record, without trimming most of them,
  and post without waiting for processing.
- We run more: an encoder on a server of its own (4 cores for the pilot, 8 as it
  grows), a Cache Rule and a CORS
  rule outside the repository, and a pinned ffmpeg to keep patched.
- Storage roughly doubles per minute against phase 1's three MP4s (720p is half of
  it), and a video is about 66 objects per minute of it instead of four files.
- Takedown becomes a folder operation, and the CDN purge goes by prefix.
- The worst-case clip, 3 minutes of 4K 60 fps HDR, takes about as long to encode
  as it lasts on 8 cores, and nearly twice as long on the pilot's 4.
- 18+ video needs a design of its own for private HLS before labels ship.

## Open questions

1. **Where the worker runs.** A netcup RS 2000 of its own (€40.70, cores untried),
   a Hetzner CCX33 (€138.99, measured), or spare cores on today's servers for the
   pilot (a 3-minute 4K HDR clip in about 9 minutes on 2 cores). Recommend: the
   RS 2000, once the trial command has been run on one. *Answer (owner,
   4 November 2026):* a netcup RS 2000. netcup has no hourly billing, so its
   cores are measured with the trial command before it takes jobs: on the new
   server, or at a quiet hour on the production RS 2000 limited to 2 cores (the
   CPU-seconds per second do not depend on how many cores it is given).
   *Changed (owner, 5 November 2026):* a netcup RS 1000 for the pilot (4 dedicated
   cores, 8 GB, 128 GB, €21.73 a month on a 12-month term), upgraded to an RS 2000
   when clips start to queue (section 5). The trial command ran on it on
   5 November, before it took any jobs: its cores do the same work per second of
   video as the CCX33's (section 5).
2. **Cloudflare's written answer.** ADR 0019 asked for one. Recommend: rely on the
   published terms (Context), and still ask once in writing whether the CSAM
   Scanning Tool covers video, which it does not say. Not a gate. *Answer (owner,
   4 November 2026):* rely on the published terms; no written answer is needed.
   The owner's reading is that the CSAM Scanning Tool does not reliably cover
   video, so nothing relies on it: Arachnid Shield is the check for video.
3. **Staging's MP4 videos.** Recommend: delete them, and their videos from posts,
   with a one-off when PR 2 lands; they are the team's tests. *Answer (owner,
   4 November 2026):* yes.
4. **Where a post appears in feeds** when its video becomes ready: at the time it
   appears, or the time it was posted. Recommend: when it appears, so a video
   posted three minutes ago is not already buried. *Answer (owner, 4 November
   2026):* when it appears. The owner first preferred making the member wait for
   `ready` so they could preview the post; a preview of their own file in the
   composer (section 6) gives that without the wait.
5. **1080p.** Recommend: not until members ask. *Answer (owner, 4 November
   2026):* agreed.

## Could not verify

Whether netcup's "dedicated cores" are whole cores or threads; an Android 4K clip
longer than 4 seconds on 4 cores; that an RS 1000 upgrades to an RS 2000 in place
(netcup's example is RS 2000 to RS 4000); playback and start times on an iPhone
and on mobile data; a clip near 3 minutes long (the longest was 79 seconds); a
1 GB file through Shield, and Shield's rate limit; hls.js fetching across origins
from the site; Cloudflare caching `.m3u8` and `.m4s` under the Cache Rule (not
yet added); purge by prefix on our zone's plan; HDR colour on an iPhone screen. How TikTok
and X handle posting, and Instagram's own account of it (its engineering post on
upload latency would not load); what Instagram does is second-hand.

## Sources (retrieved 4 and 5 November 2026)

- The trial: `docs/video-trial.md` (PR #85), run `202611042030` on a Hetzner CCX33
  (4 November) and a run on the netcup RS 1000 (5 November), and the results
  table in the video plan's Implementation plan tab.
- Cloudflare's updated terms, on serving video from R2 through the CDN: https://blog.cloudflare.com/updated-tos/
- Cloudflare default cache behaviour (`.m3u8` and `.m4s` not cached): https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
- Cloudflare purge by prefix and its limits by plan: https://developers.cloudflare.com/cache/how-to/purge-cache/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 public buckets and custom domains: https://developers.cloudflare.com/r2/buckets/public-buckets/
- Cloudflare Stream pricing: https://developers.cloudflare.com/stream/pricing/
- Hetzner dedicated-vCPU cloud servers (CCX33, excluding VAT): https://www.hetzner.com/cloud/general-purpose/
- netcup root servers (RS 1000 and RS 2000 G12.5, prices incl. 19% VAT): https://www.netcup.com/en/server/root-server
  and https://www.netcup.com/en/server/root-server/rs-1000-g12.5-iv-24m-eu
- netcup upgrades (free, data kept, no way back down): https://www.netcup.com/en/helpcenter/documentation/general/instance-upgrade
- Arachnid Shield API: https://shield.projectarachnid.com/docs/
- How other apps post video (section 6), 5 November 2026:
  - Bluesky's composer, which holds the Post press until the video is ready, and
    its web preview: https://github.com/bluesky-social/social-app/blob/main/src/view/com/composer/Composer.tsx
    and https://github.com/bluesky-social/social-app/blob/main/src/view/com/composer/videos/VideoPreview.web.tsx
  - Mastodon refusing a post whose media is still processing, and its composer
    waiting: https://github.com/mastodon/mastodon/blob/main/app/services/post_status_service.rb
    and https://github.com/mastodon/mastodon/blob/main/app/javascript/mastodon/actions/compose.js
  - Facebook's Streaming Video Engine (SOSP 2017): upload and encoding overlapped,
    the member told when the video is ready to share, re-encoding on the phone
    under three conditions: https://www.cs.princeton.edu/~wlloyd/papers/sve-sosp17.pdf
  - YouTube Help, publishing once standard quality is done and higher qualities
    later: https://support.google.com/youtube/answer/57407 and https://support.google.com/youtube/answer/71674
  - Instagram uploading before Share (second-hand): https://www.popphoto.com/gear/2012/05/how-does-instagram-upload-files-so-damn-fast/
- In repo: `apps/api/src/video/` (`hls.ts`, `ffmpeg.ts`, `video-config.ts`,
  `video-keys.ts`), `apps/api/src/media/arachnid-shield.ts`,
  `apps/api/src/app.module.ts` (the purger), `infra/deploy/compose.yml` (the
  worker's limits), `apps/web/next.config.ts` (headers), ADR 0019.
