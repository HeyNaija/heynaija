# GIF search (Giphy)

Members can search GIPHY from the post box and attach one GIF. Their browsers talk to
Giphy directly (Giphy's terms ask that calls and media are not proxied), with a client
key. The API never contacts Giphy and stores only the GIF's id.

## The key

`NEXT_PUBLIC_GIPHY_API_KEY` is a Giphy **client** key. It is public by nature: it is
fixed into the web bundle when `next build` runs, so a change needs a new web image, not
a restart.

The whole path:

1. The repository variable `NEXT_PUBLIC_GIPHY_API_KEY` (GitHub: Settings, Secrets and
   variables, Actions, **Variables**: a variable, not a secret).
2. `.github/workflows/build-images.yml` passes it to the web image as a build argument.
3. `Dockerfile` (`ARG NEXT_PUBLIC_GIPHY_API_KEY`, in the stage that runs `pnpm build`)
   exports it to the build.
4. `apps/web/lib/giphy-key.ts` reads it (the one place) and the composer shows the GIF
   search only when it is set.

Staging and production are built by the same workflow from the same variable, so they use
one key. Setting it in a host's `.env` does nothing for an image pulled from the registry;
`infra/deploy/compose.yml` forwards it only for a local `docker compose build`. For
`pnpm dev:web`, put it in `apps/web/.env.local`.

**Empty or unset hides the GIF search entirely** (no button change, no request to Giphy),
and the "Add a GIF" button keeps adding a GIF file. A wrong key shows "Could not load
GIFs from GIPHY" in the picker.

## Limits and launch

A beta key allows 100 requests an hour and 1,000 a day for the whole site, shared by every
member (every time the picker opens it fetches the trending GIFs, one request, then each
search and each "More GIFs" is one more; searching waits for Enter to save them. The
picker sends the SDK's per-session pingback id with each of them). Giphy must approve a production key before the `giphyGifs` flag is turned on in
production, where it is off by default ([feature-flags.md](../feature-flags.md)). The
privacy page (`/privacy`, "Who helps us run it") must name GIPHY, as a site members' browsers contact (their IP address, what they search for and the SDK's
per-session pingback id), before that.

Safety and privacy notes are in [../safety/giphy.md](../safety/giphy.md).
