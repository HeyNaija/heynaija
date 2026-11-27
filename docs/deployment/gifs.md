# GIFs from a provider (GIPHY today)

Members can search a GIF provider from the post box and attach one GIF. Their browsers
talk to the provider directly (GIPHY's terms ask that calls and media are not proxied),
with a client key. The API never contacts the provider and stores only the provider's
name and the GIF's id there (`posts.gif_provider`, `posts.gif_id`). Why it is built this
way, and how a second provider is added: [ADR 0031](../adr/0031-gif-providers.md).

## The settings

| Setting | Where | Empty or unset | What it does |
|---|---|---|---|
| `NEXT_PUBLIC_GIF_PROVIDER` | web, build time | `giphy` | The provider the composer searches. A name the web app does not know offers no search (the "Add a GIF" button adds a GIF file). |
| `NEXT_PUBLIC_GIPHY_API_KEY` | web, build time | no search | GIPHY's **client** key. |
| `GIF_PROVIDERS` | API, runtime | `giphy` | Providers new posts may name, comma-separated, or `none`. A name the API does not know stops it at boot. |

GIFs already posted are drawn by the provider named on each post, whatever these say: a
provider can be switched off for new posts and its old GIFs keep showing. A post naming a
provider the web app does not know shows "GIF unavailable" and asks nothing of anyone.

Switching provider (when a second one exists) is: build the web with
`NEXT_PUBLIC_GIF_PROVIDER` and that provider's key, and add it to `GIF_PROVIDERS`. The API
answers a GIF from a provider not in `GIF_PROVIDERS` with `feature_unavailable`, so the two
must agree.

## The key

The `NEXT_PUBLIC_*` values are public by nature: they are fixed into the web bundle when
`next build` runs, so a change needs a new web image, not a restart.

The whole path, for each of `NEXT_PUBLIC_GIF_PROVIDER` and `NEXT_PUBLIC_GIPHY_API_KEY`:

1. The repository variable of the same name (GitHub: Settings, Secrets and variables,
   Actions, **Variables**: a variable, not a secret).
2. `.github/workflows/build-images.yml` passes it to the web image as a build argument.
3. `Dockerfile` (`ARG`, in the stage that runs `pnpm build`) exports it to the build.
4. `apps/web/lib/gif/composer.ts` reads them (the one place) and the composer shows the
   GIF search only when the provider is known and its key is set.

`GIF_PROVIDERS` is an ordinary API setting: `infra/deploy/compose.yml` passes it from the
host's `.env`.

Staging and production are built by the same workflow from the same variables, so they use
one key. Setting a `NEXT_PUBLIC_*` value in a host's `.env` does nothing for an image pulled
from the registry; `infra/deploy/compose.yml` forwards them only for a local
`docker compose build`. For `pnpm dev:web`, put them in `apps/web/.env.local`.

**An empty key hides the GIF search entirely** (no request to the provider), and the
"Add a GIF" button keeps adding a GIF file. A wrong key shows "Could not load GIFs from
GIPHY" in the picker.

## Limits and launch

A GIPHY beta key allows 100 requests an hour and 1,000 a day for the whole site, shared by
every member (every time the picker opens it fetches the trending GIFs, one request, then
each search and each "More GIFs" is one more; searching waits for Enter to save them. The
picker sends the SDK's per-session pingback id with each of them). A production key needs a
price agreed with GIPHY, so the `giphyGifs` flag stays off in production, where it is off by
default ([feature-flags.md](../feature-flags.md)), until a provider is settled. The privacy
page (`/privacy`, "Who helps us run it") must name the provider, as a site members'
browsers contact (their IP address, what they search for and, for GIPHY, the SDK's
per-session pingback id), before that.

Safety and privacy notes are in [../safety/gifs.md](../safety/gifs.md).
