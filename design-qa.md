# HeyNaija UI design QA

final result: passed

## Target and evidence

- Source visual: `docs/design/heynaija-reference.png` (1536 × 1024 composite concept board). The desktop and mobile content regions are the target; presentation headings and surrounding canvas are excluded.
- Selected logo: option 01 from the expressive logo board; the rounded green wordmark supersedes the reference board's plain wordmark.
- Implementation: http://127.0.0.1:3000/; signed-in member, chronological public feed, empty composer, collapsed governance details.
- Desktop: `docs/design/heynaija-desktop.jpg`, 1920 × 902 CSS viewport; browser screenshot excludes the scrollbar. Centered 1280px app frame. Browser screenshot density 1 CSS pixel per image pixel.
- Mobile: `docs/design/heynaija-mobile.jpg`, 390 × 844 CSS viewport; screenshot excludes the scrollbar. Browser screenshot density 1 CSS pixel per image pixel.
- Source desktop and mobile are different-sized regions of a generated composite, not browser viewport captures. Comparison uses proportional region layout and readable UI elements; no pixel-perfect matching claim is made. Different real content lengths are intentional.
- Full-view evidence: source, final desktop, and final mobile opened together in one image comparison input.
- Focused evidence: mobile screenshot viewed at native size to check wordmark, tabs, composer, post text, actions, and bottom navigation.

## Required fidelity surfaces

- Typography: dark sans interface, clear semibold hierarchy, muted metadata, readable 14–15px post copy, tight ownership heading. The supplied rounded raster wordmark is used directly.
- Layout: white desktop shell, left navigation with illustrated ownership card, centre feed and compact composer, right discovery/governance rail. Soft borders, 13px cards, sage selected navigation. Mobile hides side columns, keeps the brand header and fixed bottom navigation, and uses divided feed rows.
- Color: near-white canvas, white surfaces, ink text, muted slate metadata, forest green actions, pale sage ownership and governance cards. Profile initials retain readable green contrast.
- Images: transparent selected wordmark and generated editorial community illustration load correctly. Generated art direction follows the reference's green/sage/ochre conversational illustration. Existing real identity initials retained because profile photographs are not supported.
- Copy: community ownership is prominent. Real posts, handles, communities, and membership counts remain authoritative. Public-post privacy guidance is preserved.

## Comparison history

1. Initial desktop and mobile review: updated visual composition rendered correctly. [P2] Next.js development badge covered the mobile Home tab.
2. Fix: set `devIndicators: false`. Configuration reload stalled the local development compiler. Restarted the frontend and preserved the old generated `.next/dev` cache under `/private/tmp/heynaija-ui/next-dev-before-restart`; a clean dev cache restored normal responses.
3. Final captures: mobile Home tab fully visible, fixed navigation intact, no horizontal overflow. Rechecked desktop and mobile against source together. No remaining actionable P0/P1/P2 issues within the implemented visual scope.

## Interaction and technical checks

- Web TypeScript check passed (`pnpm --filter @heynaija/web typecheck`).
- `git diff --check` passed.
- Following feed loaded its distinct following content; switched back to For you.
- Composer expands on focus; typing enables Post, clearing disables it; draft cleared without publishing.
- Governance details expand and collapse and explain that no votes are open.
- Mobile account menu opens and exposes Settings, then closes.
- No horizontal overflow at 320px, 390px, 1100px, and default desktop viewport.
- Browser console error log empty in final check.
- Browser restored to normal desktop viewport; dedicated preview tab kept open.

## Intentional scope differences

- Photo uploads, polls, reposts, notification delivery, and governance voting require product/backend support. No nonfunctional mock controls or invented votes were introduced.
- Existing bookmark/profile navigation retained in mobile rather than showing an unsupported notification tab.
- Mock people, profile photos, inflated membership counts, and photo posts were not substituted for real user data.
- Existing icon system retained to keep working components consistent.

## Follow-up polish

- [P3] Produce a vector master of the approved wordmark for large-format use.
- Future profile/community image support and post media will bring the live content closer to the illustrated concept.

## Implementation checklist

- [x] Apply approved logo and reference visual style.
- [x] Preserve working API and account interactions.
- [x] Verify desktop and mobile rendering.
- [x] Fix mobile badge overlap and recapture.
- [x] Preserve existing staged work; no commit, publication, or deployment.
