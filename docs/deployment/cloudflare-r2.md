# Setting up Cloudflare R2 for media

HeyNaija stores uploaded media (profile photos and post images) in S3-compatible
object storage. Locally that is MinIO; in production it is Cloudflare R2. The code does not
change between them; only the `S3_*` settings do.

> **Not yet tested against R2.** Everything below follows R2's S3-compatible API and
> was verified end to end against MinIO only. Do the checks in step 8 on staging
> before relying on it.

## What you are setting up

| Bucket | Access | Holds |
|---|---|---|
| `heynaija-uploads` | **Private** | Files exactly as a browser sent them. Lives for minutes. |
| `heynaija-media` | **Public read** | Images the API has checked and re-encoded. Cached for a year. |

Browsers upload straight to the uploads bucket using a signed URL that is valid for
five minutes and only accepts the exact size and type the API approved. The API
then checks the file, writes small WebP versions to the media bucket, and deletes
the original.

## 1. Enable R2

Cloudflare dashboard → **R2 Object Storage** → enable it. Cloudflare asks for a
payment method even if you stay within the free allowance.

## 2. Create the two buckets

R2 → **Create bucket**, twice:

- `heynaija-uploads`
- `heynaija-media`

For **location**, choose a hint close to the audience. There is no African region;
Western Europe is the nearest to Nigeria. Leave jurisdiction at the default.

## 3. Make only the media bucket public, on your own domain

Open `heynaija-media` → **Settings** → **Public access** → **Custom domains** →
connect a subdomain such as `media.heynaija.ng` (the domain must be on Cloudflare).

- Do **not** enable public access on `heynaija-uploads`.
- Do **not** use the `r2.dev` address in production; Cloudflare rate-limits it and
  intends it for development.

## 4. Allow browser uploads to the uploads bucket (CORS)

`heynaija-uploads` → **Settings** → **CORS policy** → add, replacing the origin
with the site's real address:

```json
[
  {
    "AllowedOrigins": ["https://heynaija.ng"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Add the staging origin too if staging uses the same bucket (better: give staging
its own pair of buckets).

## 5. Clean up abandoned uploads automatically

`heynaija-uploads` → **Settings** → **Object lifecycle rules** → add rules that
delete objects **1 day** after upload, **for the prefixes `avatars/` and `posts/`
only**. The API already deletes uploads it has processed and clears abandoned ones
hourly; these catch the rest.

Also add a rule to **abort incomplete multipart uploads after 7 days** (R2: *Abort
incomplete multipart uploads*). Video is uploaded in parts straight to this bucket
(ADR 0019); parts of an upload nobody finished are stored, and billed, until it is
aborted. The API aborts them itself (the hourly sweep, and account deletion), so this
is only a backstop for a sweep that failed, not the mechanism.

**Do not** add a rule for the whole bucket. The `quarantine/` prefix holds images
moderators took down and uploads the abuse-material scanner blocked. They are
kept as evidence and must survive (see `docs/safety/abuse-material-scanning.md`).

## 6. Create an API token for the app

R2 → **Manage R2 API tokens** → **Create API token**:

- Permission: **Object Read & Write**
- Apply to **specific buckets only**: `heynaija-uploads` and `heynaija-media`
- No expiry, or a long one with a calendar reminder to rotate it

Cloudflare shows an **Access Key ID** and **Secret Access Key** once. Store them in
the production secret store, not in the repository.

Your **Account ID** is shown on the R2 overview page.

## 7. Configure the apps

API (`apps/api`) environment:

```bash
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=<from step 6>
S3_SECRET_ACCESS_KEY=<from step 6>
S3_UPLOADS_BUCKET=heynaija-uploads
S3_MEDIA_BUCKET=heynaija-media
```

Web app (`apps/web`): the API returns image paths like `/media/avatars/<id>/96.webp`
or `/media/posts/<id>/640.webp`
on the site's own domain, so `/media/*` must reach the media bucket. Two ways:

- **Simplest (fine for the pilot):** let the web app proxy it.

  ```bash
  MEDIA_INTERNAL_URL=https://media.heynaija.ng
  ```

  Image bytes then pass through the web server. Avatars are a few kilobytes and
  feed-sized post images tens of kilobytes, so this is fine at pilot scale; it is
  the first thing to move to the edge if traffic grows.

- **Better at scale:** serve `/media/*` at Cloudflare's edge so requests never
  reach the server, for example with a small Worker bound to the media bucket on
  the route `heynaija.ng/media/*`. Not built yet.

Do **not** run `pnpm media:init` against R2. It only creates local MinIO buckets
and refuses to run against any other address.

## 8. Check it works (on staging first)

1. Sign in, open **Settings**, add a profile photo. It should appear within a few
   seconds.
2. Check the browser's network panel: one `PUT` to `<ACCOUNT_ID>.r2.cloudflarestorage.com`
   returning 200, with no CORS error.
3. Open the photo's address directly: `https://<site>/media/avatars/<id>/256.webp`
   should load, with `cache-control: public, max-age=31536000, immutable`.
4. Confirm the raw upload is not public: `https://media.heynaija.ng/avatars/<id>`
   (no size suffix) should **not** return the image.
5. Confirm R2 enforces the signed size: the API tests cannot check this against R2.
   Request an upload URL (`POST /api/v1/me/avatar/upload` with a declared `bytes`),
   then `PUT` a file of a different size to it; R2 should refuse with 403. If it
   accepts it, tell whoever maintains the API: the server-side size check still
   protects us, but the storage-level guard would not be working.

## Before opening uploads beyond invited testers

- **Scan for known child sexual abuse material.** Follow
  `docs/safety/abuse-material-scanning.md`: a hash-matching scanner in the API, and
  Cloudflare's CSAM Scanning Tool on the hostname that serves `/media`. This is a
  legal and safety obligation, not an optional extra.
- **Let the API purge Cloudflare's cache when a moderator takes an image down.**
  Removal moves the files out of the public bucket at once, but a cached copy can
  be served for up to a year. The API purges it when `CLOUDFLARE_ZONE_ID` and
  `CLOUDFLARE_PURGE_TOKEN` are set; see `docs/safety/abuse-material-scanning.md`.
- Decide how long deleted media is kept (today: deleted immediately on replace,
  remove, or when an author deletes a post) and write it into the privacy policy.
