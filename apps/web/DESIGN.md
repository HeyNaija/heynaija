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
  - **Left sidebar (210px, sticky, as tall as the window):** approved wordmark, primary navigation, a 44px "Create a post" action and the existing community illustration card. About, Progress and Governance always live in **More**; Home, Communities, Notifications, Bookmarks, Settings and moderator access take priority in the main list. A 28px margin separates it from the content. It never scrolls: as the window gets shorter the card gives way first (its picture shrinks to 56px, then goes, then the card goes), and after that primary links move into More a few at a time. The choice is made in CSS from the window's height, so it holds on the first paint and without JavaScript.
  - **Centre feed:** fluid width, with 28px top and 48px bottom padding. The gap between feed and discovery rail is 24px.
  - **Right rail (282px, from 1200px up):** a calmer discovery heading and a stack of cards 16px apart, sticky beneath the header with independent scrolling when needed.
- **Desktop header:** an 80px sticky bar with a search field up to 480px wide and a compact account menu. A hairline separates it from the content. The sidebar post action focuses the composer on the feed or takes the member there from another page.
- **Feed tabs:** sticky at 80px on desktop and 64px on mobile, with Discover (the default), Latest and, for members, Following, and a small label: "Ranked by published rules" on Discover, linking to /about/discover, and "Newest first, not ranked" on Latest and Following. Tab names never wrap; on a narrow phone the label folds onto two lines instead. Visitors who are not signed in get the same tabs under the welcome.
- **Cards:** posts stack 14px apart; the home page uses a 16px rhythm, while shared discovery, profile and settings pages use 20px between sections.
- **Conversations:** compact reply cards stack 8px apart. Nested connectors start at the parent's avatar axis. Replies open in place five levels deep, and every level indents: 44px on desktop, so the line runs under the parent's avatar, and 12px on phones, so the fifth level keeps most of the width. The reading rail reduces to three community suggestions and the footer on thread pages.
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

In a thread, the reply composer starts as one line beside a 32px avatar. Focusing the field reveals the recipient, attachment controls, audience, count, Reply action and public-reply note. An empty editor collapses when focus moves away; written text and attachments keep it expanded. The field uses Inset Sage, an 8px radius, and a green border and halo on focus. The editor has no post-card frame. Image drafts stay below the field, and text remains 16px on phones.

### Conversation replies

Published replies have their own compact card variant: a 32px avatar, name and time in a wrapping header, 8px content gaps, and the same divided, left-aligned action row as feed posts. Body text remains full width. The visible conversation root's author receives an "Author" label on their replies, including expanded branches and new replies. A hidden, deleted or truncated root never assigns that label to another person. Community context is shown on the focused post rather than repeated on every reply.

The Replies heading has one options menu containing Newest first, Oldest first, and the complete author-first ordering explanation. These controls stay hidden until requested. Branches still load only on demand, preserve their visibility checks, and keep the existing indentation limits. Repeated same-author recipient labels are omitted, while changed and unavailable parents retain their context links.

Post actions use 44px targets in a left-aligned row beneath a hairline divider. Gaps and control widths adapt to the available space, with sharing at the far edge. Compact replies keep bookmarking in Post options; standalone feed and focused cards retain its toolbar button. Long counts truncate visually while accessible labels retain the full count. The spacing and reading roles are tokens in `globals.css` (`--post-text-size`, `--post-text-leading`, `--post-meta-size`, `--reply-padding`, `--reply-gap`, `--touch-target`).

Returning members get the town-square introduction above the feed tabs: the "Made for us" eyebrow, the title and its one-line description. The public introduction keeps the welcome message and invitation.

### App icons

The favicon uses the approved white HN monogram on a rounded deep green (`#024822`) tile, with transparent outer corners. `public/brand/heynaija-mark.svg` is the vector source, traced from the approved preview. `node apps/web/scripts/generate-icons.cjs` regenerates the 16/32/48px browser ICO, 512px app icon, 180px Apple icon and 192/512px installable-app icons from it. The full HeyNaija wordmark remains unchanged.

### Discovery and account pages

Communities use small subject glyphs in sage tiles rather than member-style initials: a laptop for Tech & Careers, a location pin for cities, a graduation cap for Universities and a film icon for Entertainment. The right rail gives each community a clear name, count and join action; trending conversations and the honest coming-soon Treasury preview remain quieter supporting cards.

Shared page introductions use an eyebrow, title and short description. Directory cards, grouped search results, notification cards and settings sections follow the same surface system. Profile and community headers let actions wrap beside long names, and empty states explain what happens next without inventing activity.

Account entry pages use a separate layout: the approved wordmark and an Explore link above a desktop welcome column and a form card. The desktop form column is capped at 440px; the welcome column disappears below 1024px so the form leads on phones. Settings stays inside the main shell with separate sections for photo, public profile, appearance and account access.

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
