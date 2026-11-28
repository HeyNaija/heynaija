# GIFs from a provider (GIPHY today)

- **We do not scan them.** A GIF picked from a provider is never uploaded to us: the post
  keeps only the provider's name and the GIF's id (`posts.gif_provider`, `posts.gif_id`,
  with the author's description in `gif_alt`) and every reader's browser loads it from the
  provider. The upload scanners ([abuse-material-scanning.md](abuse-material-scanning.md))
  never see it, so "every image is scanned" holds for pictures members upload, not for
  these. The provider moderates its own library.
- **GIPHY results are limited to G and PG** (`rating: 'pg'` in the search). That is a filter
  on the member's search, not a check on the post: the API accepts any well-formed id
  (for GIPHY letters and digits, up to 32), so someone sending the request by hand could
  name a GIF the search would not have offered.
- **No address is made from what a post says.** The provider must be one the API knows
  (`apps/api/src/gifs/registry.ts`) and the id must fit that provider's rule; the database
  refuses any name or id outside one narrow shape (`posts_gif_check`). The web app builds a
  media address only for a provider it knows and an id that fits it; anything else shows
  "GIF unavailable" and fetches nothing.
- **Members' browsers contact the provider**: to search (their IP address, the words
  searched for, the key, and for GIPHY the SDK's pingback id: a random id the library makes
  once per browser session, keeps in `sessionStorage` as `giphyPingbackId` and sends with
  every request, trending included) and to show a GIF (their IP address, the GIF asked for).
  Readers' browsers do the same for every post with a GIF, without a referrer. A reader
  saving data gets a tap-to-load placeholder first. Every GIF has Pause and Play, and one
  who asks for less motion starts on the first frame; for them the search results and the
  GIF picked in the composer are first frames too. This differs from link previews, which
  our server fetches so readers' browsers never contact the linked site (ADR 0008).
- **Moderation.** The report queue (site-wide and community moderators alike) shows a
  reported GIF, loaded from its provider, with its description and the label "GIF from
  GIPHY, not scanned by us"; it plays without a tap (it can be paused). A GIF from a
  provider the app cannot show is labelled so, with its description. A post with a GIF can
  be removed like any other.
- **Erase and export.** The provider, id and description go with the post's text when an
  account is erased or the retention sweep blanks a deleted post (ADR 0016), and are in the
  data export (`posts[].gif`, `heynaija-export/23`).
