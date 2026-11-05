# The video trial: real clips on a real server

Two days, before the HLS work is built, to turn the estimates in the video plan into
measurements: how long real phone clips take to encode on the server we would rent, how
much memory 4K and HDR need, how long Arachnid Shield takes, and how the result plays
on phones on mobile data.

**It passes when** a 3-minute clip, 4K included, is ready within 3 minutes on 8 vCPUs
and starts playing within 2 seconds on mobile data.

The command is `apps/api/src/cli/video-trial.ts`. It runs the exact ffmpeg command the
worker will use (`apps/api/src/video/hls.ts`), inside the `video-worker` image, so the
ffmpeg build, its version pin and the container's limits are the real ones too.

## What it does with each clip

1. Probes it: size, length, picture, frame rate, codec, and whether it is HDR.
2. Refuses what the worker would refuse: longer than 3 minutes, or bigger than 4K.
3. Sends the original to Arachnid Shield, when the login is set, and times it. **A clip
   Shield matches is stopped there**: never encoded, never uploaded.
4. Encodes it to HLS: 240p, 360p, 480p and 720p, 4-second pieces, at most 30 fps, HDR
   tone-mapped to ordinary colour. It times this with ffmpeg's own counters (CPU time,
   wall time, peak memory).
5. With `--upload`, puts the results and a test page in the media bucket under
   `trial/<run id>/`, to play on phones.

It writes `results.md` (a table) and `results.json` to the output folder.

## Before you start

- **Ten clips** from the team's own phones. Ordinary footage only. Mix them: an iPhone
  in 4K with HDR on (the default on iPhone 12 and later), an Android phone in 4K, 1080p
  at 30 and 60 fps, lengths from 15 seconds to 3 minutes, one with a lot of movement.
  Never use real abuse material. To see a block, use Arachnid Shield's own test files;
  they are stopped like a real match.
- **A Hetzner Cloud account.** New accounts are sometimes asked to verify themselves, so
  sign up a day early.
- **The Arachnid Shield login**, the same pair as in `.env`.
- **For playback on phones** (optional): staging's storage keys and media bucket, and the
  bucket's public domain (staging's `MEDIA_ORIGIN`).

## 1. Rent the server

In the Hetzner Cloud console, create a server: any EU location, type **Dedicated vCPU**,
**CCX33** (8 vCPUs, €0.2227 an hour), image Ubuntu, your SSH key. It is billed by the
hour until it is deleted, switched off or not.

## 2. Install Docker and build the worker image

```bash
ssh root@<server ip>
apt-get update && apt-get install -y docker.io docker-buildx git
git clone https://github.com/HeyNaija/heynaija.git && cd heynaija
docker build --target video-worker -t heynaija-video-worker:trial .
```

`docker-buildx` is needed: the `Dockerfile` caches pnpm's store with `RUN --mount`, which
Ubuntu's `docker.io` cannot build on its own. The build also proves the pinned ffmpeg still installs. If it fails at `apt-get` saying
the ffmpeg version was not found, see the `FFMPEG_VERSION` note in the `Dockerfile`.

## 3. Copy the clips and the login

From your computer:

```bash
scp -r <clips folder> root@<server ip>:/root/clips
```

On the server, make a file only root can read, and type the login into it with an
editor (fresh Ubuntu images may have none, hence the `apt-get`):

```bash
install -m 600 /dev/null /root/trial.env
apt-get install -y nano
nano /root/trial.env
mkdir -p /root/out && chmod 777 /root/out
```

```
ARACHNID_SHIELD_USERNAME=...
ARACHNID_SHIELD_PASSWORD=...
```

Not with `cat <<'EOF'` or `echo` at the prompt: bash keeps every line typed into a
command in its history, a here-document's lines included, so the password would be in
`~/.bash_history`. The login is only needed to time Shield; without the file, leave out
`--env-file` below and the run skips Shield.

## 4. Run it

```bash
docker run --rm --read-only --tmpfs /tmp:size=2g --memory 1.5g --env-file /root/trial.env \
  -v /root/clips:/clips:ro -v /root/out:/out \
  heynaija-video-worker:trial node dist/cli/video-trial.js /clips --out /out
```

`--memory 1.5g` is the worker's limit in production; run once more with `--memory 1g`
(staging's) and `--cpus 4` to see a smaller box.

## 5. Play the results on phones (optional)

Add these to `/root/trial.env` with `nano`, as in step 3, using staging's values:

```
S3_ENDPOINT=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_MEDIA_BUCKET=...
TRIAL_PUBLIC_URL=<staging's MEDIA_ORIGIN>
```

`TRIAL_PUBLIC_URL` must be the bucket's own domain, not the site's `/media` path: the
site's security headers would stop the test page's player. Then run step 4 again with
`--upload` on the end. It prints the test page's address: open it on a mid-range Android
phone on mobile data and on an iPhone, tap play on each video, and note what shows
under it: how long it took to start, the quality playing, and how often it stalled.

The pieces play without any Cloudflare change, straight from R2. To also try the CDN's
copies, add a Cache Rule on the media domain first (Caching, Cache Rules: when the URI
path ends with `.m3u8` or `.m4s`, eligible for cache). Cloudflare does not cache those
two file types by default.

## 6. Record the results

Copy the rows of `/root/out/results.md` into the results table in the Implementation
plan tab of the video doc, and fill in the phone and "plays well" columns by hand.

How to read the columns:

- **Encode time**: wall-clock time on this server.
- **CPU-s per s of video**: CPU-seconds per second of clip. A clip's time on a server
  with N vCPUs is about its length times this, divided by N.
- **Peak memory**: must stay under the worker's limit (1.5 GB in production, 1 GB on
  staging).
- **Stored per minute**: all four qualities together, what R2 will hold.
- **Shield**: its answer and how long it took, which includes uploading the original.

## 7. Clean up

```bash
docker run --rm --env-file /root/trial.env heynaija-video-worker:trial node dist/cli/video-trial.js --clean <run id>
```

Then delete the server in the Hetzner console.

## Measured so far

The first trial: eight clips from the team's phones, 4 to 79 seconds long, on a Hetzner
CCX33 (8 dedicated vCPUs) with the 1.5 GB limit, 4 November 2026.

| Clip | CPU-s per s of video | Peak memory | Stored per minute |
| --- | --- | --- | --- |
| iPhone, 4K, 60 fps, HEVC, HDR | 6.06 | 815 MB | 29.0 MB |
| Android, 4K, 60 fps, HEVC | 4.30 | 662 MB | 30.2 MB |
| iPhone, 1080p, 30 fps, HEVC, HDR (two clips) | 2.48 to 2.66 | 608 MB | 28.8 to 29.2 MB |
| Android, 1080p, 60 fps, HEVC (two clips) | 2.26 to 2.50 | 531 MB | 28.4 to 29.0 MB |
| A shared clip, 1080p, 30 fps, H.264 | 0.85 | 521 MB | 18.6 MB |
| A shared clip, 720x422, 30 fps, H.264 | 0.20 | 151 MB | 7.3 MB |

Shield took 0.4 to 3.0 seconds a clip, a 93 MB original included. The clips played on
an Android phone with one stall, too short to notice. At these rates a 3-minute 4K
60 fps HDR clip takes about 3 minutes on this server, right at the mark, and ordinary
1080p phone video about 75 seconds.

The second run: the same clips on the pilot's worker, a netcup RS 1000 (4 dedicated
cores), with `--memory 1.5g --cpus 4`, 5 November 2026, before it took any jobs.

| Clip | Length | Encode time | CPU-s per s of video | Peak memory | Stored per minute |
| --- | --- | --- | --- | --- | --- |
| iPhone, 4K, 60 fps, HEVC, HDR | 7.9 s | 14.0 s | 6.08 | 694 MB | 29.7 MB |
| Android, 4K, 60 fps, HEVC | 4.4 s | 10.6 s | 4.78 | 548 MB | 31.0 MB |
| iPhone, 1080p, 30 fps, HEVC, HDR (two clips) | 7.7 and 42.3 s | 5.9 and 30.0 s | 2.20 to 2.32 | 477 MB | 28.8 to 29.4 MB |
| Android, 1080p, 60 fps, HEVC (two clips) | 5.6 and 14.5 s | 5.0 and 12.1 s | 2.28 to 2.43 | 413 MB | 29.2 to 29.3 MB |
| A shared clip, 1080p, 30 fps, H.264 | 47.5 s | 14.3 s | 0.77 | 407 MB | 19.7 MB |
| A shared clip, 720x422, 30 fps, H.264 | 79.4 s | 6.7 s | 0.21 | 137 MB | 7.3 MB |

netcup's cores do the same work per second of video as the CCX33's, within about 10%,
and with fewer threads need less memory. One encode kept 2.5 to 3.6 of the 4 cores
busy, about three-quarters, as it kept about 6 of the CCX33's 8; the 4-second Android
4K clip kept only 2. At these rates a 3-minute 4K 60 fps HDR clip takes 5 to 6 minutes
on this server, and ordinary 1080p phone video about 2.2 to 2.4 minutes. Shield took 0.6
to 5.4 seconds a clip from there.

Not yet tried: a clip near 3 minutes, an Android 4K clip longer than 4 seconds, a 1 GB
file through Shield, playback on an iPhone, and the `--memory 1g` run.

Two changes to the command came out of earlier runs, with synthetic clips on an Apple
M4. HDR is tone-mapped at 720p, after scaling down, not at 4K: at 4K it cost 11
CPU-seconds per second of video and peaked at 1.55 GB. And decoding uses 4 threads: as
fast as letting ffmpeg choose, with a quarter less memory.
