# ADR 0031 — GIFs name their provider, so the provider can change

**Date:** 27 November 2026 · **Status:** Proposed · **Roadmap:** none ·
**Related:** [ADR 0016](0016-account-deletion.md) (erase and retention of the GIF fields),
[ADR 0008](0008-link-previews.md) (why link previews are fetched by our server and GIFs are not),
[deployment/gifs.md](../deployment/gifs.md), [safety/gifs.md](../safety/gifs.md)

## Context

The GIF search was built for GIPHY alone: a `posts.giphy_id` column, a `giphy` field in
the API, GIPHY's media address in every renderer. GIPHY's production key needs a price
agreed with them, so we may move. The likely next provider (KLIPY) has a free key, a REST
API called from the browser, CDN-direct media, and terms of its own: its placeholder and
attribution must show, its content may not be cached or stored, results may not be
reordered or filtered, providers may not be mixed in one result list, and access can be
withdrawn. Tenor's public API has shut down, so it is not an option. None of this had
shipped (migration 0057 was only on the branch), so the shape could still change freely.

## Decision

**A post's GIF is a provider's name and that provider's id: `gif: { provider, id }`.**
The media is never stored; readers' browsers load it from the provider, as before.
A new post sends `gif: { provider, id, description }` and posts read back as
`gif: { provider, id, alt } | null`. Any other key in a new post's `gif`, `alt` included,
is a 400 naming it, so a client that sends the read shape is told rather than losing the
description.

- **Database.** `posts.gif_provider`, `posts.gif_id` and `posts.gif_alt` (the author's
  description), under one check, `posts_gif_check`: provider and id both set or both null,
  a description only with a GIF, and every name and id inside one narrow shape
  (`GIF_PROVIDER_PATTERN`, `GIF_ID_PATTERN` in `packages/db/src/schema.ts`). The provider
  is plain text checked by the API, not a list in the database: adding a provider then
  needs no migration, and a provider dropped later leaves its rows valid.
- **API.** `apps/api/src/gifs/registry.ts` lists the providers a new post may name, each
  with its id rule (narrower than the database's). `GIF_PROVIDERS` (environment, default
  `giphy`) says which of them take new posts; the `giphyGifs` flag still gates GIFs as a
  whole. A provider switched off for new posts keeps its GIFs: posts come back with their
  tag whatever the settings say. The API never calls a provider.
- **Web.** `apps/web/lib/gif/` has one file per provider (`giphy.ts`) implementing
  `GifProvider` (`types.ts`): its label, id rule, search placeholder, attribution and
  credit, its media addresses built from a well-formed id only, and its search, loaded
  when the picker opens. `GifPicker` is the one search box for every provider, keeping
  the placement, press, retry and boundary rules in one place. `NEXT_PUBLIC_GIF_PROVIDER`
  (default `giphy`) picks the composer's provider. Every renderer (posts, replies, quote
  pages, the report queue) draws by the post's own tag; a tag the app does not know shows
  "GIF unavailable" and fetches nothing.

Adding a provider is one adapter file in `apps/web/lib/gif/`, one line in its
`providers.ts` and its key in `composer.ts`, and one entry in the API registry; the
id rule must be the same in both (`apps/web/tests/gif-providers.test.mjs` checks).

## Not done

- **No KLIPY adapter yet.** Its written answers on caching, attribution and revocation
  are outstanding. One provider at a time in the composer fits its "no mixing" rule.
- **The flag keeps its name** (`giphyGifs`): flag overrides are stored by name, and
  renaming it would silently drop any override set on staging or production.
- **Sizes are not stored.** GIFs are drawn in a fixed 4:3 box, as before.

## Security

The id is the only member-supplied part of a media address. It is checked three times:
the API (per-provider rule), the database (narrow shape), and the web (per-provider rule
before building any address). A provider name is looked up as an own property, so
`constructor` or `__proto__` find nothing. An unknown provider is never resolved to a
default; it shows as unavailable.
