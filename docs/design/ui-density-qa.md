# Compact social UI — 14 October 2026

Implemented the reported profile-theme, notification navigation and reply-composer fixes within the existing HeyNaija design system.

- Account theme picker: a bounded 256px menu, label above the three labelled choices. Confirmed System, Light and Dark switching, dark-theme readability, Escape dismissal and focus return. No menu overflow at 320px or 390px.
- Replies: idle composer reduced from 178px to 66px at the same desktop viewport. Expands on focus, retains a draft on outside clicks, exposes attachments and the public-post notice while writing, and enforces the existing 300-character limit. Home composer reduced to 106px when idle.
- Notifications: compact rows explicitly identify their destination. Replies and likes open the exact item with a post anchor; follows open the actor's profile. Earlier thread context starts collapsed. Reading notifications refreshes the shared navigation count. Informational moderation outcomes retain their explanation without a misleading link.
- Density: reduced header, row and action spacing; kept readable body copy and 40px mobile post actions. Feed image previews have a 360px height limit; the image viewer remains available.

Validation: production build and web typecheck passed; all five notification routing tests passed (`pnpm --filter @heynaija/web test`). Browser checks used a local development account, desktop and 320px/390px mobile widths. Verified composer expansion, enabled/disabled submission state, character limit, thread disclosure and notification links without publishing test posts or replies. No full assistive-technology compliance claim.

Research reference: [X's notification timeline documentation](https://help.x.com/en/managing-your-account/understanding-the-notifications-timeline). This is an adaptation of compact social interaction patterns, not a pixel-matched X recreation.

Before/after screenshots are saved in `/private/tmp/heynaija-ui-density/`.
