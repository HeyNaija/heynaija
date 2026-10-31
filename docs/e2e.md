# End-to-end tests: real browsers against the local stack

Playwright drives Chromium through the same pages members use, against the dev
stack on this machine: Next.js on :3000, the API on :4000, Kratos, Postgres,
Redis, MinIO and Mailpit from `pnpm infra:up`. Everything is in [`e2e/`](../e2e).

## What they cover

Each file is one area. Every test creates its own members with a real invite
and Kratos's real sign-up flow, so tests do not depend on each other or on what
is already in the database. `auth.spec.ts` signs up through the pages (`/join`,
`/signup`, the emailed code, `/welcome`); elsewhere members are signed up over
HTTP (`signUpOverHttp` in [`e2e/lib/members.ts`](../e2e/lib/members.ts)): the
same Kratos flow with the same invite and age cookies, so the API's checks run
as for anyone, but without rendering those pages for every member. Measured on
social and posting (10 tests, 13 members): 73 s and 218 CPU-seconds through the
pages, 49 s and 93 CPU-seconds over HTTP, `next dev`'s share falling from 115 s
to 32 s. Tests where the sign-up form itself is the subject, such as the
refused handles in `handles.spec.ts`, still use the pages.

| File | Flows |
| --- | --- |
| `auth.spec.ts` | Join with an invite code, sign up, confirm with the emailed code, land signed in on the welcome flow, and skip it to reach home. A wrong invite code is refused. Joining needs the "I am 18 or older" box, and a signup that loses the confirmation is refused by the API (no Kratos identity is created). Sign out, sign back in with an emailed code. |
| `email-change.spec.ts` | The original email remains active until a code sent to the new address is confirmed. Wrong and expired codes, a different target address, too many attempts, cancellation and resends cannot bypass confirmation. An address another account signs in with is refused before any code is sent. Recent authentication is required; the new email signs in to the same account after confirmation, and the old address is then told about the change. |
| `google-auth.spec.ts` | Real OAuth callbacks against a temporary local issuer with signed test JWTs. A matching existing account confirms one email code, links automatically and keeps its ID after one Google authorization; later Google login is direct. Different or unverified emails, email changes after linking, colliding handles and tampered confirmation identifiers cannot create a mismatched connection. New accounts still need an invite and can complete Google signup. Teardown restores the real local Google provider. |
| `handles.spec.ts` | Signing up with a handle someone already has is refused; so is renaming to one in Settings, while renaming to a free one works. A handle given up by renaming cannot be taken by anyone else, its old profile link leads to the new handle, and its owner can take it back. |
| `posting.spec.ts` | Post to everyone and into a community; reply in a thread; like (changes at once and survives a reload); bookmark and find it under Bookmarks; delete your own post. |
| `polls-reply-controls.spec.ts` | Create a multiple-choice poll that never expires (a first try with choices differing only in case is refused and keeps the voting and end settings), vote for several options, and open its public voter list. A mentioned-only conversation lets the named member reply while an unrelated member cannot reply to either the root or a nested reply; a signed-out visitor's reply button still leads to the reply and asks them to sign in. |
| `threads.spec.ts` | A post's replies open newest first, with the post author's own first and the rule stated above them; "Oldest first" reorders them, and the author's new reply joins the end of their own. Branches expand, collapse without another request, and page; a reply goes to the post it was aimed at, at the top when newest first, or in its own "Your reply" spot when oldest first until the rest loads, and shows once. Surviving replies stay reachable through deleted and taken-down ones, and a looping conversation stops instead of drawing itself forever. The conversation above a reply is open (no disclosure), the author is labelled on every post of theirs, and the "Post your reply" bar sits under the focused post with its Reply button in view, stays above the bottom tabs on a phone, and for a signed-out visitor is a "Sign in to reply" link in the same place. On a phone, answering a reply keeps that bar and names whom it answers. The lines stay in the gutter: an answer's elbow meets its card's edge at its avatar, the earlier posts are cards joined by short lines in the gaps, and reply text uses the card's full width. |
| `images.spec.ts` | Attach one to four images, including mixed portrait and landscape shapes, and check the composer and tiled previews fit. Open the viewer from a feed and a focused post; check controls stay on screen, long descriptions fit, and navigation, swipes and closing work. Quote a four-image post and check its previews before and after posting. |
| `links.spec.ts` | A web address in a post is a link that opens in a new tab and leaves the sentence's punctuation out; the rest of the post still opens it. A long address is shortened on screen and read out in full. A post whose page has been read shows a card with the real host, title and a cut-off description, which opens the page and also shows on the post's own page; an unread address shows only the link. (The API refuses to read pages from this machine, so the card's page is seeded; fetching is covered by the API tests.) |
| `gifs.spec.ts` | A GIF plays in the post, pauses to its first frame and plays again, and opens full screen with its own pause button; the stored file really is animated and the still is not. A reader who asks for less motion gets the still first. A quote of a GIF shows the still. A GIF over 10 MB is refused before it is sent. |
| `menus.spec.ts` | Profile, post, repost and account menus fit and remain tappable at 320, 390, 768 and 1280px. Escape returns focus to the trigger, and the adjusted profile menu still performs its action. Scrolling a post with its menu open keeps it below the top bar and sticky feed tabs. |
| `sharing.spec.ts` | The custom share popup works for signed-out visitors on phones and desktops without invoking native sharing. It previews the post, encodes the correct links for WhatsApp, X, Telegram and Facebook, copies the full post URL with feedback, and offers a selectable link when clipboard methods fail. Keyboard focus, Escape and backdrop dismissal, light/dark themes and 320–1280px layouts are checked. A post page fetched as WhatsApp has the author, text and an absolute picture in its Open Graph tags. |
| `reposts.spec.ts` | Repost from Latest (the control changes at once and survives a reload); the reposter's follower sees it in Following with "@… reposted", and so does their profile ("You reposted" for themselves). Quote it: the composer shows the quoted post, posting opens the quote with the post inside. The author is notified of both. Deleting the original removes the repost and leaves "This post is no longer available." in the quote. |
| `mentions.spec.ts` | A post naming another member links their @handle to their profile, leaves a handle nobody has as plain text, and its other text still opens the post. The member named sees "mentioned you" in Notifications, which opens the post; the author, who also named themselves, is not notified. Typing `@` and part of a handle offers the member (a bare `@` offers nobody); Enter fills in `@handle `, Escape closes the list, and clicking a member fills them in with the caret still in the box. |
| `hashtags.spec.ts` | A #hashtag in a post links to its page and a #number does not. Another member replies with it in lower case; the tag opens a page titled with it that lists both, newest first. Searching for the hashtag offers that page. A signed-out visitor sees the same page under another spelling, an unused hashtag's page says it has nothing yet, and an address that could never be a hashtag (`/hashtag/2027`) shows the not-found page. |
| `topics.spec.ts` | Three members post the same new hashtag; once the ranking (up to a minute old) is worked out again, a signed-out visitor sees it on `/topics` with "3 members · 3 posts this week", beside the rules with the numbers the API applies. The topic opens its hashtag page with the three posts, and Search lists it before anything is typed. Waits up to 90 seconds for the ranking. |
| `pins.spec.ts` | A member pins a post from the home feed: it is above their profile's Posts list marked "Pinned", and still in its place below; a signed-out visitor sees it too, and the Replies tab has none. Pinning another replaces it, and unpinning leaves nothing above the list. A Lagos moderator (granted with the CLI) pins a welcome post from the community page: it is above Conversations, "Pinned by the moderators"; a member sees it but is offered no pin or unpin. The moderator unpins it, and the test puts back whatever Lagos had pinned before. |
| `notification-preferences.spec.ts` | Settings offers one box per kind of other members' activity, all ticked, plus one for email (ticked for a new member), and says safety and moderation notices are always sent. A member unticks likes and saves, and the choice survives a reload. Another member likes and replies to their post: they have one unread notification, the reply, and none for the like. |
| `notification-emails.spec.ts` | Notification emails, read from Mailpit. A reply is not emailed at once (the notification is in the app, the email waits) and, once the test ages it past the delay, arrives with the reply's text, why it was sent, a link to Settings and `List-Unsubscribe` and `List-Unsubscribe-Post` headers. The link in the body works from a browser signed in as nobody, lands on "Email notifications are off", turns off the email box and nothing else in Settings; a tampered link changes nothing and says so; later activity is a notification in the app and no email. Two likes and a follow make one email ("3 new notifications"), still one after the job has looked again; a mail program's one-click `POST` to the header's address unsubscribes (twice is harmless, a forged one is refused). Email can be switched off in Settings and stays off after a reload, with no email for what happens meanwhile; switched on with likes off, the reply is emailed and the like is not, and the reply from while email was off is not sent. A moderator's removal and its report outcome are emailed in general words, with nothing from the post and no reason. |
| `push-notifications.spec.ts` | Push notifications, through a stand-in push service on 127.0.0.1 (`lib/push.ts`): the page's `PushManager` hands out an address there with real keys, and the test decrypts what the API sends, as a browser would. Needs the API started with `PUSH_ALLOW_LOOPBACK=true` (`pnpm infra:env`); skipped otherwise. Turning push on in Settings stores the browser and survives a reload; another member's reply arrives within seconds with the reply's text, a path to it and a per-post tag; the reply is never emailed although email is on. Turning push off removes the browser, and the next like is emailed without the pushed reply in it. Signing out removes the browser's subscription. An iPhone in a Safari tab is told to add HeyNaija to the Home Screen and offered no button. |
| `onboarding.spec.ts` | A newcomer is sent from home to `/welcome` until they finish or skip it. They choose two communities (with descriptions and member counts), are suggested the people posting in them, follow two, and land on Following with a nudge to post, where those people's posts show with "You follow @…"; home no longer sends them back, the communities show as joined and the people followed are notified. Both steps fit a 320px screen. Skipping the whole flow lands on home and is remembered after signing in again; each step can also be skipped on its own. |
| `discover.spec.ts` | Home opens on Discover, with the tabs Discover, Latest and Following: a stranger's post that the reader's friend reposted shows with "@… reposted", above the friend's own post ("You follow @…"), above a post nobody took part in ("New on HeyNaija"); the page keeps its moment in the address (`at=`). The reader's new post shows at the top as "Your post". Choosing Latest is remembered, so Home opens on it next time, and choosing Discover brings it back. The label beside the tabs leads to `/about/discover` with the numbers the API uses. At 320px the three tabs keep their names on one line. A signed-out visitor opens on Discover with the tabs Discover and Latest, and can switch to Latest and read the rules. |
| `ideas.spec.ts` | A member suggests an idea from the board and lands on its post with the board's panel (Idea, Under review, their own vote). Another member typing a similar title is shown it under "Already on the board", and votes for it on the board instead (2 votes, kept after a reload). A member gets no status form; a Building HeyNaija moderator (granted with the CLI) sets Planned with a note, which shows on the timeline, and the author is told "Your idea is now planned." and the voter "An idea you voted for is now planned.". A problem report started from the account menu on `/c/lagos` keeps that page and the browser, shown to the reporter as private and not to another member; it fits a phone. A visitor reads the board and is asked to sign in to send. |
| `returning.spec.ts` | A like, a repost and a reply made on a post's own page show on the feed's card when the reader goes Back, although Back shows the feed from the browser's memory; taking the like back shows too. |
| `founder-badge.spec.ts` | Once `founder.js` grants it, the Founder badge is a link to `/about#about-origin` on the member's profile whose note ("Founder. …") shows on focus and closes with Escape; it is on their post in Latest, where hovering it shows the note, and not on another member's; it shows in the notification when they follow someone and on their search result; revoked, it is gone from their profile. |
| `social.spec.ts` | Follow someone and see their post in Following with "You follow @…"; mute hides their posts from Latest; block hides them both ways. |
| `moderation.spec.ts` | A member reports a post; a moderator sees it in the queue and removes it; the author is notified and the post is gone. A suspended member sees the appeal form, appeals, and the moderator sees the appeal. |
| `account-deletion.spec.ts` | A member deletes their account from Settings: the page says what is erased and kept and that they have 14 days; a wrong handle is refused and changes nothing; their own handle (typed with an `@` and capitals) signs them out and lands on "Your account will be deleted" with the date, and the API no longer knows the session. Signing back in shows "Your account is being deleted" instead of the feed, and Keep my account brings the feed back. A sign-in made 20 minutes ago is sent through Kratos's "is it you?" sign-in first and comes back to the form. Without JavaScript a wrong handle changes nothing and leads to `/settings/delete/refused/handle`, a prerendered copy of the page with the message above the form (the sign-in-again step redirects straight to Kratos), and the right one deletes the account and signs out. The email saying it will be deleted on a date reaches them. Nothing is erased in those tests: that waits for the grace period. A last test brings the erase forward with the operator's `privacy-request delete-account --now` and waits for the API's worker: the profile then shows "Nothing here" at the same address, the old handle is held in `released_handles`, the address of the erased member's post no longer opens while a neighbour's reply to it stays (under a "no longer available" placeholder) and their like leaves the neighbour's count, Kratos answers 404 for the identity, and "Your HeyNaija account has been deleted" is emailed. Cleaning finds such a member through the privacy request marked `e2e`, since their handle and identity are gone. |
| `feed.spec.ts` | Infinite scroll on a feed with more than 150 posts: batches load as you near the end, stop at 150, the button loads more, no post appears twice, and Back from a post restores the list and the scroll position. A failed load shows "Try again". A reply in a list says "Replying to @handle" (linked to the parent) and previews the parent. "Back to the feed" on a post opened from the feed returns to the same place in it; opened directly, it opens the feed. |
| `governance.spec.ts` | The rules, privacy policy, charter and licence pages load, say they are drafts and link the draft constitution. `/governance` states the founding-stage notice, tells the three kinds of participation apart, and shows empty states rather than records; no ownership milestone claims completion; no sideways scroll on a phone. The v0.3 constitution has all 14 articles, both annexes, founding Schedule 1 and working anchors. The pages distinguish three founding trustees on initial three-year terms, two annual representatives, activation without immediate trustee re-election, legal admission and voluntary equal online participation. The verification explainer has no form fields and no verify button, its FAQ opens, and the tick's note shows on focus and closes with Escape. Membership says registration has not opened and that the 18+ account rule is temporary while voting needs a checked age; the rules and privacy policy say the same. A member's Settings shows their real status, including a stated (not verified) age, and their profile has no tick. The data export (format 11) holds their age record and no pinned post, marks ordinary posts with `quoteOf: null` and no mentions, includes their repost list, has every kind of notification on, email on and no browser getting push notifications, and says when they skipped the welcome flow. |
| `no-js.spec.ts` | With JavaScript off: read a feed, follow "Older posts" to the next page, post from the composer, like a post. **Currently marked as expected failures**; see below. |
| `information.spec.ts` | Signed-out About and Progress reading without JavaScript, plus light/dark theme reading with JavaScript; every registry feature, derived counts, public caveats, priority anchors, and no internal evidence in public text. Signed-in account-menu navigation, public entry points, and 320px layouts on desktop and mobile. These static pages do not fix the known streamed social-page limitation. |
| `sidebar.spec.ts` | The left sidebar fits the window instead of scrolling. A visitor on a tall window sees every link, the button and the whole card with no More menu; a member on 1280×720 sees every link and the button, the card having given way. Shrinking the window from 1100px to 360px tall, for a member and a moderator, checks at each step that nothing overlaps or runs out of the sidebar, no link is lost or shown twice, More holds at least two links, and nothing comes back as the window gets shorter. More opens above its button, closes on Escape and after choosing a link, marks the current page, and stays on screen even at 420px tall. The unread dot moves from Notifications to More when that link does. |
| `loading.spec.ts` | What shows while pages load. The top bar holds no placeholder in the first HTML the server sends (a skeleton there flashed a grey circle before turning into buttons). The feed's heading and tabs stream in apart from its posts and keep their room, invisibly, while they do: the first HTML has that room ahead of the placeholders, and a member moving from Notifications to Home never has placeholders on screen without the heading and tabs above them. The sidebar's links are in the first HTML too, drawn as plain links with an empty row kept for a member's Notifications and room kept for the compose button; the page-load tests record every frame and check that none of those rows, and on a phone neither of the top bar's icons, ever changes place when the member's own version arrives. Placeholders are invisible for their first moments, so a quick load does not flash them. |

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
(`pnpm dev:api` does that). Then name the tests for what you changed:

```bash
pnpm e2e posting
```

That is a file (part of its name will do, and several work), or `-g "<title>"`,
or `--last-failed`. Outside CI, `pnpm e2e` with nothing named refuses: the whole
suite keeps every core busy for many minutes, and CI runs it on every pull
request. To run it all here anyway:

```bash
E2E_ALL=1 pnpm e2e
```

**One run at a time.** Every run starts by deleting all test members, so a second
`pnpm e2e`, from another terminal, checkout, worktree or agent, waits until the
first has finished and says whose run it is waiting for (`pnpm --filter
@heynaija/e2e clean` waits too). The lock is a Postgres advisory lock on the dev
database ([`e2e/lib/lock.ts`](../e2e/lib/lock.ts)), so a run that crashes or is
stopped lets go of it straight away. `pnpm e2e` takes it before Playwright
starts, as Playwright empties `test-results` first; a bare `playwright test`
takes it in global setup, still before anything is deleted.

Playwright reuses `pnpm dev:web` and `pnpm dev:api` if they are already running
and starts them otherwise. `google-auth.spec.ts` restarts Kratos with a local
test issuer in place of Google, which would cut off other tests' sign-ins, so it
has its own projects (`google`, `google-mobile`) that run after everything else;
teardown restores the normal Google configuration. To run only those:

```bash
pnpm e2e:google
```

Because the Google projects depend on the desktop and mobile ones, naming any of
their tests would run those whole suites first (`pnpm e2e auth` matches
`google-auth.spec.ts` too). So a run that names tests leaves the Google projects
out unless it names projects itself, and `pnpm e2e google-auth` points to
`pnpm e2e:google`. The dependency also means that when any desktop or mobile
test fails, Playwright does not run the Google tests at all; the report lists
them as not run, so check for that before reading a red run as one failure.
The first time, install the browser:

```bash
pnpm --filter @heynaija/e2e exec playwright install chromium
```

Useful variants: `pnpm e2e --ui` (pick tests and watch them run),
`pnpm e2e images --project=mobile` (one file's `@mobile` tests, on the phone
screen only). A failed
test keeps a trace:
`pnpm --filter @heynaija/e2e exec playwright show-trace <path>`.

## In CI

The `e2e` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the
suite on every pull request, and on any branch from **Actions → CI → Run
workflow** (pushing a branch alone does not run CI):

1. starts the dev stack with Docker Compose (`pnpm infra:env`, `pnpm infra:up`) and
   waits for Kratos and Mailpit;
2. builds everything, migrates, seeds the communities and creates the buckets;
3. starts a production build of the API and the web app (`start`, not `dev`), with
   `API_HOST=0.0.0.0` so Kratos's container can reach the invite webhooks on Linux;
4. installs Chromium and runs `pnpm e2e` with `CI=true`: three workers, one retry.

On failure it uploads the Playwright report, traces, screenshots and the API, web
and Compose logs as the `e2e-report` artifact, kept 7 days.

The staging deploy calls CI, so it waits for this job; that is the one full run a
release gets. A pull request from `staging` into `main` skips the suite, and the
production deploy ships the images staging is running when the code is the same
([deployment/production.md](deployment/production.md)), calling CI, suite
included, only when it is not. A deploy workflow can pass `e2e: false` to skip it.

## Test data

- Members are named `e2e_<run>_<role>` with emails `@e2e.test`; invites carry the
  note `e2e`. Sign-in and sign-up codes are read from Mailpit, as
  `loadtest/sessions.mjs` does.
- Each run first deletes what earlier runs left: those members, everything they
  did, their invites and their Kratos identities. A failed run's data stays until
  the next run, so it can be inspected. `pnpm --filter @heynaija/e2e clean`
  removes it on demand.
- Moderators are granted with the API's own CLI (`apps/api/dist/cli/moderator.js`),
  the Founder badge with `founder.js`, invites created with `create-invite.js`.
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
- Push delivery through the real push services (Google, Mozilla, Apple, Microsoft), and how the notifications look on each platform: the browsers Playwright drives cannot subscribe with them, so `push-notifications.spec.ts` uses a stand-in, and real devices are checked by hand on staging. Email notifications are covered against Mailpit; delivery through Resend (SPF, DKIM, inbox placement) is checked by hand on staging.
- Mobile Safari and Firefox: only Chromium runs, on a desktop and a Pixel 7 screen.
