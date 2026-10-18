# Scanning uploads for child sexual abuse material

**Status (15 October 2026):** layer 2 is on: Cloudflare's CSAM Scanning Tool is
enabled for heynaija.ng. Layer 1 is not live: the code has a place for a scanner
and handles a match, but the scanner in use passes every image; PhotoDNA comes
later. **Uploads must
not open beyond the invited pilot until layers 1 and 2 below are live and the
legal questions at the end are answered.**

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
  profile photos (in the request) and post images (in the background job). It is
  bound in `apps/api/src/app.module.ts`, currently to `NoScanner`.
- **What happens on a match (built and tested):** nothing is published; the
  original is kept privately at `uploads/quarantine/originals/…`; the media row is
  marked `blocked`; the uploader sees only "That image cannot be used"; an
  error-level log line names the media ID and the member. Everything after that
  is the runbook below.
- **Which service:** [Microsoft PhotoDNA Cloud
  Service](https://www.microsoft.com/en-us/photodna/cloudservice). It is free for
  organisations that pass a third-party vetting process, and is meant for services
  that host user content. Apply early: vetting takes time. Its [terms of
  use](https://www.microsoft.com/en-us/photodna/termsofuse) limit it to preventing
  CSAM, allow Microsoft to audit use and to report aggregate figures to NCMEC, and
  say they do not replace our own reporting duties.
- **To do once approved:** write a `PhotoDnaScanner` that calls the match API,
  read its key from the environment, and bind it instead of `NoScanner`. Decide
  what happens when the service is down. Recommendation: **fail closed**. A post
  image's job throws, so BullMQ retries it and the image waits rather than being
  published unchecked. A profile photo upload fails with "try again later".
- **Alternatives** if PhotoDNA is refused: Thorn's Safer (paid), or the hash lists
  available through industry and hotline membership (for example IWF). Revisit if
  needed.

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
3. **Purge the CDN.** Removal stops new requests reaching storage, but
   Cloudflare may still have the image cached (we set year-long caching). Purge
   the URL `/media/posts/<id>/*` or `/media/avatars/<id>/*` in Cloudflare. *Not
   automated yet: needed before launch.*
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
- Error-level API logs must reach a person: alerting is part of roadmap step 5.
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

Questions:

1. Are we required to report CSAM we find, and to whom: the Nigeria Police Force's
   cybercrime unit, NCMEC's CyberTipline (it accepts reports from outside the
   US), an INHOPE hotline, or several?
2. How long must we preserve the material and related data, and how must we store
   it?
3. Does holding quarantined material for evidence need any formal arrangement?
4. Which parts of the NITDA Code apply to a service of our size?
5. What should the privacy policy and terms say about scanning?

## Checklist before uploads open beyond the pilot

- [ ] PhotoDNA (or an alternative) approved, scanner implemented and failing closed
- [x] Cloudflare CSAM Scanning Tool on, for the hostname that serves `/media` (enabled 15 October 2026 for heynaija.ng; `/media` must stay on that proxied hostname)
- [ ] Safety email address monitored daily
- [ ] CDN purge on removal (automated, or a written manual step)
- [ ] R2 lifecycle rule excludes `quarantine/`
- [ ] API error alerts reach a person
- [ ] Counsel's answers to the questions above, and the runbook updated to match
- [ ] Privacy policy covers scanning, quarantine and retention
