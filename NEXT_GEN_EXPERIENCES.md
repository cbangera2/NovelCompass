# Next-Generation Novel Discovery: Validated Product and Technical Plan

## Product direction

The opportunity is not to clone Novel Updates. It is to make the existing
catalog easier to search, explain why two novels are related, preserve a
reader's context locally, and surface less obvious choices.

The project currently has a 2025 baseline of roughly 24,600 novels, tag
relationships, direct recommendation edges, related-series edges, and some
curated-list memberships. It supports both a FastAPI/SQLite runtime and a
precomputed static export for GitHub Pages. A saved-profile importer stores
normalized Reading, Completed, and Plan-to-read entries in IndexedDB.

## Corrections to the original proposal

Several attractive claims were not supported by the current data or code:

- “453k tags” was actually the approximate count of novel-to-tag links, not
  distinct tags.
- Synopsis/vector similarity is not consistently available and should not be
  marketed as semantic premise matching.
- Curator comments have not been reliably extracted, classified, or attributed.
  We cannot show invented S-tier verdicts or quoted commentary.
- A saved profile page contains created-list summaries, not list membership.
  Private-list contents must not be inferred.
- Reading HTML has progress strings, not a trustworthy total chapter history.
  Reading velocity and total chapters read cannot currently be calculated.
- Reading or completion status is not negative feedback. Anti-tropes require
  explicit “Not for me” feedback or sufficiently strong low ratings.
- A recommendation rank is not a calibrated probability. “94% match” is a
  normalized display score and must not be described as 94% certainty.
- The static catalog is not a guaranteed sub-5ms download: initial payload,
  device, caching, and network conditions matter.
- The site is not yet an offline PWA. GitHub Pages compatibility alone does not
  provide offline behavior.
- The prepared “2026” database is not current until discovery and refresh
  complete successfully. Bot challenges currently prevent that claim.

## Product principles

1. Every explanation must trace to stored evidence.
2. Display uncertainty and coverage: “based on 10 rated titles” is better than
   pretending a partial profile is comprehensive.
3. Keep profile HTML ephemeral and normalized profile data local by default.
4. Preserve feature parity between API and static modes whenever practical.
5. Separate explicit preferences from inferred behavior.
6. Never imply Novel Updates authentication or account synchronization.
7. Optimize static payloads before claiming instant or offline behavior.

## Prioritized experiences

### P0: trustworthy discovery

- Exact novel selection and canonical Novel Updates links
- Explainable relationship ranking with channel controls
- Advanced genre/tag/language/status/chapter filters
- Hidden-gem controls with Bayesian rating adjustment
- Read-status badges and hide/show imported titles
- Dataset freshness, coverage, and unavailable-state labels

### P1: transparent personalization

- A local taste snapshot derived only from a small, disclosed set of highly
  rated or completed titles
- Multi-seed rank fusion using existing per-seed candidate pools, with each
  seed contribution visible
- Explicit Love / Not for me signals stored locally and independently
- Candidate explanations that identify which selected favorites contributed
- Profile-aware “unread only” and “continue reading” views

### P1: decision tools

- Preset filter recipes such as smart protagonist, tragedy, completed binge,
  and no-harem romance
- Side-by-side comparison of two novels using known metadata and shared tags
- A list explorer only for lists whose membership is present in the active
  dataset

### P2: richer data and delivery

- Parse curator comments and tier labels with source URLs, provenance, and
  manual validation before exposing them
- Add compact list-membership artifacts to static exports
- Add service-worker caching with explicit dataset-size limits and update UI
- Add optional local activity history and exports
- Add calibrated recommendation evaluation from explicit user feedback

## Privacy and data limitations

- Imported HTML may contain identity, private list names, nonces, and session
  markup. It is parsed with `DOMParser`, never rendered, and never persisted.
- IndexedDB stores normalized entries and list summaries. Clearing the profile
  must delete all normalized profile data.
- Static hosting has no secure user account, cross-device synchronization, or
  server-side secret storage.
- Local preferences do not transfer between browsers unless the user exports
  and imports sanitized JSON.
- Unmatched slugs remain unresolved; they never receive fabricated novel IDs.
- Created-list summaries do not authorize or prove list membership.
- Profile analytics must disclose sample size, unmatched titles, missing
  categories, and dataset version.

## Implemented vertical slice: transparent taste snapshot

The profile page derives a small taste snapshot from up to 12 matched novels:

1. Prefer titles with explicit ratings, highest rating first.
2. Fill remaining sample slots with Completed titles.
3. Load those novels through the shared data-source interface, so the same code
   works with FastAPI or static detail JSON.
4. Count known genres and tags without inventing sentiment or anti-tropes.
5. Show the exact sample size, dataset version, and failures.

This is deliberately a descriptive snapshot, not a taste vector. It gives an
immediately useful summary while creating honest groundwork for later
multi-seed recommendations.

## Actionable roadmap

### Phase 1 — reliability and measurement

- Finish and validate static export parity fixtures.
- Add dataset coverage/freshness UI and artifact integrity checks.
- Cache recommendation pools and remove API N+1 queries.
- Establish offline/online performance budgets before making speed claims.

### Phase 2 — explicit personalization

- Persist Love / Not for me feedback locally with export/delete support.
- Add a 3–5-title favorites selector from the profile.
- Implement weighted multi-seed reciprocal-rank fusion in both modes.
- Explain per-seed support and keep raw component scores inspectable.

### Phase 3 — discovery workflows

- Add evidence-backed mood presets as saved filter recipes.
- Add compare view, unread queue, and continue-reading shortcuts.
- Add Bayesian hidden-gem ranking and explain its inputs.

### Phase 4 — curator intelligence

- Refresh and validate list memberships.
- Parse commentary with provenance and confidence flags.
- Expose tiers only when explicitly present in source text.
- Never quote or attribute commentary without its source record.

### Phase 5 — offline and evaluation

- Introduce a version-aware service worker after measuring artifact sizes.
- Cache only the search catalog and recently used details/recommendation pools.
- Add transparent local feedback evaluation and recommendation-quality metrics.
- Consider optional synchronization only with a separate privacy and security
  design.

## Acceptance gates

- API and static modes return equivalent results for fixed fixtures.
- No feature fabricates ratings, memberships, tags, curator opinions, or IDs.
- Every personalized surface states its sample and source.
- Raw imported HTML never appears in IndexedDB, logs, or rendered markup.
- A user can export and delete all local data.
- A static GitHub Pages deployment works under a non-root base path.
- “Current 2026 dataset,” “offline,” and performance claims appear only after
  measured validation.
