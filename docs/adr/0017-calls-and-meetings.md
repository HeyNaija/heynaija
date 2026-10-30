# ADR 0017 — Calls, meetings and screen sharing on a self-hosted LiveKit server

**Date:** 30 October 2026 · **Status:** Proposed, design only. Nothing is built:
no schema, no migration, no endpoint, no server, no UI. · **Roadmap:**
`calls-and-meetings` (depends on `direct-messages` and `age-verification`, see
the note in the roadmap entry) · **UI spec:** `apps/web/DESIGN.md`, "Calls and
meetings" · **Related:** [ADR 0006](0006-age-status-model.md),
[ADR 0009](0009-notification-emails.md), [ADR 0011](0011-push-notifications.md),
ADR 0016 (direct messages; PR #42, not yet on `staging`),
`docs/governance/under-18-rollout.md`

## Decision

Members can make one-to-one voice and video calls, later join small group
meetings, later share their screen, and much later record. The media server is
**LiveKit, self-hosted on its own small server** (not on the staging box, which
is memory-tight, and not LiveKit Cloud). The API decides who may join which room
and mints short-lived tokens; LiveKit only moves media.

**Owner decision (30 October 2026): self-host LiveKit.** Everything else here is
a proposal. The feature ships dark (off by default everywhere), and calls follow
the same gate as direct messages: 18 or over, age-verified, opted in, both
sides. **Minors are never in a call.**

Facts about LiveKit below come from its documentation, read on 30 October 2026
and cited inline. Anything marked **(verify)** is from memory or an estimate and
must be checked before it is relied on. Prices and version numbers change.

## Context

- No calls, no realtime layer, no private content exist today. Phones are
  low-end Android on patchy, metered data (`apps/web/DESIGN.md`). Staging shares
  a Contabo box with Koinovera (`docs/deployment/staging.md`); production is its
  own netcup server. Neither should carry media.
- Media needs UDP and public IPs. Cloudflare's proxy carries HTTP(S) and
  WebSockets, not WebRTC UDP, so the media server cannot sit behind it
  (**verify** against Cloudflare's current product list; Cloudflare's separate
  TURN/Calls products are not used here).
- ADR 0016 already defines the contact rules (opt-in, verified adults, requests,
  blocks, mutes). Calls reuse them rather than invent a second set.

## 1. Why LiveKit, self-hosted

**Options.** (a) LiveKit Cloud. (b) Self-hosted LiveKit. (c) Self-hosted Jitsi
Meet.

| | LiveKit Cloud | LiveKit self-hosted | Jitsi Meet self-hosted |
| --- | --- | --- | --- |
| Ops | none | one Go service plus a TLS proxy | several services (web, XMPP, focus, bridge); heavier **(verify)** |
| Auth fit | API mints tokens | same | JWT possible, but its own room and user model |
| UI | any, via SDKs | any, via SDKs | its own app, or an iframe; hard to match our 320px design |
| Data and cost control | vendor | ours | ours |
| Licence | service | Apache 2.0 | Apache 2.0 **(verify)** |

LiveKit server is Apache 2.0 (its README, via
[pkg.go.dev](https://pkg.go.dev/github.com/livekit/livekit-server@v1.13.1); the
newest release seen there was v1.13.1, June 2026, **not confirmed on GitHub**).
It is a single binary, scales on CPU and bandwidth, and its token model fits an
API that already knows who may do what.

**Recommendation: (b).** It is the owner's decision, it keeps media and metadata
under HeyNaija's control, and it gives full control of the UI. Jitsi is the
better pick only if we wanted a finished meeting product with no UI work; we do
not. **Keep (a) as a fallback:** the client and API must read the server URL and
keys from config and use only the LiveKit SDKs, so pointing a dev or staging
environment at Cloud is a config change, not a rewrite.

Cloud's published prices, for the cost model below
([livekit.com/pricing](https://livekit.com/pricing), read 30 Oct 2026): Build
free (5,000 participant minutes, 50 GB); Ship from $50/month (150,000 minutes,
250 GB, then $0.0005/min and $0.12/GB); Scale from $500/month. **Verify before
use.**

## 2. Server topology

**One dedicated small VPS, one node, no Redis at first.**

- **Not behind Cloudflare.** The media host gets a **DNS-only** (grey cloud)
  record, for example `rtc.heynaija.ng`, and `turn.heynaija.ng` (names are
  placeholders). The orange-cloud proxy would break UDP.
- **Redis:** not needed for a single node; LiveKit enters distributed mode only
  when Redis is configured, and then Redis is required for the shared data
  store and message bus
  ([distributed mode](https://docs.livekit.io/transport/self-hosting/distributed/)).
  Do not point it at the app's Redis across the internet. If we ever run two
  nodes, give them their own Redis. Egress (recording, stage 4) probably also
  needs Redis **(verify)**.
- **Location:** the closest good-network region to Lagos. Candidates are a
  European city and Johannesburg; **I do not know which is faster to Nigerian
  mobile networks.** Measure round-trip time and loss from Lagos on MTN, Airtel
  and Glo before buying (open question 2).
- **Staging and production:** LiveKit's webhook config takes one signing key
  and a list of URLs, so two environments on one server would each receive the
  other's events. Recommend **one server per environment**: staging first, a
  second for production when the beta leaves the allow-list.

### Ports

From [LiveKit's port list](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
(read 30 Oct 2026):

| Port | Protocol | Use | Open to |
| --- | --- | --- | --- |
| 443 | TCP | HTTPS and WebSocket signalling, via Caddy to LiveKit's 7880 | world |
| 80 | TCP | Let's Encrypt HTTP challenge, redirect | world |
| 7881 | TCP | ICE over TCP, fallback when UDP is blocked | world |
| 7882 | UDP | all media on one port ("UDP mux"); when set, the 50000-60000 range is ignored | world |
| 5349 | TCP | TURN over TLS (built-in TURN) | world |
| 3478 | UDP | built-in TURN/STUN, optional | world |
| 6789 | TCP | Prometheus metrics, only if enabled | private only |
| 22 | TCP | SSH, as on the other servers | deploy key only |

**UDP: one port (7882 mux) over the 50000-60000 range.** Two ports per
participant by default makes a large range to open and review; one port is
simpler to firewall. The cost is that the kernel and LiveKit handle all media
on one socket, which is fine at our scale **(verify under load)**.

**TURN on 443 or 5349.** LiveKit says TURN/TLS defaults to 5349, and to use 443
when there is no load balancer, because 443 is the port restrictive networks
let through. Caddy owns 443 for signalling. Options: (a) TURN/TLS on 5349 and
accept that some networks block it; (b) a second public IP, Caddy on one and
TURN on 443 on the other; (c) TURN on 443 and a TCP-level router in front. **Recommendation:
(a) to start,** because most mobile carriers pass 5349 and 7881/TCP covers a
good share of the rest, and measure how many calls need relay. Move to (b) if
relay failures show up. TURN needs its own domain and a CA-issued certificate
(self-signed does not work); LiveKit needs `turn.domain`, `turn.tls_port`,
`turn.cert_file` and `turn.key_file`
([deployment](https://docs.livekit.io/transport/self-hosting/deployment/)).

**Firewall and Docker.** Docker's published ports bypass ufw (the staging nginx
template says so). Run LiveKit and Caddy with `network_mode: host` **(verify
this is LiveKit's recommended mode)**, so ufw rules are the real rules.

### TLS

Caddy obtains and renews Let's Encrypt certificates for `rtc.` and `turn.` and
proxies 443 to `127.0.0.1:7880`. LiveKit's TURN reads certificate files, so
Caddy's certificate directory is mounted read-only into LiveKit, and LiveKit is
restarted after a renewal **(verify whether it reloads files itself)**.

### Config sketch (`infra/livekit/livekit.yaml`, not final)

```yaml
port: 7880                       # behind Caddy; never published
log_level: info
keys:
  # LIVEKIT_API_KEY: LIVEKIT_API_SECRET, injected from .env, never committed
rtc:
  tcp_port: 7881
  udp_port: 7882                 # single-port mux
  use_external_ip: true
turn:
  enabled: true
  domain: turn.heynaija.ng
  tls_port: 5349
  udp_port: 3478
  cert_file: /certs/turn.crt
  key_file: /certs/turn.key
room:
  auto_create: false             # (verify the key) only rooms the API created
  empty_timeout: 300
  max_participants: 8            # stage 2; the API enforces it as well
webhook:
  api_key: LIVEKIT_API_KEY       # signs webhooks; must be one of `keys`
  urls:
    - https://<webhook host>/internal/livekit/webhook
prometheus_port: 6789            # bound to a private interface (verify the setting)
```

### Compose sketch (`infra/livekit/compose.yml`, consistent with `infra/deploy/`)

Same conventions as `infra/deploy/compose.yml`: a `name:`, the shared `logging`
anchor (10 MB x 5), `restart: unless-stopped`, settings and secrets from an
`.env` the deploy script reads and never commits, images pinned by version (the
LiveKit version is **chosen and verified at build time**, not here), config
rendered into a Compose `configs:` block as Kratos's is.

```yaml
name: heynaija-livekit
services:
  livekit:
    image: livekit/livekit-server:${LIVEKIT_VERSION:?}
    network_mode: host
    command: ["--config", "/etc/livekit.yaml"]
    configs: [{ source: livekit, target: /etc/livekit.yaml }]
    volumes: [caddy-data:/certs:ro]
    restart: unless-stopped
    logging: *logging
  caddy:
    image: caddy:2
    network_mode: host
    volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy-data:/data]
    restart: unless-stopped
    logging: *logging
volumes: { caddy-data: {} }
```

Deploy like the others: a restricted SSH key that can only run a deploy script
(`docs/deployment/staging.md` step 4.4), the repo checked out at a commit on
`staging`, no builder on the box. A `docs/deployment/livekit.md` runbook comes
with the build PR.

### Webhook reachability (a trap)

Staging and production serve only Cloudflare's connections
(Authenticated Origin Pulls, `infra/deploy/nginx/heynaija.conf.template`).
LiveKit's server is not Cloudflare, so its webhook POST would be refused.
Options: (a) a separate DNS-only hostname with an nginx server block that serves
only `/internal/livekit/webhook` and allows only the LiveKit server's IP,
signature checked on top; (b) a private link (WireGuard) between the two
servers; (c) no webhooks, and the API polls LiveKit's room API. **Recommendation
(a).** (c) is the fallback if webhooks prove unreliable, which they may: LiveKit
says delivery is not guaranteed
([webhooks](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/)).

### Sizing and bandwidth (estimates, verify with a load test)

LiveKit's benchmark was a 16-core c2-standard-16: 150 publishers and 150
subscribers in one video room used 85% CPU with about 50 MB/s in and 93 MB/s
out; 10 audio publishers to 3,000 subscribers used 80%
([benchmarks](https://docs.livekit.io/transport/self-hosting/benchmark/)).
Our rooms are tiny, so the limit is more likely bandwidth than CPU.

- **Server:** 2 to 4 vCPU, 4 GB RAM, a 1 Gbps port and a bandwidth allowance of
  several TB a month or unmetered. **Estimate;** the first load test sets it.
  Memory is not the constraint (Go service, no Redis).
- **Per participant, estimates:** audio (Opus, voice) 16 to 32 kbps each way,
  so 0.12 to 0.24 MB per minute; 360p video 300 to 600 kbps, so 2 to 4.5 MB per
  minute; screen share 0.5 to 2 Mbps.
- **Server egress for a room of N with everyone on video** is about N x (N-1) x
  video bitrate. Eight people at 400 kbps is about 22 Mbps per room, which is why
  group video is capped and audio-first.
- **Cap by capacity, not hope.** The API counts live participants and refuses
  new calls past a configured ceiling ("Calls are busy, try again"), so an
  overloaded box degrades by saying no, not by dropping everyone.

### Nigerian mobile conditions (defaults)

- **Audio first.** Every call starts audio-only; the camera is an explicit
  choice. A "Data saver / audio only" switch is on by default when the browser
  reports `saveData` **(verify support)**.
- **Simulcast** on for camera (three layers, the top layer capped at 360p for
  camera; 720p allowed for screen share only), **adaptive stream** and
  **dynacast** on, so each viewer gets the layer that fits their tile and the
  publisher stops sending layers no one watches. These are `livekit-client`
  room options; the documentation describes adaptive stream and receiver-side
  quality caps
  ([subscribing](https://docs.livekit.io/transport/media/subscribe/)) but not
  defaults, so set them explicitly **(verify option names)**.
- **Low-resolution defaults:** 360p at 15 to 24 fps; audio with DTX (silence
  costs almost nothing) and redundant audio on lossy links **(verify)**. Screen
  share favours sharpness over frame rate (5 to 15 fps).
- **Reconnect gracefully:** show "Reconnecting..." and keep the call; do not
  drop to a login page. Mid-call network changes (Wi-Fi to mobile) are the
  normal case.
- Show an approximate data-use line before a video call starts.

### Monitoring, health, backup

- Prometheus metrics on 6789, private only, scraped or checked by hand at
  first; alert on CPU, outbound bandwidth against the allowance, and packet
  loss. An uptime check on `https://rtc.<domain>/` as for the web app
  (**verify** what the root returns). The API also logs a call's join failures
  and reconnect counts (counts, never content).
- **Backup: none.** With no Redis the server holds no durable state; config is in
  git, secrets in `.env`. Rebuild is redeploy. The Caddy volume holds only
  certificates, which are reissued. Recording (stage 4) changes this.

## 3. Auth: the API decides, LiveKit obeys

LiveKit access tokens are JWTs signed with the API secret and carry the room,
the participant identity and grants (`roomJoin`, `canPublish`, `canSubscribe`,
`canPublishSources`) ([tokens](https://docs.livekit.io/frontends/authentication/tokens/)).

- **One endpoint:** `POST /v1/calls/:id/token`, session-authenticated. It runs
  `canJoinCall(member, call)` on live data and returns `{ url, token }`. The
  browser never holds the API secret.
- **Identity** is the member's opaque id, not the handle or email (LiveKit says
  identity and room name appear in logs). **Room name** is the call's uuid. The
  display name goes in the token's `name`, which is already public.
- **TTL: 10 minutes.** The token is for connecting; it is not the session. A
  short TTL bounds how long a removed member could reuse one, and LiveKit
  itself suggests 10 minutes or less
  ([tokens](https://docs.livekit.io/frontends/authentication/tokens/): the
  default is 6 hours, which is far too long). How an already-connected client
  keeps its session after expiry and how reconnects refresh tokens is
  **(verify in the SDK)**; the API must also mint a fresh token on each
  client-initiated reconnect.
- **Grants by role:** guests of a 1:1 call and meeting participants get
  `canPublish` limited to `microphone` and `camera`; `screen_share` is added
  only for a participant the host allowed (stage 3). `canPublishData` is false
  (no data channel; chat stays out of band).
- **Rooms are created by the API** (`CreateRoom` with `max_participants` and a
  short `empty_timeout`), never by a client joining; the server config keeps
  auto-create off **(verify)**.
- **Who may join which room** (checked at token mint, and again when LiveKit
  reports the join):
  1. The member is call-eligible (section 5) and the call is not ended.
  2. 1:1: only the two members of the call.
  3. Meeting: only members the host invited (or admitted from the waiting
     room), under `max_participants`.
  4. No block either way between the member and anyone already in the room or
     invited. A new join that would put a blocker and the blocked together is
     refused with a neutral "You can't join this meeting".
  5. Not on the call's removed list.
- **Kick and revoke.** The API calls LiveKit's room service: remove the
  participant, mute a track, update permissions, or delete the room to end the
  call. Kicking also adds the member to the call's removed list so no new token
  is minted. Without that list, a kick lasts only until the old token's TTL (on
  Cloud, LiveKit documents that a removed participant can rejoin with an
  unexpired token after a 10-minute window; **verify** the self-hosted
  behaviour). A member losing eligibility (block, suspension, lapse of age
  verification) is removed by a sweep every 60 seconds over live participants,
  and cannot get a new token.
- **Webhooks from LiveKit to the API.** `POST /internal/livekit/webhook`. The
  body is read raw and verified with the server SDK's webhook receiver
  (Authorization is a JWT containing a SHA-256 of the body, signed with the
  configured key); a bad signature is a 401 and logged. Events used:
  `room_started`, `room_finished`, `participant_joined`, `participant_left`,
  and (stage 4) `egress_*`. Handlers are idempotent by event `id`. **Delivery is
  not guaranteed**, so a webhook is a hint: call state (ringing, active, ended,
  missed) lives in Postgres, and a job reconciles it against LiveKit's list of
  participants every minute, so a lost `room_finished` does not leave a call
  "active". A `participant_joined` for someone who is no longer eligible gets
  them removed at once.

## 4. Product scope, in stages

Each stage ships behind the flag and is switched on for allow-listed adults
before widening, as in ADR 0016.

1. **1:1 calls (voice, optional video).** Call from a DM thread or an accepted
   conversation's header. Ring for 30 seconds, then "missed call" in the thread.
   Either side can end. Audio-first. No groups, no screen share, no recording.
2. **Small group meetings.** A host creates a meeting, invites specific
   members, gets a waiting room, and has host controls. Up to 8 participants
   (an estimate, set by a load test). No public join links, no guests: everyone
   is an eligible member.
3. **Screen share.** One sharer at a time, host-allowed, in meetings and 1:1.
   Sharing is started from desktop browsers; whether Android and iOS browsers can
   share is **(verify; believed unsupported on most)**, so phones view only.
4. **Recording.** Server-side recording through LiveKit Egress to private R2
   storage, host-started only with every participant's visible consent. Blocked
   on counsel and governance (open questions 5 and 6). Not designed in detail
   here.

Out of scope: guests without accounts, public webinars, phone dial-in (SIP),
live captions in the first three stages (open question 8), virtual
backgrounds, chat inside a call.

## 5. Safety

Calls are live and leave no text for a moderator to read, so the gate is
tighter, not looser.

**1:1 calls follow the DM gate (ADR 0016), and are built on it.** A member is
**call-eligible** only when they are DM-eligible (active, age-verified at
`verified`, DMs opted in) **and** have turned on a separate "Allow calls" switch
(default off). Both sides must be eligible on every call, checked server-side
from live data in one function (`canCall`), the way `canMessage` is.

- **No calls from strangers.** A call rings only inside a conversation that is
  in the recipient's inbox: the recipient follows the caller, or the
  conversation is accepted. Otherwise the caller can only send a **call
  request**, which is a message request (ADR 0016 section 2): the recipient sees
  "[name] would like to call you" in Requests with Accept, Decline and
  Block-and-report. Accepting opens the conversation; it does not start a call.
  The caller is told only "Waiting for [name]". Muted senders' requests go to
  Requests with no notification; blocked ones are refused with the same neutral
  error as DMs.
- **Minors never.** Under-18, unknown-age, `declared`-only and `reviewed`-only
  members are not eligible, so cannot start, receive, join, be invited to or be
  listed in a call, and the UI shows them nothing about calls except the
  Settings prompt to verify. The age rule lives in code, not config, as for
  DMs, with a test that fails the build if it is bypassed. A lapse removes the
  member from any live call within a minute.
- **Rate limits.** Call attempts per member per hour and per recipient, and
  call requests per day, to stop ring-spam. A recipient who declines twice in a
  row suppresses that caller for 24 hours **(proposal)**.
- **Mute and Do Not Disturb.** A muted conversation does not ring. A global "no
  calls" switch is the Settings switch above.

**Group meetings.**

- **Host controls:** invite, admit or deny from the waiting room, mute a
  participant, turn off a participant's camera or screen share, remove (with
  the removed list above), lock the meeting, end it for everyone. Moving the
  host role if the host leaves, to the longest-present participant, never to
  nobody.
- **Waiting room:** a participant who is invited but arrives after the host or
  after the meeting is locked waits; they receive no token until admitted, so it
  is enforced by the API, not the client.
- **Report.** In-call "Report" on a participant or the meeting. With no
  recording the evidence is metadata only: the call id, who was present, join
  and leave times, and the reporter's note. This feeds the existing reports queue
  with a `call` target and the `child_safety` reason from ADR 0016. Block and
  Leave in the same step.
- **Moderator access** to a live or past call is an **open question for
  governance** (question 4). Recommendation: no moderator ever joins a call
  silently or listens in; moderators see report metadata only, as for DMs.
- **No call content in logs.** The API stores call rows and participant times,
  not media. LiveKit logs carry identities (opaque ids), not names.

**Recording** (stage 4, all open): consent must be explicit and visible; a
member who does not consent cannot be in a recorded meeting; retention, who may
view, and how law enforcement preservation works are for counsel (question 5).

**Notifications (ADR 0009 and 0011 rules).** A lock screen is public. Push for an
incoming call: title "Incoming call", body "[display name] is calling", **no
handle, no thread text, never the call's topic**, one notification per call,
replaced by "Missed call from [display name]" or removed on answer. A call
request: "New call request", no name. No email for calls; the digest may carry
"You have a missed call" with a count and a link and no name. Calls on the web
are not like a phone: a web push is a notification, not a ringing screen, and a
browser tab that is closed cannot ring. The call UI says so ("keep HeyNaija open
to receive calls") and the design does not promise reliable ringing.

**Privacy copy** (for counsel, as in ADR 0016 section 8): calls pass through our
server and are not end-to-end encrypted; media is not recorded or stored unless
a recording is announced; the server sees who called whom and when.

## 6. Web client plan

**Options.** (a) `livekit-client` with our own components. (b)
`@livekit/components-react` prebuilt layouts. (c) A mix: `livekit-client` plus
the hooks and headless parts of `@livekit/components-react`.

**Recommendation: (c).** The prebuilt conference UI will not match our
tokens or fit 320px, but the hooks (participants, tracks, connection state)
save real work. Load all of it with a dynamic import on the call route only, so
the feed's bundle does not grow. Bundle size is **unmeasured**; put a budget
check in the build PR.

- **Permissions UX.** A pre-join screen before any browser prompt: who is
  calling, "Join with audio" (default) and "Join with video" buttons, a mic
  level meter and device picker, a preview that never publishes. Ask for the
  microphone on audio joins, the camera only when the camera is turned on. Our
  own explainer comes first ("HeyNaija needs your microphone so others can hear
  you"), then the browser prompt. If denied: a card with how to re-enable in the
  browser, and an option to join listen-only. Never auto-start the camera.
- **320px layout.** One active speaker large, others as a horizontally
  scrolling strip of at most 4 tiles, the rest behind a "People (n)" sheet.
  Controls in a bottom bar of 44px targets (mic, camera, share if available,
  people, end), with the bar visible without scrolling at 320 x 568. Text 16px
  in inputs. Adaptive stream means only visible tiles cost data. Landscape
  hides the strip.
- **Accessibility.** Every control is a button with an accessible name and
  state ("Microphone, on"); full keyboard operation and visible focus; shortcuts
  (M mute, V camera, Esc to leave the people sheet) that do not clash with
  screen readers and are listed in a help dialog. A polite live region
  announces "Ada joined", "Ada left", "You are muted", "Reconnecting", "Call
  ended"; never announce speaking changes continuously. Respect reduced motion
  (no speaking animation beyond an outline). Contrast per DESIGN.md tokens.
  **Captions are an open question** (question 8).
- **Failure states:** no network, token refused ("This call is no longer
  available", never why), server busy, browser unsupported, microphone in use by
  another app.

## 7. Feature flag, rollout and cost

**Flag.** `CALLS_ENABLED` (API env, default `false` everywhere), read by the web
only through `GET /v1/me` as `features.calls`, so a build with it off ships no
live call route. `CALLS_MEMBERS` allow-list of handles for the beta. Settings
`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and the webhook key are
optional in `infra/deploy/compose.yml` (the `:-` pattern), empty means calls are
off. Separate stage switches `CALLS_MEETINGS_ENABLED`, `CALLS_SCREENSHARE_ENABLED`
and `CALLS_RECORDING_ENABLED` (the last locked off in code until counsel
signs off). Flag off ends nothing in the database but refuses new calls; live
calls are ended by deleting their rooms. A kill switch for a stuck server is
the flag.

**Rollout.**

1. This ADR reviewed; open questions answered.
2. LiveKit server stood up for staging, reachable, load-tested from Lagos on
   mobile networks (RTT, loss, relay rate). No feature code yet.
3. Backend (rooms, tokens, `canCall`, webhooks, reconciliation) behind the flag,
   tests first for every rule in section 5 and 3.
4. Web client, 1:1 only, with e2e tests of the flows that can run without real
   media (the gate, tokens, webhooks, UI states) and a manual device matrix.
5. Safeguards sign-off: `age-verification` and `direct-messages` live, privacy
   copy, moderator runbook, governance answers.
6. Enable for a named adult allow-list, then all eligible members; then repeat
   per stage (meetings, screen share).

**Cost model (a sketch; every number is an assumption to replace with
measurement).**

Assumptions: 200 call-eligible members after the beta; 20% make calls in a
month; average 6 calls of 8 minutes each, 80% audio-only; group meetings later.
That is 40 x 6 x 8 x 2 sides = about 3,840 participant minutes a month, rising to
perhaps 20,000 with growth and meetings. Data: audio 0.2 MB/min and video 3
MB/min per participant, so 20,000 minutes at 80/20 is about 20,000 x (0.8 x 0.2 +
0.2 x 3) = about 15 GB a month.

| | Self-hosted | LiveKit Cloud |
| --- | --- | --- |
| Early (about 4,000 min, 3 GB) | a small VPS, **about $10 to $40/month (estimate)**, plus operator time | Build free tier covers it (5,000 min, 50 GB) |
| Growth (about 20,000 min, 15 GB) | the same VPS | Ship at $50/month covers it (150,000 min, 250 GB) |
| Heavy (about 500,000 min, 400 GB) | one larger VPS or two, **$50 to $150/month (estimate)** | roughly $50 + 350,000 x $0.0005 + 150 x $0.12 = about $243/month |

On these numbers Cloud is cheaper or free through the growth stage and
self-hosting wins only at high volume. The reasons to self-host are control,
data location and independence, not money, and the bill that matters early is
operator time (patching, TLS renewal, a 3am server). That is the owner's
decision; this ADR records the trade-off so no one is surprised. Check the
real VPS and bandwidth prices at purchase. Recording adds storage and egress
CPU, not modelled.

## Consequences

- A second server to run, patch, monitor and pay for, with UDP exposed to the
  internet; one more thing that can be down.
- Calls inherit DM's dependencies: nothing is switchable until an age check
  yields `verified` and DMs exist. Until then this feature is design only.
- The webhook path needs a deliberate hole in the Cloudflare-only origin rule.
- Moderators cannot see calls; abuse handling depends on reports and metadata.
- Web ringing is weaker than a phone's; some members will miss calls. We say so.

## Open questions

Each has a recommendation; the PR description repeats them.

1. **Is Cloud acceptable as the interim host** while the server and runbook are
   built (and fallback if the VPS fails)? Recommend yes for dev and staging
   experiments only, never production, because the code is the same.
2. **Where is the server, and which provider?** Needs a measured Lagos test.
   Recommend choosing on measured loss and RTT, not on price.
3. **TURN on 443 (second IP) or 5349?** Recommend 5349 first, measure.
4. **Moderator access to live or past calls?** Recommend none; metadata from
   reports only. Governance decision.
5. **Recording: consent, retention, preservation, lawful requests.** For counsel
   (including Nigerian data-protection duties). Recommend not building stage 4
   until answered, and recording locked off in code.
6. **Is stage 4 wanted at all?** Recommend defer; the privacy and safety cost is
   high for a community platform.
7. **Group size and who may host.** Recommend 8 and verified, opted-in adults
   only; no guests.
8. **Captions.** Options: none; browser speech recognition (unreliable,
   sends audio to the browser vendor); server transcription (cost, privacy,
   and it is a form of recording). Recommend none for stages 1 to 3, and
   revisit with governance; say plainly that calls have no captions.
9. **One server or two (staging and production)?** Recommend two.
10. **Is "no calls without an existing conversation" too strict?** It means
    first contact is always a request. Recommend keep: it is the same rule as
    DMs and the safe default.
11. **Dependencies on PR #42.** `direct-messages` and `age-verification` are
    added to the roadmap when ADR 0016 merges; until then the roadmap entry
    names them in its notes.
