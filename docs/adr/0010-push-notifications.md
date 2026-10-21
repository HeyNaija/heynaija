# ADR 0010 — Push notifications are per browser, decided when they are sent, and replace email for what they carry

**Date:** 21 October 2026 · **Status:** Accepted

## Decision

A member can have their notifications **pushed** to a browser: the phone, tablet
or computer shows them as they happen, even with HeyNaija closed. It is turned on
in Settings, on the device itself (**Turn on push notifications**), because push
belongs to a browser, not to an account. What notifies a member at all is
unchanged: the per-kind choices (migration 0018) decide that, so a kind switched
off is neither shown, nor emailed, nor pushed. Replies, likes, reposts, quotes,
mentions, follows and every moderation notice can be pushed.

- **Push replaces email for what it carries.** A notification a browser took is
  not emailed as well (`notifications.pushed_at`). Email waits until the push side
  has dealt with a notification, which is seconds, so the two never race. A
  member who pushes everything and reads nothing gets no email; one whose browser
  is off, or who has no browser, still does.
- **Fast, not grouped by waiting.** Email waits five minutes for company; a push
  goes within about **10 seconds** (`PUSH_SWEEP_EVERY_S`). Instead of waiting, a
  push **replaces** the one already on the device: everything about one post is
  one notification there (the `tag`), so a second like turns "@a liked your post"
  into "@b and @a liked your post" without a second buzz. Likes, reposts and
  follows already pushed and still unread are counted in for a day. More than
  three things at once are one push that says how many.
- **Same words as the email** (`apps/api/src/email/digest.ts`, ADR 0009): a reply,
  quote or mention shows the first 80 characters of the post, a like or repost
  the start of the member's own; moderation decisions are stated in general words
  with no post text and no reason. A push shows on a lock screen like an email
  subject does, so the same care applies.
- **Who is on the device decides.** A browser has one subscription. Turning push on
  in a browser that pushed someone else's notifications moves it to whoever is
  signed in now. Signing out removes it (a cookie, `hn_push`, names it for
  `/logout`). A session that simply runs out does not sign out, so every page
  load (once per tab) asks the API whose subscription the browser has, and the API
  stops one that is not the signed-in member's. Only one member gets push in a
  browser at a time.

## Where it works

- Android: Chrome, Edge, Samsung Internet, Firefox, Opera and Brave, in the
  ordinary browser, with no install, even when the browser is closed. Phones with
  aggressive battery savers can delay them.
- Desktop Chrome, Edge, Firefox and Safari, while the browser is running.
- iPhone and iPad: only on iOS 16.4 or later, in HeyNaija added to the Home Screen
  and opened from there. Settings says so in a Safari tab, where push does not exist.
- Browsers without service workers (Opera Mini's data-saving mode, for one) get
  nothing; Settings says so, and the app and email are unchanged.

## How

- **A notification never waits on a push.** `notify` is unchanged and does not
  know push exists. `notifications.push_settled_at` marks one the push side has
  dealt with: pushed, or passed over (migration 0022 settled everything before it).
- **Decided at the moment of sending.** A BullMQ job (`apps/api/src/push/push-queue.ts`,
  in the API process like the other workers) runs `sweep` every 10 seconds: it
  settles what nothing will be pushed for (read, a suspended member, no browser to
  push to, older than ten minutes), then queues one `push` job per member with
  something waiting. That job reads what is true then, with the same rules as the
  notification list and the email: nothing from a blocked, muted or suspended
  member, about a post taken down, a like taken back, or a kind opted out of since.
- **Web Push, with our own keys.** The API encrypts each message for the browser's
  keys (RFC 8291, aes128gcm) and signs the request with a VAPID key pair (RFC 8292,
  `PUSH_VAPID_PUBLIC_KEY` and `PUSH_VAPID_PRIVATE_KEY`, made by `gen-env.sh`); the
  browser's push service (Google, Mozilla, Apple or Microsoft) carries it without
  being able to read it. No account with any of them, and no fees. `web-push`
  does the cryptography; the request is sent with `fetch`, with a 10-second limit
  and no redirects. Messages are kept for a day for a phone that is off.
- **Only push services.** A browser gives us an address and the server then sends
  to it, so an address on any host other than the four push services is refused
  (`isPushServiceUrl`); otherwise a made-up subscription could aim the server at
  its own network. `PUSH_ALLOW_LOOPBACK` adds `http://127.0.0.1` for the
  end-to-end tests' stand-in push service, and is refused unless the site itself is
  on 127.0.0.1.
- **Failures.** A browser whose push service no longer knows it (404, 410) is
  forgotten. One that refuses a message for good (another 4xx) is passed over and
  kept. If any browser took the push, it counts as pushed; if none could be
  reached (5xx, 429, no answer), the job is retried four times over about two
  minutes, and after ten minutes what was waiting is left to email.
- **The service worker** (`apps/web/public/sw.js`) shows notifications, opens what
  a tapped one is about (only paths on the site), and tells the API when a push
  service gives the browser a new address. It has no fetch handler and caches
  nothing, so it changes nothing about how pages load.
- **Without keys** nothing is pushed, the worker does not start, Settings does not
  offer push and email does not wait.

## Costs

- A browser that gets the push but whose screen nobody looks at is never emailed
  about it. That is the trade the member makes by turning push on, and Settings
  says so.
- Delivery is at-least-once for each browser: a crash between sending and settling
  pushes the same thing again, which replaces itself quietly on the device.
- A push service learns when a member gets notifications, though not what they say.
- Changing the VAPID keys cuts off every subscribed browser until each member turns
  push on again there: Settings then shows push as off in that browser, and turning
  it on replaces the old subscription.

## Not done

- Choosing push per kind, or quiet hours. The kinds decide notifications, and push
  follows, as email does.
- Clearing a notification from other devices once it is read on one, and the app
  icon's unread badge.
- A list of the browsers that get push, with a way to remove one from elsewhere.
  Signing out there, or turning push off there, does it.
