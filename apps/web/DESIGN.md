---
name: HeyNaija
description: A Nigeria-first, community-owned social network. White cards on a sage-grey ground, one forest-green voice.
colors:
  forest-green: "#258153"
  forest-green-deep: "#176541"
  sage-wash: "#eaf4ee"
  on-green: "#ffffff"
  pine-ink: "#123b30"
  sage-ground: "#f1f4f2"
  card-white: "#ffffff"
  inset-sage: "#f3f6f4"
  ink: "#10212b"
  slate-muted: "#5c6b76"
  slate-faint: "#8a96a0"
  hairline: "#e3e9e5"
  hairline-strong: "#d3dcd7"
  alarm-red: "#b3261e"
  alarm-wash: "#fbedec"
  ember: "#e8590c"
  ground-dark: "#0b1210"
  card-dark: "#111a17"
  inset-dark: "#18231f"
  ink-dark: "#e6efe9"
  muted-dark: "#9dafa5"
  hairline-dark: "#212d28"
  green-dark: "#3fae79"
  green-bright-dark: "#7dd9aa"
typography:
  headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  body-small:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  chip: "6px"
  control: "8px"
  card: "12px"
  avatar: "9999px"
spacing:
  card-gap: "14px"
  column-gap: "24px"
  card-padding: "22px"
  card-padding-mobile: "18px"
  gutter-mobile: "12px"
  reply-padding: "12px 14px 4px"
  reply-gap: "8px"
  feed-padding: "28px 0 48px"
components:
  button-primary:
    backgroundColor: "{colors.forest-green}"
    textColor: "{colors.on-green}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.forest-green-deep}"
  button-secondary:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.sage-wash}"
    textColor: "{colors.forest-green-deep}"
  card:
    backgroundColor: "{colors.card-white}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-padding}"
  chip:
    backgroundColor: "{colors.sage-wash}"
    textColor: "{colors.forest-green-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "2px 8px"
  field:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "46px"
  nav-item-active:
    backgroundColor: "{colors.sage-wash}"
    textColor: "{colors.forest-green-deep}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
    height: "46px"
---

# Design System: HeyNaija

## Overview

**Creative North Star: "The Town Square Noticeboard"**

HeyNaija is a calm sage wall with clean white notices pinned to it. Every post, notification, form, profile header and side-rail section is its own card. You read it, act on it and move to the next one. The ground stays quiet and the cards stay crisp. One decisive forest green marks everything you can do. The result should feel fresh, tidy and confident: organised and modern, never cold.

The one loud element is the approved bubbly green wordmark. Everything around it is disciplined: one typeface, one accent, one card. Density comes from rhythm (feed cards 14px apart, a 12px gutter on small phones) rather than from cramming. The system is built to stay fast on low-end Android, so depth is a border alone, not shadows, blur or heavy imagery.

The look was redesigned on 14 October 2026 from ruled rows inside a white framed sheet to cards on a tinted ground, using the owner's other project, Koinovera, as the polish reference. The palette, the wordmark and the no-gradients rule were kept from before.

A subsequent UI overhaul on the same date refined the shell proportions, type hierarchy, composer, discovery and account pages. It adds more breathing room and clearer actions while retaining those brand commitments. `app/globals.css` is the source of truth for implemented tokens, shared components and responsive values; this document describes that system.

**Key Characteristics:**
- Flat white cards (12px corners, 1px hairline border, no shadow) on a sage-grey ground, with no framing sheet.
- A single forest-green accent for actions, the current place and links.
- Plus Jakarta Sans throughout, with weight rather than size doing most of the hierarchy work.
- Light, dark and system themes; dark keeps the same structure with deeper greens.
- Small phones get the same cards with 12px gutters and a fixed bottom bar.

## Colors

A restrained palette: tinted neutrals from the sage family plus one forest-green accent, with red reserved for danger.

### Primary

- **Forest Green** (forest-green): primary buttons, the "+" new-post button, the active feed-tab underline, the focus ring and the unread badge. White text on it passes 4.8:1.
- **Deep Forest** (forest-green-deep): the hover for primary buttons; text on sage wash (chips, the active nav pill, "View all" and other text links).
- **Sage Wash** (sage-wash): fills for chips, unread notifications, secondary-button hover and the Treasury symbol.
- **Pine Ink** (pine-ink): headings on sage panels and notice text.

### Neutral

- **Sage Ground** (sage-ground): the page itself. One step under white, so a card reads without a heavy edge. Sticky bars use the same ground so they belong to the layout, not to the cards.
- **Card White** (card-white): every card, field and button-secondary surface.
- **Inset Sage** (inset-sage): quiet fills inside a card, such as community rules, hovered menu items and image placeholders.
- **Ink** (ink): all primary text.
- **Slate Muted** (slate-muted): metadata, helper text and timestamps; 5.5:1 on white, safe for small text.
- **Slate Faint** (slate-faint): decorative only (icons, empty-state glyphs, placeholders in fields). Never for text that has to be read.
- **Hairline** (hairline) and **Hairline Strong** (hairline-strong): card borders; the strong one for field borders and card hover.
- **Alarm Red / Alarm Wash** (alarm-red, alarm-wash): destructive actions and errors only.
- **Ember** (ember): the flame on Trending, and nowhere else.

### Dark theme
Same roles, set on `:root[data-theme="dark"]`: ground-dark for the ground, card-dark for cards, inset-dark for inset fills, ink-dark and muted-dark for text, hairline-dark for borders, green-dark as the accent, and green-bright-dark for text links and the focus ring.

**The One Green Rule.** Forest green is the only accent. It means "you can act here" or "you are here". No second brand colour, no gradients, and no colours borrowed from AI-tool branding.

**The No Grey Text on Colour Rule.** Text on sage wash uses Deep Forest or Pine Ink, never slate.

## Typography

**Body Font:** Plus Jakarta Sans (self-hosted by next/font, weights 400–700), falling back to system-ui.

**Character:** One friendly geometric sans for everything. Rounded enough to sit beside the bubbly wordmark, and plain enough to read at 13px on a cheap phone.

### Hierarchy

- **Headline** (700, 28px, 1.25, -0.045em): page titles, profile and community names; 26px below 1024px and 25px below 420px. Governance uses 30px, the public feed welcome uses 28–38px, and the desktop account welcome uses 42px.
- **Title** (700, 15px, -0.01em): card and section headings. Rail card headings use 13px, under an 18px discovery heading.
- **Body** (400, 15px, 1.6): feed and reply text at every width. Bios use 15px, while focused thread text and fields use 16px. Fields retain 16px to avoid iOS zoom. Post metadata uses 12px.
- **Body small** (400, 13px): helper text and supporting copy. Metadata and rail details use restrained 10–12px steps, usually in Slate Muted.
- **Label** (600, 12px): chips and counters. Page eyebrows use 10px uppercase with 0.12em tracking, and bottom tabs use 11px.

**The Weight Not Size Rule.** Hierarchy steps through 400, 500, 600 and 700 before it reaches for a bigger size. Author names are 600 at 14px; metadata sits beneath them so the post remains easy to scan.

## Layout

- **Desktop (1024px and up):** an open shell inside a 1320px container with 32px side padding, with no frame or sheet.
  - **Left sidebar (210px, sticky, as tall as the window):** approved wordmark, navigation, a 44px "Create a post" action and the existing community illustration card. The links are Home, Communities, Notifications (members only), About HeyNaija, Progress, Governance, Ideas board, Bookmarks and Settings, the same for every member; Moderation is in the account menu, so a moderator's sidebar does not shift when it loads. A 28px margin separates it from the content. It never scrolls: as the window gets shorter the card gives way first (its picture shrinks to 56px, then goes, then the card goes), and after that the least needed links move into a **More** menu that opens above its button, a few at a time. More is marked as the current page when that page's link is inside it. The choice is made in CSS from the window's height, so it holds on the first paint and without JavaScript.
  - **Centre feed:** fluid width, with 28px top and 48px bottom padding. The gap between feed and discovery rail is 24px.
  - **Right rail (282px, from 1200px up):** a calmer discovery heading and a stack of cards 16px apart, sticky beneath the header with independent scrolling when needed.
- **Desktop header:** an 80px sticky bar with a search field up to 480px wide and a compact account menu. A hairline separates it from the content. The sidebar post action focuses the composer on the feed or takes the member there from another page.
- **Feed tabs:** sticky at 80px on desktop and 64px on mobile, with Discover (the default), Latest and, for members, Following, and a small label: "Ranked by published rules" on Discover, linking to /about/discover, and "Newest first, not ranked" on Latest and Following. Tab names never wrap; on a narrow phone the label folds onto two lines instead. Visitors who are not signed in get the same tabs under the welcome.
- **Cards:** posts stack 14px apart; the home page uses a 16px rhythm, while shared discovery, profile and settings pages use 20px between sections.
- **Conversations:** compact reply cards stack 8px apart. Connectors are 2px Hairline Strong lines that run in the gutter between cards and never across one. Under a reply, the line starts at the bottom edge of its card, on its avatar's axis, runs down beside its answers, and a short elbow at each answer's avatar height meets that answer's card at its edge; answers in a "Your reply" run below the dashed marker get their elbows too. Reply text, pictures and actions use the card's full width. Replies open in place five levels deep, and every level indents: 44px on desktop, so the line runs under the parent's avatar, and 12px on phones, where the line starts a gap below the card to clear its rounded corner. Above the post in focus, the earlier conversation is open (nearest 12 posts, older ones folded into one disclosure) as compact reply cards with full-width text. A short line in each gap joins the bottom edge of one card to the top edge of the next, on the avatar axis, and the parent's line runs on past "Replying to @handle" (set beside it) to the top edge of the focused post's card. The lines are decoration and carry nothing alone. The reading rail reduces to three community suggestions and the footer on thread pages.
- **Narrower desktops:** the sidebar remains 210px; the rail is hidden between 1024px and 1199px.
- **Phones and small tablets (under 1024px):**
  - Only the centre column shows, inside a shell up to 720px wide.
  - The 64px top bar shows the wordmark, governance, search and account.
  - Feed gutters are 20px, reducing to 12px below 420px. Page cards use 20px padding, reducing to 18px on small phones; posts and the composer have their own tighter padding.
  - A fixed bottom bar holds Home, Explore, a green "+" (new post), Alerts and Profile for members. Its accessible name is "Alerts (Notifications)", retaining the visible label for voice navigation. Tabs are at least 62px tall and labels stay on one line; the centre action is 44px square. Visitors get the available account actions instead of a post button.
  - The feed reserves 100px plus the device safe area at the bottom, reducing to 96px below 420px. The community directory uses two columns from 640px to 1023px, and one column elsewhere.

**The No Sheet Rule.** Nothing frames the columns. Structure comes from the cards; there are no rules between columns.

## Elevation & Depth

Flush. Cards sit flat on the ground with no shadow; the 1px border alone outlines them (changed 15 October 2026 from a hairline shadow). Only menus and popovers float.

### Shadow Vocabulary

- **Card** (`none`): the `--shadow-card` token is kept so cards share one switch, but it is set to none in both themes.
- **Pop** (`0 12px 32px rgb(16 33 43 / 12%), 0 2px 6px rgb(16 33 43 / 6%)`): menus and dropdown panels only.

**The Border First Rule.** Never add depth with a bigger shadow. If a card needs more presence, its border goes to Hairline Strong (as on hover).

## Shapes

Radius follows role, not habit:
- **Chips:** 6px.
- **Controls** (buttons, fields, image drafts): 8px. Menu items use the 6px small radius.
- **Cards:** 12px.
- **Avatars:** fully round. Nothing else is round.

Image drafts use the control radius; published post galleries use the 12px card radius.

## Components

### Buttons

- **Shape:** gently rounded (8px), 40px tall; 32px in the small size, 48px in the large.
- **Primary:** Forest Green with white 600-weight text; Deep Forest on hover; presses in to 0.97 scale.
- **Secondary:** a white surface with a Hairline Strong border. On hover the border turns green and the fill goes to Sage Wash.
- **Ghost:** muted text that gains an Inset Sage fill on hover. **Danger:** red text and a red-tinted border on white.
- **Disabled:** 50% opacity.

### Chips

- **Style:** Sage Wash fill, Deep Forest 12px/600 text, 6px corners. Used for "Coming soon" and community labels. A chip that links underlines on hover.

### Cards / Containers

- **Corner Style:** 12px.
- **Background:** Card White (card-dark in dark).
- **Border:** 1px Hairline. Feed cards go to Hairline Strong on hover.
- **Behavior:** a post card opens its conversation from anywhere on the card (a reply opens its own conversation). Avatars, names, timestamps, community links, images, menus and actions keep their own targets, and post text stays selectable by dragging. The focused post on its own page is not a link.
- **Shadow Strategy:** none; cards are flush (see Elevation & Depth).
- **Internal Padding:** feed posts use 20px 20px 10px; below 1024px they use 18px 16px 8px, and below 420px, 16px 14px 6px. Compact replies use 12px 14px 4px at every width, with their 44px action row 6px under the text. Rail sections use 20px, shared content panels 22px and profile/community headers 24px. Shared page cards reduce to 20px on mobile and 18px on small phones. Focused thread posts use 24px 24px 12px on desktop.
- **Applies to:** posts, notifications (unread ones take Sage Wash with a green-tinted border), the new-post composer, profile and community headers, forms and moderation cases, and each right-rail section, Public Treasury included. Reply composers use an inline field instead of a card.
- **Long posts:** a post may be 1,000 characters. In a list (feeds, profiles, communities, search, the replies under a thread) a post longer than 400 characters or 10 lines shows its start, about 300 characters and at most 8 lines, ending at a space or line break with an ellipsis, then a "Show more" link (14px, 600, Sage Strong, a 44px target) to its own page, which shows all of it. Mentions, hashtags and links are kept whole or left out, never cut. Nothing within the old 300-character limit is ever shortened (`apps/web/lib/post-length.ts`). It is a link, not an inline expander, so it works without JavaScript.
- **Content alignment:** avatars stay in the header row. Post text, images and actions, and notification excerpts and destination links, use the full card width beneath the header without an empty avatar column.

### Inputs / Fields

- **Style:** a white field with a 1px Hairline Strong border, 8px corners and 16px text.
- **Focus:** the border turns Forest Green with a soft 3px green halo. Keyboard focus anywhere else is a solid 2px Forest Green outline (bright green in dark), offset 2px.

### Navigation

- **Sidebar:** 46px items with an icon and a 13px/500 label. Hover lifts onto a white fill. The current page uses a Sage Wash fill with a subtle green-tinted border (accent mixed 22% into Hairline) and Deep Forest 700 text.
- **Feed tabs:** 13px labels; the active tab is bold Deep Forest with a 2px Forest Green underline.
- **Bottom bar (phones):** 62px tabs at 11px. The active tab is Deep Forest and bold. The centre "+" is a 44px Forest Green tile; on the home feed it focuses the composer in the same tap.

### Composer
The first card beneath the feed tabs. An avatar sits beside a quiet one-line field, "Start a conversation…"; choosing a community changes the prompt to name it. Focusing expands the writing area to three lines (two for replies). Photo, audience and Post actions remain visible in a full-width toolbar below a hairline, and the public-post note stays visible. The remaining character count appears while writing and says "left" or "over" explicitly. Compact labels below 420px keep the controls together down to 320px.

In a thread, the reply composer is the "Post your reply" bar, directly under the post in focus and above the replies: a 32px avatar, a one-line field and a Reply button that stays visible (disabled until there are words). Focusing the field reveals the recipient, attachment controls, audience, count and public-reply note. An empty editor collapses when focus moves away; written text and attachments keep it expanded. Choosing a reply's bubble moves the editor under that reply on desktop widths; on a phone the editor never leaves the fixed bar, which gains a "Replying to @handle" line above the field whenever the reply is to another reply, so the bar neither disappears nor jumps and the recipient is always in view (answering the post in focus shows the line only while the field is open, as before). On phones the bar is fixed above the bottom tabs (a 1px Hairline above it, on the ground, as wide as the 720px shell, below open menus) and the page keeps 76px beneath for it, so the replies scroll under it wherever the reader is. Open, it stops below the 64px top bar and scrolls inside itself (its field is capped at 40% of the window height, and the public-reply note is dropped in a window under 520px tall); it is left out of print. The page ends beneath the last reply by room for an open bar (the same whether it is open or not, so opening it never moves the page under a tap), and scrolling something into view stops short of the bar, so links at the end of a list are never left under it. It relies on the same `env(safe-area-inset-bottom)` as the tabs, which is 0 until the page opts into `viewport-fit=cover`. Without JavaScript the Reply button is enabled so the form can be sent; with it, the button waits for words. A signed-out visitor sees "Sign in to reply" in the same place, a link to sign in. The field uses Inset Sage, an 8px radius, and a green border and halo on focus. The editor has no post-card frame. Image drafts stay below the field, and text remains 16px on phones.

### Conversation replies

**Reply context in lists.** A reply shown in the feed, a profile's Replies, search or a community says whom it answers, as X does: a compact preview of the parent sits above it (a 24px avatar, name, @handle and a one-line excerpt of at most 80 characters, in Slate Muted), a 2px Hairline Strong line runs from the preview's avatar to the reply's own (they share the 42px avatar column, so one centre), and under the reply's header "Replying to @handle" links to the parent post. When the reader cannot see the parent (deleted, taken down, by someone they blocked, were blocked by or muted, or by a member who has left) there is no preview, no line, no name and no excerpt, only "Replying to a post that is no longer available". The API supplies this, with the same eligibility as quoted posts; thread pages do not repeat it, since the conversation is on screen.

Published replies have their own compact card variant: a 32px avatar, name and time in a wrapping header, 8px content gaps, and the same divided, left-aligned action row as feed posts. Body text remains full width. The visible conversation root's author receives an "Author" label on every post of theirs: earlier posts above the focus, the focused post, and replies, including expanded branches and new replies. A hidden, deleted or truncated root never assigns that label to another person. Community context is shown on the focused post rather than repeated on every reply.

The Replies heading has one options menu containing Newest first, Oldest first, and the complete author-first ordering explanation. These controls stay hidden until requested. Branches still load only on demand, preserve their visibility checks, and keep the existing indentation limits. Repeated same-author recipient labels are omitted, while changed and unavailable parents retain their context links.

Post actions use 44px targets in a left-aligned row beneath a hairline divider. Gaps and control widths adapt to the available space, with sharing at the far edge. Compact replies keep bookmarking in Post options; standalone feed and focused cards retain its toolbar button. Long counts truncate visually while accessible labels retain the full count. The spacing and reading roles are tokens in `globals.css` (`--post-text-size`, `--post-text-leading`, `--post-meta-size`, `--reply-padding`, `--reply-gap`, `--touch-target`).

Returning members get the town-square introduction above the feed tabs: the "Made for us" eyebrow, the title and its one-line description. The public introduction keeps the welcome message and invitation.

### Calls and meetings (spec stub, not built)

Proposed in [ADR 0017](../../docs/adr/0017-calls-and-meetings.md); nothing exists yet, and it follows the direct-messages gate (verified adults who opted in). Existing tokens only. A pre-join screen comes before any browser permission prompt: who is calling, "Join with audio" (Primary) and "Join with video" (Secondary), a mic meter, device pickers, and a preview that never publishes. In a call at 320px, one large speaker tile, a strip of at most four tiles above a bottom bar of 44px buttons (mic, camera, share where the browser allows, people, end); the rest sit in a "People" sheet. Calls start audio-only with the camera off. Every button names its state ("Microphone, on"), joins and leaves go to a polite live region, and motion respects reduced-motion.

#### Gists (built: audio only, behind `features.gists`)

A Gist is a live audio room ([ADR 0017](../../docs/adr/0017-calls-and-meetings.md) section 4a). Existing tokens only; no new colours. When `GET /v1/me` says `features.gists` is false, nothing renders and `/gists/*` is the normal not-found page, as it is for a Gist the viewer may not see (the API answers every such refusal with the same 404).

- **Routes.** `/gists/[id]` (the room) and `/gists/new` (the same Start a Gist card as on Home). The page reads the Gist on the server, so a missing, hidden or removed Gist is a real 404. `apps/web/proxy.ts` runs on `/gists/*` only and rewrites any member without `features.gists` (and, with Gists off, anyone signed out) to a missing path, so they get the root not-found page with a real 404 and the same bytes as any missing URL. Signed out while Gists are on, every Gist address (`/gists/<uuid>`, real or not; `/gists/new` stays a 404) shows the same **Sign in to join this Gist** card in the account-page frame: eyebrow "Gists", one line on what a Gist is, a Primary 48px "Sign in" that comes back to the same address, and the invite-code footer from Sign in. Its link preview is "A Gist on HeyNaija" with the default picture and no title, host or live state, and it is not indexed. The room's tab title is the Gist's title, for members only. The page's own `notFound()` still covers a Gist the member may not see. Mid-session, a 404 from the API reloads the page and gets the same answer. Not indistinguishable: a member who is on the list can tell `/gists/new` from a missing page (it is theirs).
- **Start a Gist.** A Primary-button card above the composer on Home, for members with `features.gists` only: a one-line title field (16px, labelled "Gist title", 200 characters) and "Go live" (44px). A refusal ("You are already hosting a live Gist") shows in a Danger notice with `role="alert"`, and a host who is already live also gets "Return to your live Gist"; a member in a Gist gets "Return to the Gist you are in" from a tab-local memory.
- **Live now** (`app/ui/gists/live-now.tsx`). On Home, above Start a Gist, for members with `features.gists`: a card headed by the red live dot and "Live now", one 52px link per live Gist (its title, then "Hosted by …", the community, and the listener count, muted), newest first, at most 20. It lists only Gists the member may join (`GET /v1/gists/live` applies the same rules as opening one), shows nothing when none is live, and is fetched again every 30 seconds while the tab is visible. Not yet on community pages or profiles.
- **Before joining.** The room header (a red "Live" label with the Radio icon, the community link, the title at Page title size, "Hosted by", the listener count, "Room locked" when it is) is followed by a card: "Keep this screen open", the data-use hint (about 43 MB an hour, louder when the browser reports mobile data or Save-Data), and one Primary 48px "Join the Gist". Nothing plays, and no microphone prompt appears, before that tap. The audio library is fetched on that tap, as its own chunk.
- **Header.** A red dot and "Live" (static under reduced motion, a slow blink otherwise) with the time since the Gist started (a `timer`, not announced), the title at Page title size, "Hosted by" and the community, and a 44px "N listeners" button that opens the Listeners sheet. "Room locked" is a badge with a lock icon.
- **On stage.** A grid of tiles (`minmax(104px, 1fr)`: two across at 320px, three at 390px) with a 72px avatar, the name, and badges: Host or Co-host in Sage, Speaker, and "Muted" (an icon, the word, and a border) whenever the person's microphone is not live, read from LiveKit's published and muted state. Whoever is talking gets a 3px Forest Green ring that pulses softly (a static ring under reduced motion) and the word "Speaking"; state is never colour alone. The member's own tile carries a level meter while their microphone is live. Listeners are a count, never a list; their sheet says only the host and co-hosts can see who is listening.
- **Screen readers.** The speaking ring is not announced continuously. A polite region says "Ada is speaking." when someone new starts, at most once every six seconds, up to two names, never for yourself; a second polite region carries role changes, mute and reconnect messages so the two never overwrite each other.
- **Control bar.** A sticky card above the phone tab bar, reachable with one thumb: for speakers a wide "Microphone" button (a fixed name with `aria-pressed`, and a visible On or Off), a 44px square settings button, and Leave; for listeners a wide Request to speak (Primary) or Cancel request, and Leave. At 320px it wraps so the main button takes its own row. "Tap to hear the Gist" appears above it when the browser blocks playback.
- **Microphone settings** (speakers; a sheet): an input picker (the choice is remembered in `localStorage`; if it is unplugged the default is used and the sheet says so, and it is picked up again when plugged back in), a live input level meter, and three switches, all on by default, each with a one-line hint: Noise suppression, Echo cancellation, Automatic volume. They are the browser's own processing, applied as capture constraints and, on a live microphone, by restarting the track. Denied, no-device and busy cases each show what to do next, in a Danger notice with `role="alert"`; a headset pulled mid-talk mutes the member and says so. There are no voice effects: see ADR 0017 open question 20.
- **Muting turns the microphone off completely**, not just silent: the capture is stopped so the browser's recording indicator goes off, and Unmute asks the browser for the microphone again. A Bluetooth headset may switch audio mode when that happens.
- **Sheets.** The Listeners and Microphone settings sheets use the native `<dialog>`: a bottom sheet on phones and a centred card from 640px, with a Pop shadow, the modal scrim, focus trapped and returned, Esc to close, and a 44px close button.
- **Report** (`app/ui/gists/report-gist.tsx`). Everyone in the room but the host gets a secondary "Report" button (the Flag icon) beside the listener count, while connected. It opens the "Report this Gist" sheet over the room, which keeps playing: the same reasons as reporting a post, an optional "What happened?", and Send. A muted line says moderators see what the Gist is, who hosts it and who is in it now, and that nothing is recorded. The thanks says the host and speakers are not told who reported it.
- **Host and co-host controls** sit in a card below the stage: the request queue (oldest first, "Let speak"), each speaker's Mute, "Make co-host" (host), "To listeners" and Remove, and, in the Listeners sheet, the list with "Invite to speak" and Remove, and for the host "Lock the room", "Turn requests off" and "End the Gist". Remove and End take two taps (the button becomes a Danger "Tap again to ...", and reverts after four seconds). Buttons carry the member's name for screen readers.
- **States.** Connecting ("Connecting… keep this screen open"), reconnecting (a Sage notice; the room asks the API for a fresh token each time), full and locked (Danger-free cards with "Try again" and "Back to Home"), ended ("This Gist has ended", with the peak audience), failed (Danger notice and "Try again"), a browser without WebRTC, "This Gist is open in another tab or device" with an explicit "Use it here" button (never an automatic rejoin: two tabs would otherwise knock each other out in a loop), and "You are no longer in this Gist" after a removal. Only a network drop reconnects on its own, with backoff and at most eight attempts. Leaving the page at any moment, even mid-connect, releases the connection, the wake lock and the member's presence (a keepalive `POST /leave` also fires on `pagehide`).
- **Following the room.** There is no realtime channel, so the room polls `GET /v1/gists/:id` every 4 seconds (plus `/requests` for hosts and co-hosts), backing off to 30 seconds on failure and pausing while the tab is hidden, with an immediate poll on return.
- **Announcements.** Two polite live regions (`sr-only`). One carries role changes and the member's own actions: "You are now a speaker. Tap the microphone to talk.", "You are now a listener. Your microphone is off.", "Microphone on.", "You are muted.", "Reconnecting.", "Reconnected.", "This Gist has ended.", and host actions. The other carries who started speaking ("Ada is speaking."), throttled to once every six seconds, new speakers only, never the member themselves; speaking is otherwise never announced continuously.
- **Phones.** The screen should stay on: the room asks for a screen wake lock where the browser allows it and sets Media Session metadata, and says "keep this screen open" in plain words, because a locked phone or another app can silence the page (ADR 0017 section 4b). It is not promised to work like X Gists in the background.
- **Without JavaScript.** A notice says Gists need JavaScript. It sits outside the streamed content, so it is visible when the rest of the page never loads.

### App icons

The favicon uses the approved white HN monogram on a rounded deep green (`#024822`) tile, with transparent outer corners. `public/brand/heynaija-mark.svg` is the vector source, traced from the approved preview. `node apps/web/scripts/generate-icons.cjs` regenerates the 16/32/48px browser ICO, 512px app icon, 180px Apple icon and 192/512px installable-app icons from it. The full HeyNaija wordmark remains unchanged.

### Discovery and account pages

Communities use small subject glyphs in sage tiles rather than member-style initials: a laptop for Tech & Careers, a location pin for cities, a graduation cap for Universities and a film icon for Entertainment. The right rail gives each community a clear name, count and join action; trending conversations and the honest coming-soon Treasury preview remain quieter supporting cards.

Shared page introductions use an eyebrow, title and short description. Directory cards, grouped search results, notification cards and settings sections follow the same surface system. Profile and community headers let actions wrap beside long names, and empty states explain what happens next without inventing activity.

Account entry pages use a separate layout: the approved wordmark and an Explore link above a desktop welcome column and a form card. The desktop form column is capped at 440px; the welcome column disappears below 1024px so the form leads on phones. Settings stays inside the main shell with separate sections for photo, public profile, appearance and account access.

### Direct messages (spec, not built)

Proposed in [ADR 0016](../../docs/adr/0016-direct-messages.md); nothing here exists yet. Only tokens above are used: no new colours, radii or shadows. Depth is the 1px Hairline border. DMs are opt-in and only for age-verified adults who turned them on; everyone else sees none of this surface except the Settings entry and the verification prompt below.

**Routes.** `/messages` (inbox), `/messages/:id` (thread), `/messages?tab=requests`, and the Settings section "Messages". A "Messages" item appears in the sidebar only when the member is eligible and opted in (`messages.enabled` from `GET /v1/me`). The bottom bar is full at five tabs, so on phones Messages is an envelope icon beside search in the top bar (44px target, Forest Green unread dot) and an item in the account menu.

**Settings: turning DMs on.** A card "Messages" in Settings, one row: a switch labelled "Allow direct messages" (off by default), helper text 13px Slate Muted: "Only people who have verified their age (18+) can message each other. You can turn this off at any time." When on, a second row "Who can message you": radio "People I follow, and requests from other verified adults" (default) or "Only people I follow". Turning the switch off stops delivery and hides the Messages item; existing conversations are kept and come back if you turn it on again.
- **Not verified (unverified, under 18 or unknown age):** the switch is disabled, and the card shows an Inset Sage notice in place of the second row: "Verify your age to use messages." with a Primary "Verify your age" button that starts the age check (flow decided in the age-verification work, not here) and a link "Why?" to a short explanation: "Messages are only for adults whose age we have checked, to keep everyone safe." The copy never says the member is a minor; an under-18 account would see the same wording once such accounts exist.
- **Verified:** the switch works.
- **Verification lapsed or expired:** the switch stays as chosen but the card shows the same notice with "Your age check has expired. Verify again to restore your messages." The Messages item and inbox are hidden meanwhile.
- The same prompt (a single card with the "Verify your age" button) appears at `/messages` for an unverified member who opens the URL directly, with no inbox behind it.

**Message button on profiles.** Shown only when both the viewer and the profile owner are verified and opted in, and neither blocks the other. In every other case there is **no button and no explanation** on another member's profile: nothing may reveal that person's age check or opt-in, so a profile of someone who has not opted in looks exactly like a profile of someone who cannot be messaged. A viewer who is not eligible themselves also sees no button; they learn about the requirement only in Settings and at `/messages`.

**Desktop (1024px and up): two panes.** The right rail is dropped on `/messages`, so the two panes use the full width of the shell. Both are cards, 12px corners, Hairline border, 14px apart.
- Left pane, 360px: heading "Messages" (Title) with a "New message" icon button (Secondary, 40px); tabs **Messages** and **Requests** (feed-tab styling: 13px, active Deep Forest with a 2px Forest Green underline; Requests shows a count chip when non-zero); a search field "Search messages" (names in your conversations only, Field style, 46px); the conversation list, scrolling on its own.
- Right pane, fluid: thread header, message list, composer. Sticky header (avatar 32px, name 600/14px, handle in Slate Muted 12px, an options menu with Mute, Block, Report, Delete conversation); the list scrolls; the composer is pinned to the bottom of the pane. Before a choice the right pane is an Inset Sage fill with the empty-state text.
- Both panes are as tall as the window less the 80px header; each scrolls independently; the page itself does not.

**Phone (under 1024px, tested at 320px): list to thread.** One pane at a time inside the 720px shell, 12px gutters below 420px.
- `/messages` shows the tabs and the list full width. Tapping a row goes to `/messages/:id`; the thread replaces the list, the bottom bar is hidden in the thread so the composer owns the bottom, and the top bar shows a back arrow (44px), avatar, name and the options menu. Back returns to the list at the same scroll position.
- At 320px: name and last message truncate with an ellipsis, one line each; the time never wraps; bubbles are at most 85% of the pane; the composer field shrinks beside a 44px Send button.
- The composer sits above the on-screen keyboard (visual viewport) and the device safe-area inset.

**Conversation row** (64px tall, 12px 14px padding, hairline divider between rows, no nested card): 40px avatar; name 600/14px Ink, one line; last message 13px Slate Muted, one line, prefixed "You: " when the member sent it; time 12px Slate Muted at the top right ("now", "5m", "2h", "Tue", "12 Oct"). **Unread:** a 10px Forest Green dot at the right of the last-message line, with the name and last message in weight 600 and Ink; the dot is never the only cue (the row's accessible name includes "unread"). The selected row on desktop uses Sage Wash with a Deep Forest name (the nav-item-active treatment). Hover is Inset Sage. A muted conversation shows a small bell-off glyph in Slate Faint (decorative; the accessible name says "muted").

**Thread.**
- Bubbles: 12px corners (the card radius; one shape, no tail), at most 75% wide on desktop and 85% on phones, 15px/1.6 body, 8px 12px padding, long words break. **Sent** (right-aligned): Forest Green fill, On Green text (4.8:1). **Received** (left-aligned): Inset Sage fill, Ink text, Hairline border. In the dark theme the build must pick sent and received pairings from the dark tokens (green-dark, inset-dark, ink-dark) that meet 4.5:1 and record them in `globals.css`.
- Grouping: consecutive messages from one person within 5 minutes form a group, 2px apart, with 8px between groups. Only the last bubble of a group shows its time (12px Slate Muted) beneath it. A centred day separator ("Today", "Tue 28 Oct") in the label type starts each day. A 24px avatar sits beside the last received bubble in a group.
- Under the member's last sent bubble only: "Sending…", "Sent" or "Not sent". No read receipts are shown.
- A deleted message shows "This message was deleted" in Slate Muted body-small inside a Hairline outlined bubble; a moderator removal says "Removed by a moderator".
- Older messages load on scrolling to the top, with a "Load earlier messages" button as the keyboard and screen-reader route.

**Composer** (pinned): an Inset Sage multi-line field, 8px radius, 16px text (no iOS zoom), growing from one line to five and then scrolling. Send is a 40px primary button; at 320px it collapses to an icon with the accessible name "Send message". On desktop Enter sends and Shift+Enter adds a newline; on phones Enter adds a newline and only the button sends. A count appears from 1,800 of 2,000 characters ("120 left", "12 over"), as in the post composer. It is replaced by a notice when sending is not allowed (see states).

**New message dialog.** Opened from "New message": a modal card with Pop shadow, focus trapped. A search field (`role="combobox"`) with a listbox of results (avatar, name, handle) that lists only members who are verified and opted in and not blocked; a minimum of two characters; a Next button enabled once one is chosen. Choosing someone you follow opens an empty thread; someone you do not follow opens an empty thread with "They will see this as a request." On phones it is a full-screen sheet. Escape closes it and returns focus to the New message button. If nobody matches: "No one found. People appear here only if they have turned on messages." (this tells the searcher nothing about a particular person).

**Message requests tab.** Request rows are the same row with a "Request" chip (Sage Wash, Deep Forest). Opening one shows the message and, in place of the composer, a card line "[Name] wants to message you. They can't see if you've read it." with three buttons: Accept (primary), Decline (secondary), Block and report (danger). Accepting moves the thread to Messages and shows the composer. Declining removes it without telling the sender. Requests show only a quiet count chip, never a louder badge or a push naming the sender.

**States.**
- **Empty inbox:** a Slate Faint envelope glyph, "No messages yet", the line "Message someone you follow, or wait for a request." and the New message button. **Empty requests:** "No requests." **Empty thread:** "Say hello to [name]."
- **Loading:** three skeleton rows in Inset Sage, no shimmer (low-end devices; also honours `prefers-reduced-motion`).
- **Unread:** as above; the read marker moves when the latest message is in view.
- **Request waiting (sender side):** after the first message the composer is replaced by "Waiting for [name] to accept. You can send more after they do."
- **Blocked, unavailable or ineligible (either side):** an Inset Sage notice in place of the composer: "You can't send messages to this person." It does not say who blocked whom, whether the other person is unverified or whether they turned messages off. The thread stays readable.
- **Your own age check lapsed:** the inbox is replaced by the Settings verification card described above.
- **Send failure and retry:** the bubble stays with an Alarm Red border and beneath it "Not sent" with Retry and Delete (Ghost, 44px). Retry reuses the same `clientId`, so it cannot duplicate. Offline, the composer stays usable with the notice "Offline. Messages will send when you are back"; unsent messages are kept for the session only.
- **Rate limited:** a notice "You're sending messages too fast. Try again in a minute." (Alarm Wash, Alarm Red text) with Send disabled.
- **Mute, block, report:** from the options menu. Mute: no toast, the header shows the bell-off glyph and the item flips to Unmute. Block: a confirm dialog ("They won't be able to message you. The conversation is removed from your inbox."), then back to the list. Report: a dialog with the reasons and optional details, then "Thanks. A moderator will review this message and the ones around it."

**Accessibility.**
- Landmarks: the inbox is a `ul` labelled "Conversations"; the thread is `main` with a heading (the person's name) and the message list as `role="log"` labelled "Messages with [name]". `role="log"` is implicitly polite, so a new incoming message is announced once as "[name]: [text]"; the member's own sent messages are not re-announced. Sending-state changes use `role="status"`; failures use `role="alert"`.
- Focus order on desktop: sidebar, Messages heading and New message, tabs, search, list (one tab stop; arrow keys move between rows; Enter opens), thread header and menu, message list (focusable for scrolling), composer, Send. Opening a thread moves focus to the composer on desktop and to the thread heading on phones. Back returns focus to the row that was opened.
- Keyboard: Enter sends on desktop, Shift+Enter adds a newline, Escape closes menus, dialogs and the new-message sheet.
- Tabs follow the ARIA tabs pattern (arrow keys, `aria-selected`); the count is part of the tab name ("Requests, 3").
- Every icon-only control has an accessible name; targets are at least 44px; focus is the standard 2px Forest Green outline.
- Colour is never the only signal: unread has weight and the word "unread" in the accessible name; failure has text and a border; sent and received differ by side and by visually hidden prefixes ("You said", "[name] said").
- 200% text zoom must not clip the composer or hide Send; `prefers-reduced-motion` removes the scroll-to-bottom animation.
- Timestamps use `<time datetime>` with the full date as the title.

**Performance.** No images in v1, so a thread is text only and the only images are avatars. Polling cadence is in the ADR (5 seconds in an open visible thread, 30 seconds in the inbox). No additional fonts.

## Do's and Don'ts

### Do:

- **Do** put standalone content and forms in cards: white, 12px corners, 1px Hairline border, no shadow. Replies use the compact inline field treatment.
- **Do** keep the ground Sage Ground and let sticky bars use that same quiet ground.
- **Do** use Forest Green only for actions, the current location and links.
- **Do** keep 14px between feed cards, with 20px mobile gutters and 12px gutters below 420px.
- **Do** step hierarchy through weight (400–700) before size.
- **Do** keep text at 4.5:1 or better: Slate Muted for metadata, never Slate Faint.

### Don't:

- **Don't** reintroduce a framing white sheet or rules between columns.
- **Don't** add gradients, a second accent colour, or colours borrowed from AI-tool branding.
- **Don't** compete with the wordmark: no other display type, illustration-heavy panels or dark slabs in the rail.
- **Don't** nest cards inside cards; inside a card, use Inset Sage fills or hairline dividers.
- **Don't** round anything but avatars fully, or use radii outside 6, 8 and 12px.
- **Don't** add shadows to cards; strengthen the border instead.
