# End-to-end tests: real browsers against the local stack

Playwright drives Chromium through the same pages members use, against the dev
stack on this machine: Next.js on :3000, the API on :4000, Kratos, Postgres,
Redis, MinIO and Mailpit from `pnpm infra:up`. Everything is in [`e2e/`](../e2e).

## What they cover

Each file is one area. Every test creates its own members through the real
invite and sign-up flow, so tests do not depend on each other or on what is
already in the database.

| File | Flows |
| --- | --- |
| `auth.spec.ts` | Join with an invite code, sign up, confirm with the emailed code, land signed in. A wrong invite code is refused. Joining needs the "I am 18 or older" box, and a signup that loses the confirmation is refused by the API (no Kratos identity is created). Sign out, sign back in with an emailed code. |
| `handles.spec.ts` | Signing up with a handle someone already has is refused; so is renaming to one in Settings, while renaming to a free one works. A handle given up by renaming cannot be taken by anyone else, its old profile link leads to the new handle, and its owner can take it back. |
| `posting.spec.ts` | Post to everyone and into a community; reply in a thread; like (changes at once and survives a reload); bookmark and find it under Bookmarks; delete your own post. |
| `images.spec.ts` | Attach one to four images, including mixed portrait and landscape shapes, and check the composer and tiled previews fit. Open the viewer from a feed and a focused post; check controls stay on screen, long descriptions fit, and navigation, swipes and closing work. Quote a four-image post and check its previews before and after posting. |
| `menus.spec.ts` | Profile, post, repost and account menus fit and remain tappable at 320, 390, 768 and 1280px. Escape returns focus to the trigger, and the adjusted profile menu still performs its action. Scrolling a post with its menu open keeps it below the top bar and sticky feed tabs. |
| `sharing.spec.ts` | The custom share popup works for signed-out visitors on phones and desktops without invoking native sharing. It previews the post, encodes the correct links for WhatsApp, X, Telegram and Facebook, copies the full post URL with feedback, and offers a selectable link when clipboard methods fail. Keyboard focus, Escape and backdrop dismissal, light/dark themes and 320–1280px layouts are checked. A post page fetched as WhatsApp has the author, text and an absolute picture in its Open Graph tags. |
| `reposts.spec.ts` | Repost from Latest (the control changes at once and survives a reload); the reposter's follower sees it in Following with "@… reposted", and so does their profile ("You reposted" for themselves). Quote it: the composer shows the quoted post, posting opens the quote with the post inside. The author is notified of both. Deleting the original removes the repost and leaves "This post is no longer available." in the quote. |
| `social.spec.ts` | Follow someone and see their post in Following with "You follow @…"; mute hides their posts from Latest; block hides them both ways. |
| `moderation.spec.ts` | A member reports a post; a moderator sees it in the queue and removes it; the author is notified and the post is gone. A suspended member sees the appeal form, appeals, and the moderator sees the appeal. |
| `feed.spec.ts` | Infinite scroll on a feed with more than 150 posts: batches load as you near the end, stop at 150, the button loads more, no post appears twice, and Back from a post restores the list and the scroll position. A failed load shows "Try again". |
| `governance.spec.ts` | The rules, privacy policy, charter and licence pages load, say they are drafts and link the draft constitution. `/governance` states the founding-stage notice, tells the three kinds of participation apart, and shows empty states rather than records; no ownership milestone claims completion; no sideways scroll on a phone. The constitution has all 14 articles, both annexes and working anchors. The verification explainer has no form fields and no verify button, its FAQ opens, and the tick's note shows on focus and closes with Escape. Membership says registration has not opened and that the 18+ account rule is temporary while voting needs a checked age; the rules and privacy policy say the same. A member's Settings shows their real status, including a stated (not verified) age, and their profile has no tick. The data export (format 3) holds their age record, marks ordinary posts with `quoteOf: null`, and includes their repost list. |
| `no-js.spec.ts` | With JavaScript off: read a feed, follow "Older posts" to the next page, post from the composer, like a post. **Currently marked as expected failures**; see below. |
| `information.spec.ts` | Signed-out About and Progress reading without JavaScript, plus light/dark theme reading with JavaScript; every registry feature, derived counts, public caveats, priority anchors, and no internal evidence in public text. Signed-in account-menu navigation, public entry points, and 320px layouts on desktop and mobile. These static pages do not fix the known streamed social-page limitation. |

Tests tagged `@mobile` also run on a phone-sized screen (Pixel 7), including
signing up, the "+" new-post button, sharing, quotes, image previews and viewers,
post-card navigation, and menus.

**Status (15 October 2026):** 25 tests, then 3 more for the governance pages and data export (passing). Two full runs on a laptop against
`next dev`: 22 pass, 2 fail as expected (no JavaScript, below), 1 is phone-only and
skipped on desktop. A run takes 5 to 7 minutes with 2 workers; more workers
overload `next dev` and sign-ups start timing out.

## Found by these tests: pages do not work without JavaScript

PLAN.md §0 says core reading and posting work without JavaScript. They do not at
the moment. Pages render their per-visitor content inside `<Suspense>` (Cache
Components requires that for anything read from cookies), and Next streams that
content into the page with an inline script. With JavaScript off the script never
runs, so the main column stays on its loading skeleton. `no-js.spec.ts` is marked
`test.fail` so the suite stays green; when it is fixed those tests will start
passing, Playwright will report that, and the marks come off.

## Running them

The dev stack must be up (`pnpm infra:up`) and the API built at least once
(`pnpm dev:api` does that). Then:

```bash
pnpm e2e
```

Playwright reuses `pnpm dev:web` and `pnpm dev:api` if they are already running
and starts them otherwise. The first time, install the browser:

```bash
pnpm --filter @heynaija/e2e exec playwright install chromium
```

Useful variants: `pnpm e2e --ui` (watch tests run), `pnpm e2e feed` (one file),
`pnpm e2e --project=mobile`. A failed test keeps a trace:
`pnpm --filter @heynaija/e2e exec playwright show-trace <path>`.

## In CI

The `e2e` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the
suite on every push and pull request:

1. starts the dev stack with Docker Compose (`pnpm infra:env`, `pnpm infra:up`) and
   waits for Kratos and Mailpit;
2. builds everything, migrates, seeds the communities and creates the buckets;
3. starts a production build of the API and the web app (`start`, not `dev`), with
   `API_HOST=0.0.0.0` so Kratos's container can reach the invite webhooks on Linux;
4. installs Chromium and runs `pnpm e2e` with `CI=true`: one worker, one retry.

On failure it uploads the Playwright report, traces, screenshots and the API, web
and Compose logs as the `e2e-report` artifact, kept 7 days.

The deploy workflows call CI, so a staging or production deploy also waits for
this job. A deploy workflow can pass `e2e: false` to skip it.

## Test data

- Members are named `e2e_<run>_<role>` with emails `@e2e.test`; invites carry the
  note `e2e`. Sign-in and sign-up codes are read from Mailpit, as
  `loadtest/sessions.mjs` does.
- Each run first deletes what earlier runs left: those members, everything they
  did, their invites and their Kratos identities. A failed run's data stays until
  the next run, so it can be inspected. `pnpm --filter @heynaija/e2e clean`
  removes it on demand.
- Moderators are granted with the API's own CLI (`apps/api/dist/cli/moderator.js`),
  invites created with `create-invite.js`.
- The feed tests insert their posts straight into Postgres, because the API would
  rightly rate-limit one member posting that fast. They are dated a day back, so
  they fill that member's profile without pushing other tests' posts out of Latest.

The setup refuses any database that is not on a loopback address, or whose name
mentions staging, production or live. These tests never run against staging.

## Not covered yet

- Google sign-in (needs a real Google account).
- Email or push notifications (not built).
- Mobile Safari and Firefox: only Chromium runs, on a desktop and a Pixel 7 screen.
