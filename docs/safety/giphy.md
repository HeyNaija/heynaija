# GIFs from Giphy

- **We do not scan them.** A GIF picked from GIPHY is never uploaded to us: the post keeps
  only its id (`posts.giphy_id`, with the author's description in `giphy_alt`) and every
  reader's browser loads it from Giphy. The upload scanners ([abuse-material-scanning.md](abuse-material-scanning.md))
  never see it, so "every image is scanned" holds for pictures members upload, not for
  these. Giphy moderates its own library.
- **Results are limited to G and PG** (`rating: 'pg'` in the search). That is a filter on
  the member's search, not a check on the post: the API accepts any well-formed id (letters
  and digits, up to 32), so someone sending the request by hand could name a GIF the
  search would not have offered.
- **Members' browsers contact Giphy**: to search (their IP address, the words searched
  for, the key) and to show a GIF (their IP address, the GIF asked for). Readers' browsers
  do the same for every post with a GIF, without a referrer. A reader saving data
  gets a tap-to-load placeholder first, and one who asks for less motion gets the first
  frame. This differs from link previews, which our server fetches so readers' browsers
  never contact the linked site (ADR 0008).
- **Moderation.** A reported post with a GIF shows moderators its text only: the queue
  does not yet show the GIF (follow-up). A post with a GIF can be removed like any other.
- **Erase and export.** The id and description go with the post's text when an account is
  erased or the retention sweep blanks a deleted post (ADR 0016), and are in the data
  export (`posts[].giphy`, `heynaija-export/23`).
