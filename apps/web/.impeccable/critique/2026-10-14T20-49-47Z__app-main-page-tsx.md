---
target: main feed
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/Users/psami/Desktop/heynaija/apps/web/app/(main)/page.tsx"
target_fingerprint: "sha256:fa2f031ac08cc74c5120b44cda7ec2319f097eafaa1bdeac936f2d6125e11657"
target_path: /Users/psami/Desktop/heynaija/apps/web/app/(main)/page.tsx
timestamp: 2026-10-14T20-49-47Z
slug: app-main-page-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Character counter is a bare unlabelled number with no aria-live |
| 2 | Match System / Real World | 2 | "For you" tab implies ranking; it is the Latest feed. Stock "What's on your mind?" |
| 3 | User Control and Freedom | 3 | Menus close on Esc/outside with focus return; mute gives no feedback |
| 4 | Consistency and Standards | 3 | Strong primitives; post menu mixes post and person actions ungrouped; "Everyone" vs "public" |
| 5 | Error Prevention | 3 | Confirms block/delete; mobile + lands composer under sticky chrome |
| 6 | Recognition Rather Than Recall | 2 | Unlabelled governance icon on mobile; "Latest first" explained only by a title tooltip |
| 7 | Flexibility and Efficiency | 2 | ~7 tab stops per post, ~15 before first post; no shortcuts or new-posts affordance |
| 8 | Aesthetic and Minimalist Design | 2 | Dark Treasury slab + illustrated card compete with the wordmark and the feed |
| 9 | Error Recovery | 3 | Plain errors in role=alert |
| 10 | Help and Documentation | 2 | Nothing on the feed explains communities, chronology, or "Everyone" |
| **Total** | | **25/40** | **Acceptable** |

## Design Specificity Verdict
Grounded at the edges, borrowed at the centre. Wordmark, sidebar illustration, governance rail and the Following reason line ("From Lagos, which you joined") are HeyNaija; the centre column (tabs, composer, rows) is an interchangeable X/Threads layout. The thesis ("say why", local first) appears only on Following and in a rail mobile hides.
Deterministic scan: CLI 0 findings. Browser overlay: skip-link 1.2:1 in dark theme (real, globals.css:413-423 fixed #fff on var(--ink)); bottom tabs 10px below 360px (real, globals.css:1190); nested-cards treasury-preview in app frame (false positive, frame is a sheet); overused-font Plus Jakarta Sans (brand choice, ignore).

## Priority Issues
- [P1] Sidebar card claims "A community-owned social network for all Nigerians." (shell.tsx:76) — contradicts PRODUCT.md and PLAN §10 risk. Fix: honest wording ("Built to become community-owned. Charter coming.") — /impeccable clarify
- [P1] Mobile "+" (shell.tsx:338) scrolls to #compose without focusing; scroll-mt-24 (96px) < 110px sticky chrome. Fix: focus textarea on #compose, ~120px scroll margin — /impeccable harden
- [P1] Focus/field contrast fails WCAG 1.4.11: --focus-ring 32% alpha ≈1.5:1 light; textarea border --line 1.2:1; skip-link 1.2:1 in dark. Fix: solid 2px --accent outline with offset, stronger field border, skip-link color var(--bg) — /impeccable audit
- [P1] Default feed hides the thesis: tab "For you" (page.tsx:37), reason only on Following, "Latest first" tooltip-only. Fix: rename "Latest", visible "Newest first, not ranked", reason on every row, drop duplicate chip — /impeccable clarify
- [P2] Treasury panel is the heaviest block and not live. Fix: quiet ruled section below Popular communities, or merge with votes — /impeccable quieter

## Persona Red Flags
Casey: + needs two taps; Post button top-right; privacy note only after focus; unlabelled bank icon first in top bar.
Sam: whole post body is a link; reply named "0 replies"; like count aria-label on span; counter not live; no post headings; weak focus ring.
Jordan: lands on strangers' posts, no welcome; Following empty state has no action button (empty-state supports it); no community picker when none joined; signed-out sees + and Bookmarks.
Lagos student: no optimistic like/bookmark on 3G; backdrop-filter blur on sticky bars costly on low-end GPUs; avatar initials from handle not name.

## Minor Observations
Trending rank numerals in --faint 3.0:1; 10px bottom tabs under 360px; disabled Post at 0.5 opacity looks broken; --warm orange flame may be an unapproved colour; privacy note invisible without JS; load-test seed data distorts review; 4-image grid tiny at 375px; stray doc comment shell.tsx:90-91.

## Questions to Consider
- Why is the default tab named after the algorithmic pattern the product rejects?
- Should the composer invite people to post into a place ("Say something to Lagos…")?
- What would the page look like if visual weight went only to what works today?
