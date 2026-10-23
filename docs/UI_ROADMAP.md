# UI roadmap — source of truth for the UI overhaul

Companion to `UI_AUDIT_2026-10-19.md` (findings + evidence). **This file is the tracker.** Any thread/agent working on these items must update the checkbox, branch, and PR link here in the same PR as the change, and add anything a successor would need to know under "Notes". If context is compacted, re-read this file first.

Rules for everyone
- Branch each item off the latest `origin/main` (not off another lane's branch) unless the item says "stacks on".
- One PR per item. Small, reviewable. Squash-merge like the rest of the repo.
- Before PR: `pnpm --dir web run typecheck`, `pnpm --dir web run lint`, `pytest -q` if Python touched.
- Verify visually at 1280px and 390px (iPhone 12 Pro) in dark theme. Light theme if you touch colors.
- Don't edit another lane's files without noting it here first (see "File ownership").
- The user reviews and approves merges. Don't merge without being told to.

## Lanes (run in parallel; items inside a lane are serial)

### Lane A — shared components (biggest overlap, keep serial)
Owns: `App.tsx`, `BrowsePage.tsx`, `ForYouPage.tsx` card/filter code, new `components/` files.
- [x] A1 — PR #37 `ui/a1-novel-card`. Shared `NovelCard` (variants: cover tile, list row, detailed) + `RatingChip` + `StatusBadge`. Migrate For You, Discover, Browse, Related, search rows. Fix rating format (`toFixed(1)`), one amber token (`--chart-3`), drop Discover's duplicate "why it matches" vs "shared tropes". Fix the 3px card overflow.
- [x] A2 — PR #39 `ui/a2-shared-filters` (stacks on #37). Shared filter component + shared URL params; Discover "Refine matches" and Browse facets use it. (After A1.)
- [x] A3 — PR #40 `ui/a3-global-search` (stacks on #39). One global search: header search is the entry point; Discover's "Starting title" box becomes seed display/refine. (After A2.)

### Lane B — shell & navigation
Owns: `AppShell.tsx`, `components/ui/sidebar.*`, `app-shell.css`, `SettingsPage.tsx`, `preferences.ts`, `index.html`.
- [x] B1 — PRs #28 (collapse alignment) and #29 `ui/b1-sidebar-links`. Sidebar collapsed-button alignment (done on `ui/sidebar-polish`, uncommitted) + move GitHub/Report/Data repo links out of primary nav (footer or Settings "About").
- [x] B2 — PR #31. "Novels only" style chip on page headers when a format toggle is off.
- [x] B3 — PR #32 (For You home option already existed on main). Settings: add "For You" home option; per-route `document.title`.
- [x] B4 — PR #33. Mobile bottom tab bar (For You / Discover / Browse / Library); hamburger keeps secondary items. Hide-on-scroll optional.
- [x] B5 — PR #35. Fix tooltip-induced horizontal overflow on mobile (hidden `.ui-tooltip-content`) and hero backdrop overflow on the novel page.

### Lane C — new pages & profile
Owns: `profile/*`, new `ListPage`, onboarding, `routeState.ts` (adding views).
- [x] C1 — PR #34 `ui/c1-profile-split`. Split Profile into Library / Taste / Import & data; remove the duplicated Appearance block (link to Settings). Library becomes the "Library" nav destination B4 needs (coordinate: B4 links to `?view=profile` until C1 renames it).
- [x] C2 — PR #36 `ui/c2-list-page` (stacked on #34). Curated list page (`?view=list&id=`): all titles, curator, "on this list" badges become links. Hooks into For You shelf headings and the novel page lists card.
- [x] C3 — PR #38 `ui/c3-onboarding` (stacks on #36). First-run onboarding: "pick 5 you loved" (search + tap), writes to the local profile so For You works without import. Touches `ForYouPage.tsx` empty state only (note in A1 if conflicting).

## Dependencies / ordering notes
- A1 before A2 before A3 (all touch Discover/Browse).
- B4 depends on C1 only for naming; ship B4 pointing at Profile first.
- C3 depends on nothing; C2 benefits from A1's `NovelCard` row variant but can ship with the old row.
- Contrast fixes (light-theme badges, accent button, `--dim`) are a separate small PR "D1" that anyone can take; see audit P1-3/P1-4.

## Status log (append newest first)
- 2026-10-19 — All items A1–C3 plus D1 (#30) and the sidebar fix (#28) are squash-merged to `main` (#28–#40). Verified on main: typecheck, lint, pytest, no horizontal overflow on 8 views at 390/1280, per-route titles.

## Remaining follow-ups (not started)
- Light theme not checked on most new work; live API data mode untested; iOS safe-area on the bottom tab bar needs a real device.
- Browse format-scope reset reported but not reproduced; Discover language chip title-casing; Settings About link title size; duplicate search clear buttons.
- Onboarding saves picks as completed / 5 stars; `Select` drops `aria-label` (shared component gap).
- 2026-10-19 — All 12 items have PRs (#28-#40). Test-merged all stacks into a scratch branch: only conflicts are #30 (contrast) vs #37..#40 stack in `for-you.css` and `index.css` (mechanical; keep B5 tooltip rules, drop old `.fy-stats` rules because NovelCard replaced them). Combined result passes typecheck, lint and the 14-combo overflow check. Known gap: list page `document.title` says "For You"; should be the list name. Recommended merge order: A stack (#37,#39,#40), then #28, #30 (rebase), B stack (#29,#31,#32,#33,#35), C stack (#34,#36,#38).
- 2026-10-19 — A1 (#37), B1–B5 (#29,#31,#32,#33,#35, stacked), C1–C2 (#34,#36, stacked), D1 contrast (#30) are open PRs. A2, A3, C3 re-launched after an API rate limit killed the first run. Nothing merged yet. Known overlap: #30 and #37 both edit the For You match pill CSS (#37 should win on merge).
- 2026-10-19 — Roadmap created. Sidebar fix exists locally on branch `ui/sidebar-polish` in worktree `/Users/cbang/Developer/nuc-foryou-card-polish` (uncommitted).

## Notes / decisions
- Local data in `web/public/data` is the stale 2026-07-26 snapshot (~19% synopses); re-clone `novelcompass-data` before judging synopsis UI. Back up the old folder first.
- Preview-browser quirk: a tab resized from a phone preset back to desktop can stay stuck at 390px; open a fresh tab instead.
