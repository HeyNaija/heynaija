# Video scanning: no scanner means no video

**Read this before switching video on anywhere.** Design: ADR 0019 (video posts).

## The rule

**No video is ever published unless an upload scanner has looked at it and said
"clear".** The scanners are Arachnid Shield (`ARACHNID_SHIELD_USERNAME` and
`ARACHNID_SHIELD_PASSWORD`), which is sent the whole original and matches every
frame itself, and PhotoDNA (`PHOTODNA_SUBSCRIPTION_KEY`, once Microsoft approves
us), which is sent our sampled frames. With both set both are asked, and a match
from either blocks the video. With neither, the scanner is `NoScanner`, and for
video that means:

- Every uploaded video is **held `quarantined`**. It is never made `ready`, never
  copied to the public bucket, and cannot be put on a post (attaching needs `ready`).
- Its original is kept privately at `quarantine/originals/videos/<id>` in the
  uploads bucket, so it can be scanned later when a scanner exists. Nothing re-scans
  it automatically yet (phase 2).
- The `video-worker` says so at start-up (three lines on stderr) and logs a warning
  for every video it holds.
- This is not configurable. There is no "pass everything" scanner for video, in any
  environment, on purpose. (`NoScanner` still passes images, as it always has.)

To exercise the full pipeline end to end in development or staging, set the
Arachnid Shield login: an ordinary clip comes back `no-known-match` and is
published. Shield's own test media (classification `test`) are treated as a match,
so the blocking path can be drilled without real material. Without a login, run a
small stand-in for PhotoDNA's Match endpoint and point `PHOTODNA_MATCH_URL` and
`PHOTODNA_SUBSCRIPTION_KEY` at it. The tests use stand-ins for both; never real
material.

## Two gates, and who can flip them

1. **The `videoPosts` flag** (`docs/feature-flags.md`): off in production, on in
   staging and development. An admin can flip it in the database.
2. **The code rule, which no admin can flip:** `videoPosts` is effective only when
   the flag is on **and** (a scanner other than `NoScanner` is bound **or** `APP_ENV`
   is not `production`). In production with `NoScanner`:
   - every video route answers 404 exactly as a route that does not exist (signed in
     or not);
   - `/v1/me` reports `features.videoPosts: false`;
   - a post that carries a `video` is refused (`feature_unavailable`).

Both are pinned by tests (`video-gate.test.ts`, `video.http.test.ts`,
`video-posts.test.ts`). If the flag store cannot be read, the production default
(off) answers.

## What the code enforces from the ADR's launch gate (section 4.7)

| Gate item | In code |
|---|---|
| Not on in production with `NoScanner` | Yes (above). |
| Allow-list, and eligibility on top | The flag's allow-list decides who sees video; it does not bypass the rules. Everyone, allow-listed or not, also needs: accounts at least `VIDEO_MIN_ACCOUNT_AGE_DAYS` (7) old, with no upheld moderation action (post removed, suspension, photo removed, profile cleared) and no scanner block in the last `VIDEO_UPHELD_LOOKBACK_DAYS` (90), and at most `VIDEO_MAX_LIVE_PER_MEMBER` (50) live videos. |
| Rate limits | 3 uploads an hour and 10 a day (`videoUpload`); 120 part/resume requests a minute (`videoPart`). |
| Fail closed | A scanner that cannot answer throws: the job retries (3 attempts, exponential from 30 s), then the video is `failed`. Never published on "no answer". |
| An illegal report hides the video at once | Yes: a report with reason `illegal` quarantines the post's video pending review (ADR open question 6, default yes). |

**Done:** Arachnid Shield's login is set in production, on the API and the video
worker's own server (8 November 2026), so production videos are scanned.

**Not in code, and still to do** (all are people, not software): if PhotoDNA is used, Microsoft's written answer on
frame-by-frame video use; Cloudflare's written answer on video via
R2 and the custom domain, and the CSAM tool on that hostname; the checklist in
`abuse-material-scanning.md` fully ticked; counsel's answers; phase 4 drills; a
named person signing off in the PR that flips the flag.

## What a match does

Same as images: the original is kept privately (`quarantine/originals/videos/<id>`),
the row becomes `blocked`, the account gets an "Illegal content" report and
`SAFETY_ALERT_EMAIL` an alert (media ID and member ID, never the content). The
uploader is told only that the video could not be used. The time of the matching
frame (from our sample for PhotoDNA, or as Shield reports it for a near match; none
for an exact match of the whole file) is recorded in `video_details`, with the
SHA-256 of the original. Shield's `harmful-abusive-material` blocks as `csam` does,
and so would any classification it adds later: only `no-known-match` is clear.

## Honest limits (as in the ADR)

- For PhotoDNA, frames are **sampled** (one a second, the last frame, up to 20 at
  scene changes, at most 80). Something shown for under a second between samples
  can be missed. Arachnid Shield is sent the whole file and samples it its own way,
  which it does not publish.
- **Audio is not scanned.**
- Cloudflare's own scanner is unverified for video: treat video as one automated layer.
