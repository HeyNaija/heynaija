# Scanning uploads for child sexual abuse material

**Status (8 November 2026):** layers 1 and 2 are on in production. Arachnid
Shield's login (`ARACHNID_SHIELD_USERNAME` and `ARACHNID_SHIELD_PASSWORD`) is set
on the production API and on the video worker's own server, so every image and
video is hash-matched before it is published, failing closed. Cloudflare's CSAM
Scanning Tool has been on for heynaija.ng since 15 October. PhotoDNA (applied for
26 October) adds a second matcher when `PHOTODNA_SUBSCRIPTION_KEY` is set. The
questions at the end went to counsel on 26 October. **Uploads must not open
beyond the invited pilot until the checklist at the end is complete, counsel's
answers included.**

This is a plan for the people running HeyNaija. It is not legal advice; the
questions in the last section need a Nigerian lawyer.

## What we are protecting against

Members can upload images (profile photos, and up to four images or GIFs per post). Any
service that hosts user images will eventually receive known child sexual abuse
material (CSAM). The aim is that a known image is never published, that anything
that slips through is taken down quickly, and that we keep what the authorities
need.

## What the scanner is given

`ContentScanner.scan` receives the **original file** of every upload before it is
published: a profile photo, a post image, a GIF, and the thumbnail we copy for a
link preview card. A real scanner must therefore handle **GIFs**, which can hold
hundreds of frames: scan every frame (or a sample the provider accepts), not just
the first. The first frame is also what `still.webp` shows, but the animation is
published too. Link thumbnails are fetched from other sites by our server; they are
scanned the same way and simply left off the card when blocked.

## Three layers

### 1. Hash matching before publishing (in our pipeline)

Every upload already passes through the API before it is published: the browser
uploads to a private bucket, and the API checks and re-encodes the image before
anything reaches the public bucket. The scanner runs there, on the original file,
before the public copies are written.

- **Where:** `ContentScanner` in `apps/api/src/media/media.service.ts`, called for
  profile photos (in the request) and post images (in the background job), and for
  videos by the video worker (docs/safety/video-scanning.md). `scannerFromEnv`
  (`apps/api/src/media/scanners.ts`) builds it for the API and the worker alike:
  `ArachnidShieldScanner` (`arachnid-shield.ts`) when its login is set,
  `PhotoDnaScanner` (`photodna.ts`) when its key is, both together when both are
  (a match from either blocks; either failing to answer makes the upload wait), and
  otherwise `NoScanner`, which passes every image.
- **What happens on a match (built and tested):** nothing is published; the
  original is kept privately at `uploads/quarantine/originals/…`; the media row is
  marked `blocked`; the uploader sees only "That image cannot be used". The
  account goes to the top of the moderation queue as an "Illegal content" report
  "flagged by the upload scanner", naming the media ID, and an alert is emailed to
  `SAFETY_ALERT_EMAIL` (it is also an error-level log line). Everything after
  that is the runbook below.
- **When the scanner cannot answer (built and tested): fail closed.** Nothing is
  published unchecked. A post image's job throws, so BullMQ retries it; if the
  service is still down the composer gives up after about two minutes and says
  to try again. A profile photo upload fails with "try again in a moment".
  Errors of any kind from either service, a missing answer included, count as
  "cannot answer"; so does a wrong Arachnid Shield login (HTTP 401).
- **Arachnid Shield:** the [Canadian Centre for Child Protection's free
  API](https://shield.projectarachnid.com/docs/). The original image or video goes
  up as the request body (HTTP Basic, with the API username and password) and is
  compared with Project Arachnid's list, exactly and by PhotoDNA near-match; a
  video is matched frame by frame on their side. `no-known-match` is the only clear
  answer: `csam`, `harmful-abusive-material`, their drill class `test`, and any
  class they add later all block. We never use its "submit media" endpoint, which
  sends a file to their analysts: that is a person's decision, not the code's.
- **PhotoDNA:** [Microsoft PhotoDNA Cloud
  Service](https://www.microsoft.com/en-us/photodna/cloudservice). It is free for
  organisations that pass a third-party vetting process, and is meant for services
  that host user content. Apply early: vetting takes time. Its [terms of
  use](https://www.microsoft.com/en-us/photodna/termsofuse) limit it to preventing
  CSAM, allow Microsoft to audit use and to report aggregate figures to NCMEC, and
  say they do not replace our own reporting duties.
- **GIFs:** `framesToScan` sends every frame of an animation up to 20, and an
  even spread of 20 (the first and last among them) for a longer one. Each frame
  is sent as a JPEG at least 160px on its short side and at most 2048px on its
  long side. Check the frame sampling against what Microsoft accepts.
- **To do once approved:** check `apps/api/src/media/photodna.ts` against the
  documentation that comes with the key: the Match address (`PHOTODNA_MATCH_URL`
  overrides it without a code change), the success status code (3000), the size
  limits and the rate limit. It was written from the public documentation, without
  a key to try it on. Then set `PHOTODNA_SUBSCRIPTION_KEY` on staging, upload an
  ordinary image and confirm it publishes (a wrong address or status code shows
  up at once, as every upload waiting), and then on production.
- **Arachnid Shield is live in production,** on the API and the video worker
  server. A wrong login shows up at once: uploads wait and the logs say "Arachnid
  Shield gave no answer (HTTP 401…)". To see the block, the report and the alert
  without real material, use one of Shield's test files. Shield publishes no size
  or rate limit: an upload it refuses fails closed, so watch the logs.
- **Alternatives** if both are refused: Thorn's Safer (paid), Google's CSAI Match
  (video, free for qualifying partners), or the hash lists available through
  industry and hotline membership (for example IWF). Revisit if needed.

### 2. Cloudflare's CSAM Scanning Tool (at the edge)

Cloudflare compares images served through its cache with known-CSAM hash lists.
On a match it blocks the URL where it can and emails a daily summary of what it
found.

- **Setup:** dashboard → Caching → Configuration → CSAM Scanning Tool. Per
  [Cloudflare's current docs](https://developers.cloudflare.com/cache/reference/csam-scanning/)
  it needs only a notification email address; [Cloudflare
  says](https://blog.cloudflare.com/a-simpler-path-to-a-safer-internet-an-update-to-our-csam-scanning-tool/)
  it dropped the old requirement for NCMEC credentials. Use an address that reaches
  whoever handles safety, and is read daily.
- **It only sees what passes through Cloudflare's cache.** `/media/*` must be
  served through a Cloudflare-proxied hostname (the R2 custom domain, or a Worker
  route), not straight from storage.
- **It does not report for us.** The docs place reporting, preserving a copy,
  and keeping report records for a year on the site owner.
- **It is a second net, not the first:** it sees an image only after we
  published it.

### 3. People

Members can report a post or account as "Illegal content". Those reports reach
site moderators. When a moderator removes a post, its images now leave the public
bucket at once and are kept privately (`uploads/quarantine/…`); an author who
deletes a post that is still being reviewed cannot destroy its images either.

## Runbook when something matches or is reported

1. **Do not keep looking.** Confirm only as much as needed. Never download,
   forward or screenshot the image.
2. **Take it down:** remove the post (or the profile photo) in the moderation
   queue, and suspend the account. Both are reversible if it was a mistake.
3. **The CDN is purged for you.** Removal stops new requests reaching storage,
   but Cloudflare may still have the image cached (we set year-long caching), so
   every quarantine queues a purge of the image's files under `SITE_URL/media/`
   and `MEDIA_ORIGIN`, retried for over an hour. If it gives up, the API logs an
   error listing the files ("purge these by hand"): purge them in Cloudflare
   (domain → Caching → Configuration → Purge Cache → Custom Purge → URL), under
   both addresses.
4. **Preserve:** the quarantined files stay in the private bucket. Record, in a
   restricted place, the media ID, the member ID and handle, the times, and what
   was done. We do not store members' IP addresses; Kratos session data may help
   law enforcement and should be preserved too (ask counsel how).
5. **Report** to the bodies counsel names (see below). If Cloudflare's tool found
   it, this is still on us.
6. **Keep the records for at least a year,** with access limited to the people
   who handle safety (Cloudflare's guidance; counsel may require longer).

## What this needs from the infrastructure

- R2's lifecycle rule on the uploads bucket must **exclude** the `quarantine/`
  prefix (see `docs/deployment/cloudflare-r2.md`, step 5), or evidence is deleted
  after a day.
- These settings in `infra/deploy/.env`, on staging and production:
  - `SAFETY_ALERT_EMAIL=contact@heynaija.ng`: alerts for scanner matches and for
    every member report of illegal content. They say what and where, never the
    content.
  - `CLOUDFLARE_ZONE_ID` (the heynaija.ng zone's Overview page) and
    `CLOUDFLARE_PURGE_TOKEN`: a Cloudflare API token (My Profile → API Tokens →
    Create Token → Custom) with only **Zone → Cache Purge → Purge**, for the
    heynaija.ng zone only. One token per server.
  - `ARACHNID_SHIELD_USERNAME` and `ARACHNID_SHIELD_PASSWORD`: the API login from
    shield.projectarachnid.com (both or neither; the API and the video worker
    refuse to start with one).
  - `PHOTODNA_SUBSCRIPTION_KEY`, once Microsoft sends it.
- Other error-level API logs must reach a person too: alerting is part of
  roadmap step 5.
- A decision on how long quarantined files are kept, and who may access them,
  written into the privacy policy.

## Legal questions for counsel (Nigeria)

What we found, which counsel should confirm or correct:

- The [Cybercrimes (Prohibition, Prevention, etc.) Act
  2015](https://lawnigeria.com/2019/11/cyber-crime-prohibition-prevention-act-2015/),
  section 23, makes producing, distributing, procuring and possessing child
  pornography through a computer system an offence. Other sections place duties
  on service providers (such as preserving data and disclosing it to law
  enforcement), and section 21 concerns reporting cyber threats.
- NITDA's Code of Practice for Interactive Computer Service Platforms (2022)
  expects platforms to remove prohibited content quickly, with expedited action
  for child sexual exploitation material, to have child-protection policies and
  ways for users and agencies to report content. Some duties apply only to large
  platforms; HeyNaija is far below that size, but the rest may still apply.

Questions (sent to counsel on 26 October 2026):

1. Are we required to report CSAM we find, and to whom: the Nigeria Police Force's
   cybercrime unit, NCMEC's CyberTipline (it accepts reports from outside the
   US), an INHOPE hotline, or several?
2. How long must we preserve the material and related data, and how must we store
   it?
3. Does holding quarantined material for evidence need any formal arrangement?
4. Which parts of the NITDA Code apply to a service of our size?
5. What should the privacy policy and terms say about scanning?

## Checklist before uploads open beyond the pilot

- [x] An upload scanner's login set in production: Arachnid Shield, on the API and the video worker server (confirmed 8 November 2026; failing closed). PhotoDNA (applied 26 October 2026) would be a second matcher
- [x] Cloudflare CSAM Scanning Tool on, for the hostname that serves `/media` (enabled 15 October 2026 for heynaija.ng; `/media` must stay on that proxied hostname)
- [ ] Safety email address monitored daily: contact@heynaija.ng, set as `SAFETY_ALERT_EMAIL` on both servers
- [ ] CDN purge on removal: automated; `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_PURGE_TOKEN` set on both servers
- [x] R2 lifecycle rule excludes `quarantine/` (confirmed 26 October 2026: one rule each for `avatars/` and `posts/`)
- [ ] API error alerts reach a person (scanner matches and illegal-content reports are emailed; other errors are not yet)
- [ ] Counsel's answers to the questions above, and the runbook updated to match
- [ ] Privacy policy covers scanning, quarantine and retention
