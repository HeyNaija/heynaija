# ADR 0008 — The server reads linked pages, only from the public web, and keeps the picture

**Date:** 18 October 2026 · **Status:** Accepted

## Decision

A web address in a post (`http://`, `https://` or `www.`) is a link. The **first**
address in a post also gets a **preview card**: the page's title, the start of its
text, its host name and a picture. The server reads the page once, in a background
job, and every post that links there shares the result. A post is made whether or
not the page can be read; the card appears a few seconds later, if at all.

## Why

- Readers' browsers never contact the linked site. A card that loaded the site's
  own picture would tell it who is reading, and would let the site swap the
  picture after the post is made. The picture is copied to our storage instead.
- The page's own words are shown as plain text under the real host name (not the
  site's name for itself), so a card cannot pass one site off as another.
- One read for everyone keeps the work bounded: a post links to one page, a page
  is read at most once a week (a failed one once an hour), and the member's post
  rate limit is the only way to ask.

## The risk, and what answers it

Fetching an address a stranger chose can be turned on us (server-side request
forgery): a post linking to `http://169.254.169.254/` or `http://localhost:6379/`.

- Only `http` and `https`, ports 80 and 443, no login in the address.
- Every connection, including each redirect (at most three), goes to an address
  checked **when connecting** (`SafeFetcher` in `apps/api/src/links/safe-fetch.ts`):
  loopback, private, link-local (cloud metadata), carrier-grade NAT, multicast,
  documentation and reserved ranges are refused, as are IPv6 forms that carry an
  IPv4 address (mapped, NAT64, 6to4). A name that resolves to any refused address
  is refused. Checking at connect time, not once beforehand, leaves a hostile name
  server no gap to change its answer in.
- A page is read as far as 512 KB and for six seconds in all; only HTML is read,
  and only uncompressed (so a small download cannot unpack into a large one). An
  image over 4 MB is refused.
- The picture is decoded and redrawn by `sharp` from an allow-list of raster
  formats (SVG is code and is refused), at most 25 million pixels, and goes
  through the same `ContentScanner` as every upload. Icons and logos are left off.
- Text from the page is cut to a line, stripped of hidden and direction-changing
  characters, and shown as text only.

## Not done

- **Bare domains** (`example.com` with no `www.`) are not linked: too many file
  names and version numbers look like them.
- **Previews for quoted posts**, and for any address but the first.
- **A block list of bad sites.** A card says where it goes; it does not vouch for it.
- **A way for a site to opt out** beyond robots-style crawlers not being consulted.
  The user agent is `HeyNaijaBot`; add `robots.txt` handling if a site asks.

## How

- `posts.link_url` is the first address, without its `#fragment`; `link_previews`
  holds one row per address (migration 0020).
- `LinksService.request` (called by the posts controller after a post is made)
  queues a BullMQ job (`apps/api/src/links/link-queue.ts`); `buildPreview` is the
  job; an hourly job forgets previews nobody links to.
- Addresses in the text are found by `findLinks` (`link-text.ts`) and returned with
  each post, like mentions, so the web app has one definition of what is a link.
  An `@handle` inside an address belongs to the address, not a mention.
