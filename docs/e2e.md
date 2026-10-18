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
| `auth.spec.ts` | Join with an invite code, sign up, confirm with the emailed code, land signed in on the welcome flow, and skip it to reach home. A wrong invite code is refused. Joining needs the "I am 18 or older" box, and a signup that loses the confirmation is refused by the API (no Kratos identity is created). Sign out, sign back in with an emailed code. |
| `email-change.spec.ts` | The original email remains active until a code sent to the new address is confirmed. Wrong and expired codes, a different target address, too many attempts, cancellation and resends cannot bypass confirmation. An address another account signs in with is refused before any code is sent. Recent authentication is required; the new email signs in to the same account after confirmation, and the old address is then told about the change. |
| `google-auth.spec.ts` | Real OAuth callbacks against a temporary local issuer with signed test JWTs. A matching existing account confirms one email code, links automatically and keeps its ID after one Google authorization; later Google login is direct. Different or unverified emails, email changes after linking, colliding handles and tampered confirmation identifiers cannot create a mismatched connection. New accounts still need an invite and can complete Google signup. Teardown restores the real local Google provider. |
| `handles.spec.ts` | Signing up with a handle someone already has is refused; so is renaming to one in Settings, while renaming to a free one works. A handle given up by renaming cannot be taken by anyone else, its old profile link leads to the new handle, and its owner can take it back. |
| `posting.spec.ts` | Post to everyone and into a community; reply in a thread; like (changes at once and survives a reload); bookmark and find it under Bookmarks; delete your own post. |
| `images.spec.ts` | Attach one to four images, including mixed portrait and landscape shapes, and check the composer and tiled previews fit. Open the viewer from a feed and a focused post; check controls stay on screen, long descriptions fit, and navigation, swipes and closing work. Quote a four-image post and check its previews before and after posting. |
| `links.spec.ts` | A web address in a post is a link that opens in a new tab and leaves the sentence's punctuation out; the rest of the post still opens it. A long address is shortened on screen and read out in full. A post whose page has been read shows a card with the real host, title and a cut-off description, which opens the page and also shows on the post's own page; an unread address shows only the link. (The API refuses to read pages from this machine, so the card's page is seeded; fetching is covered by the API tests.) |
| `gifs.spec.ts` | A GIF plays in the post, pauses to its first frame and plays again, and opens full screen with its own pause button; the stored file really is animated and the still is not. A reader who asks for less motion gets the still first. A quote of a GIF shows the still. A GIF over 10 MB is refused before it is sent. |
| `menus.spec.ts` | Profile, post, repost and account menus fit and remain tappable at 320, 390, 768 and 1280px. Escape returns focus to the trigger, and the adjusted profile menu still performs its action. Scrolling a post with its menu open keeps it below the top bar and sticky feed tabs. |
| `sharing.spec.ts` | The custom share popup works for signed-out visitors on phones and desktops without invoking native sharing. It previews the post, encodes the correct links for WhatsApp, X, Telegram and Facebook, copies the full post URL with feedback, and offers a selectable link when clipboard methods fail. Keyboard focus, Escape and backdrop dismissal, light/dark themes and 320–1280px layouts are checked. A post page fetched as WhatsApp has the author, text and an absolute picture in its Open Graph tags. |
| `reposts.spec.ts` | Repost from Latest (the control changes at once and survives a reload); the reposter's follower sees it in Following with "@… reposted", and so does their profile ("You reposted" for themselves). Quote it: the composer shows the quoted post, posting opens the quote with the post inside. The author is notified of both. Deleting the original removes the repost and leaves "This post is no longer available." in the quote. |
| `mentions.spec.ts` | A post naming another member links their @handle to their profile, leaves a handle nobody has as plain text, and its other text still opens the post. The member named sees "mentioned you" in Notifications, which opens the post; the author, who also named themselves, is not notified. |
| `notification-preferences.spec.ts` | Settings offers one box per kind of other members' activity, all ticked, plus one for email (ticked for a new member), and says safety and moderation notices are always sent. A member unticks likes and saves, and the choice survives a reload. Another member likes and replies to their post: they have one unread notification, the reply, and none for the like. |
| `notification-emails.spec.ts` | Notification emails, read from Mailpit. A reply is not emailed at once (the notification is in the app, the email waits) and, once the test ages it past the delay, arrives with the reply's text, why it was sent, a link to Settings and `List-Unsubscribe` and `List-Unsubscribe-Post` headers. The link in the body works from a browser signed in as nobody, lands on "Email notifications are off", turns off the email box and nothing else in Settings; a tampered link changes nothing and says so; later activity is a notification in the app and no email. Two likes and a follow make one email ("3 new notifications"), still one after the job has looked again; a mail program's one-click `POST` to the header's address unsubscribes (twice is harmless, a forged one is refused). Email can be switched off in Settings and stays off after a reload, with no email for what happens meanwhile; switched on with likes off, the reply is emailed and the like is not, and the reply from while email was off is not sent. A moderator's removal and its report outcome are emailed in general words, with nothing from the post and no reason. |
| `onboarding.spec.ts` | A newcomer is sent from home to `/welcome` until they finish or skip it. They choose two communities (with descriptions and member counts), are suggested the people posting in them, follow two, and land on Following with a nudge to post, where those people's posts show with "You follow @…"; home no longer sends them back, the communities show as joined and the people followed are notified. Both steps fit a 320px screen. Skipping the whole flow lands on home and is remembered after signing in again; each step can also be skipped on its own. |
| `social.spec.ts` | Follow someone and see their post in Following with "You follow @…"; mute hides their posts from Latest; block hides them both ways. |
| `moderation.spec.ts` | A member reports a post; a moderator sees it in the queue and removes it; the author is notified and the post is gone. A suspended member sees the appeal form, appeals, and the moderator sees the appeal. |
| `feed.spec.ts` | Infinite scroll on a feed with more than 150 posts: batches load as you near the end, stop at 150, the button loads more, no post appears twice, and Back from a post restores the list and the scroll position. A failed load shows "Try again". |
| `governance.spec.ts` | The rules, privacy policy, charter and licence pages load, say they are drafts and link the draft constitution. `/governance` states the founding-stage notice, tells the three kinds of participation apart, and shows empty states rather than records; no ownership milestone claims completion; no sideways scroll on a phone. The constitution has all 14 articles, both annexes and working anchors. The verification explainer has no form fields and no verify button, its FAQ opens, and the tick's note shows on focus and closes with Escape. Membership says registration has not opened and that the 18+ account rule is temporary while voting needs a checked age; the rules and privacy policy say the same. A member's Settings shows their real status, including a stated (not verified) age, and their profile has no tick. The data export (format 7) holds their age record, marks ordinary posts with `quoteOf: null` and no mentions, includes their repost list, has every kind of notification on and email on, and says when they skipped the welcome flow. |
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
and starts them otherwise. `google-auth.spec.ts` restarts Kratos with a local
test issuer in place of Google, which would cut off other tests' sign-ins, so it
has its own projects (`google`, `google-mobile`) that run after everything else;
teardown restores the normal Google configuration. To run only those:

```bash
pnpm e2e:google
```

(`pnpm e2e google-auth` works too, but runs the whole desktop and mobile suites
first, because the Google projects depend on them.) The first time, install the
browser:

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
- Notification emails go out after a delay (five minutes by default) so a burst
  becomes one email. The email tests do not wait: `ageNotifications` in
  `e2e/lib/db.ts` makes a member's notifications look ten minutes old, and
  `emailWhere` in `e2e/lib/mailpit.ts` waits for the email job (which looks every
  five seconds with the `.env` that `pnpm infra:env` writes, every minute without)
  and reads the message in full. The API sends through Mailpit's SMTP port, 1026,
  published by `pnpm infra:up`; if you had the stack running before this existed, run
  `pnpm infra:env` and `pnpm infra:up` again. Opening Notifications marks them read,
  and what has been read is not emailed, so those tests do not open it first.
- The feed tests insert their posts straight into Postgres, because the API would
  rightly rate-limit one member posting that fast. They are dated a day back, so
  they fill that member's profile without pushing other tests' posts out of Latest.

The setup refuses any database that is not on a loopback address, or whose name
mentions staging, production or live. These tests never run against staging.

## Not covered yet

- Live Google consent and Google Cloud client configuration (needs a real Google account). The callback and linking behavior is tested with a local signed OIDC issuer.
- Push notifications (not built). Email notifications are covered against Mailpit; delivery through Resend (SPF, DKIM, inbox placement) is checked by hand on staging.
- Mobile Safari and Firefox: only Chromium runs, on a desktop and a Pixel 7 screen.
