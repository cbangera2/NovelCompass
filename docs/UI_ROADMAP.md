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
- [ ] A1. Shared `NovelCard` (variants: cover tile, list row, detailed) + `RatingChip` + `StatusBadge`. Migrate For You, Discover, Browse, Related, search rows. Fix rating format (`toFixed(1)`), one amber token (`--chart-3`), drop Discover's duplicate "why it matches" vs "shared tropes". Fix the 3px card overflow.
- [ ] A2. Shared filter component + shared URL params; Discover "Refine matches" and Browse facets use it. (After A1.)
- [ ] A3. One global search: header search is the entry point; Discover's "Starting title" box becomes seed display/refine. (After A2.)

### Lane B — shell & navigation
Owns: `AppShell.tsx`, `components/ui/sidebar.*`, `app-shell.css`, `SettingsPage.tsx`, `preferences.ts`, `index.html`.
- [ ] B1. Sidebar collapsed-button alignment (done on `ui/sidebar-polish`, uncommitted) + move GitHub/Report/Data repo links out of primary nav (footer or Settings "About").
- [ ] B2. "Novels only" style chip on page headers when a format toggle is off.
- [ ] B3. Settings: add "For You" home option; per-route `document.title`.
- [ ] B4. Mobile bottom tab bar (For You / Discover / Browse / Library); hamburger keeps secondary items. Hide-on-scroll optional.
- [ ] B5. Fix tooltip-induced horizontal overflow on mobile (hidden `.ui-tooltip-content`) and hero backdrop overflow on the novel page.

### Lane C — new pages & profile
Owns: `profile/*`, new `ListPage`, onboarding, `routeState.ts` (adding views).
- [ ] C1. Split Profile into Library / Taste / Import & data; remove the duplicated Appearance block (link to Settings). Library becomes the "Library" nav destination B4 needs (coordinate: B4 links to `?view=profile` until C1 renames it).
- [ ] C2. Curated list page (`?view=list&id=`): all titles, curator, "on this list" badges become links. Hooks into For You shelf headings and the novel page lists card.
- [ ] C3. First-run onboarding: "pick 5 you loved" (search + tap), writes to the local profile so For You works without import. Touches `ForYouPage.tsx` empty state only (note in A1 if conflicting).

## Dependencies / ordering notes
- A1 before A2 before A3 (all touch Discover/Browse).
- B4 depends on C1 only for naming; ship B4 pointing at Profile first.
- C3 depends on nothing; C2 benefits from A1's `NovelCard` row variant but can ship with the old row.
- Contrast fixes (light-theme badges, accent button, `--dim`) are a separate small PR "D1" that anyone can take; see audit P1-3/P1-4.

## Status log (append newest first)
- 2026-10-19 — Roadmap created. Sidebar fix exists locally on branch `ui/sidebar-polish` in worktree `/Users/cbang/Developer/nuc-foryou-card-polish` (uncommitted).

## Notes / decisions
- Local data in `web/public/data` is the stale 2026-07-26 snapshot (~19% synopses); re-clone `novelcompass-data` before judging synopsis UI. Back up the old folder first.
- Preview-browser quirk: a tab resized from a phone preset back to desktop can stay stuck at 390px; open a fresh tab instead.
