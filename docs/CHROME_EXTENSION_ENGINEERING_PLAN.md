# Novel Compass Chrome Extension Engineering Plan

## 1. Purpose

Build a Manifest V3 Chrome extension that replaces the visual interface of
supported Novel Updates pages with a modern Novel Compass experience while
preserving Novel Updates as the source of live page data, authentication,
chapter navigation, and account actions.

The extension must progressively enhance Novel Updates rather than behave as a
separate crawler or unofficial replacement backend. When the extension cannot
safely recognize or operate a page, the original Novel Updates interface must
remain available and functional.

This document is an implementation plan. It defines the architecture, contracts,
work breakdown, sequencing, ownership boundaries, tests, and acceptance criteria
needed to split implementation across multiple agents after plan approval.

## 2. Product Outcome

On a supported Novel Updates series page, the user should receive:

- a redesigned title header, metadata, description, tags, and status;
- live release rows and chapter-opening behavior from the current page;
- live reviews, sorting, pagination, and login-aware actions;
- Novel Compass recommendations, insights, and comparison data;
- Novel Updates reading-list and rating controls where available;
- a persistent one-click switch to the untouched original interface;
- safe fallback to the original interface when parsing or rendering fails.

The extension should eventually support additional Novel Updates surfaces, but
the first complete milestone is the series page.

## 3. Scope

### 3.1 Milestone 1: series-page replacement

Supported route:

```text
https://www.novelupdates.com/series/<slug>/
```

Milestone 1 includes:

- Manifest V3 extension packaging;
- exact Novel Updates host and route restrictions;
- page recognition and series identity resolution;
- live series-page parsing;
- redesigned React series page;
- Overview, Chapters, Reviews, and Similar sections;
- chapter navigation delegated to preserved Novel Updates controls;
- review display and native action delegation;
- Novel Compass static recommendation integration;
- extension-local profile and preferences;
- original-view toggle and automatic fallback;
- logged-out fixtures and a user-captured logged-in fixture workflow;
- unit, integration, extension-build, and browser smoke tests.

### 3.2 Follow-up milestones

These are architecturally anticipated but are not required for Milestone 1:

1. Search results and series finder.
2. Latest releases and homepage feeds.
3. Reading-list and profile replacement.
4. Recommendation-list pages.
5. Cross-device profile sync.
6. Firefox or other Chromium-browser packaging.

### 3.3 Non-goals

Milestone 1 will not:

- crawl Novel Updates in the background;
- bypass login, CAPTCHA, challenges, access controls, or link protections;
- read or export authentication cookies;
- hard-code private Novel Updates AJAX endpoints when native UI delegation works;
- submit ratings, reviews, reports, or reading-list changes without a direct user
  gesture;
- bundle or execute remotely hosted JavaScript;
- require the Python API, SQLite, or scraper to run in the browser;
- replace every Novel Updates route in the first release;
- remove the existing standalone Novel Compass website.

## 4. Observed Series-Page Behavior

The planning inspection used:

```text
https://www.novelupdates.com/series/i-became-a-regressed-mercenary/
```

The logged-out page currently exposes:

- title, type, language, genres, tags, author, year, and publication state;
- rating average, vote count, and rating distribution;
- activity and reading-list rankings;
- description and associated names;
- recommendation lists;
- a latest-release table with date, translation group, and chapter label;
- release pagination through `?pg=<number>#myTable`;
- server-rendered reviews with reviewer, rating, date, reading progress, body,
  likes, permalink, and report/login actions;
- review ordering controls for likes and date;
- login-aware review form state.

The inspected logged-out release rows did not contain direct outbound chapter
URLs. Chapter labels were rendered as spans, and Novel Updates loaded its own
chapter-link script. The authenticated contract must therefore be verified with
a user-captured logged-in fixture before chapter behavior is considered stable.

## 5. Architecture

### 5.1 Runtime components

```text
Novel Updates document
  |
  | read-only parsing and delegated user actions
  v
Content script bridge
  |
  | typed messages
  v
Shadow DOM React replacement UI
  |
  +--> Novel Updates live-page adapter
  |
  +--> Novel Compass static data source
  |
  +--> extension-local profile/preferences
  |
  v
Manifest V3 service worker
  |
  +--> extension lifecycle and settings
  +--> remote static-data fetches when needed
  +--> cache/version coordination
```

### 5.2 Preserve, hide, and proxy

The extension must preserve the original Novel Updates DOM.

1. Classify and parse the document.
2. Validate a minimum viable page contract.
3. Mount a new Shadow DOM host adjacent to the original application.
4. Hide the original interface using one reversible root-level class.
5. Render the replacement UI.
6. Delegate protected or session-dependent actions to preserved original
   elements.
7. Restore the original interface on request or on fatal extension failure.

The content script must never permanently rewrite or delete the source DOM.

### 5.3 Isolation boundaries

- **Page adapter:** understands Novel Updates markup and produces normalized
  records.
- **Bridge:** resolves action handles and forwards explicit user actions.
- **React UI:** renders normalized data and never depends on Novel Updates CSS
  selectors.
- **Novel Compass data source:** provides catalog, recommendation, and insight
  data independently of the live page.
- **Service worker:** performs privileged Chrome API operations but does not own
  durable UI state.

These boundaries are required so markup changes can be repaired in adapters
without rewriting the interface.

## 6. Proposed Repository Structure

The exact names may change during implementation, but ownership should follow
these boundaries:

```text
extension/
  manifest.json
  vite.config.ts
  src/
    background/
      service-worker.ts
    content/
      bootstrap.ts
      bridge.ts
      page-visibility.ts
    adapters/
      contracts.ts
      page-classifier.ts
      series-page.ts
      series-actions.ts
    ui/
      ExtensionSeriesApp.tsx
      ExtensionErrorBoundary.tsx
      components/
        SeriesHero.tsx
        SeriesOverview.tsx
        ChapterList.tsx
        ReviewList.tsx
        SimilarNovels.tsx
        OriginalViewToggle.tsx
    storage/
      preferences.ts
      profile.ts
      migration.ts
    messaging/
      contracts.ts
  tests/
    fixtures/
    adapter/
    browser/

web/src/
  extension-shared/
    ...shared presentation or data-source components extracted from the site...
```

Do not move broad portions of `web/src` merely to satisfy this proposed tree.
Extract only components that are genuinely shared, and keep unrelated website
behavior stable.

## 7. Data Contracts

### 7.1 Page identity

```ts
type NovelUpdatesPageIdentity = {
  pageType: 'series';
  url: string;
  canonicalUrl?: string;
  slug: string;
  novelUpdatesId?: number;
  parserVersion: number;
};
```

Identity resolution order:

1. validated canonical series URL;
2. validated current series URL;
3. numeric Novel Updates ID found in stable page metadata;
4. exact slug resolution through the Novel Compass catalog;
5. normalized-title fallback, marked as lower confidence.

Low-confidence identity must never silently attach recommendations for a
different work.

### 7.2 Live series snapshot

```ts
type LiveSeriesSnapshot = {
  identity: NovelUpdatesPageIdentity;
  title: string;
  coverUrl?: string;
  description?: string;
  associatedNames: string[];
  authors: LinkedLabel[];
  artists: LinkedLabel[];
  genres: LinkedLabel[];
  tags: LinkedLabel[];
  language?: LinkedLabel;
  novelType?: LinkedLabel;
  year?: number;
  originalStatus?: string;
  translationStatus?: string;
  licensed?: boolean;
  completelyTranslated?: boolean;
  publishers: {
    original: LinkedLabel[];
    english: LinkedLabel[];
  };
  releaseFrequency?: string;
  rating?: LiveRating;
  rankings?: LiveRankings;
  recommendationLists: LinkedLabel[];
  releases: LiveReleasePage;
  reviews: LiveReviewPage;
  capabilities: SeriesPageCapabilities;
  warnings: ParseWarning[];
};
```

### 7.3 Releases

```ts
type LiveRelease = {
  actionId: string;
  dateLabel: string;
  dateIso?: string;
  group: LinkedLabel;
  chapterLabel: string;
  volumeLabel?: string;
  isActionAvailable: boolean;
};

type LiveReleasePage = {
  rows: LiveRelease[];
  currentPage: number;
  pageLinks: Array<{ page: number; url: string }>;
  previousUrl?: string;
  nextUrl?: string;
  groupFilterAvailable: boolean;
};
```

`actionId` is an opaque, page-lifetime identifier held by the bridge. React must
not receive selectors, inline JavaScript, or raw event-handler code.

### 7.4 Reviews

```ts
type LiveReview = {
  actionIds: {
    expand?: string;
    like?: string;
    report?: string;
  };
  permalink?: string;
  reviewer: LinkedLabel;
  reviewerAvatarUrl?: string;
  rating?: number;
  postedAtLabel: string;
  postedAtIso?: string;
  progressLabel?: string;
  body: ReviewContentBlock[];
  isTruncated: boolean;
  likeCount?: number;
};

type LiveReviewPage = {
  rows: LiveReview[];
  total?: number;
  order: 'likes' | 'date' | 'unknown';
  sortActionIds: {
    likes?: string;
    date?: string;
  };
  writeReviewActionId?: string;
  loginRequired: boolean;
};
```

Review content must be normalized into text, paragraphs, and a small allowlist
of formatting. Raw Novel Updates HTML must not be inserted into React.

### 7.5 Capability flags

The UI must render from observed capabilities rather than assuming every
account state exposes every control:

```ts
type SeriesPageCapabilities = {
  canOpenChapters: boolean;
  canFilterReleaseGroups: boolean;
  canUseReadingList: boolean;
  canRate: boolean;
  canLikeReviews: boolean;
  canReportReviews: boolean;
  canWriteReview: boolean;
  isLoggedIn: boolean | 'unknown';
};
```

## 8. Action Delegation

### 8.1 Principles

- Every external or account-changing action requires a user gesture.
- The bridge verifies that the original target still exists and belongs to the
  current parsed page generation.
- React sends an opaque action ID, never a selector or script.
- The bridge invalidates all action IDs after navigation or relevant DOM
  replacement.
- Failed actions restore or reveal the corresponding original NU control.
- No account action is optimistically reported as successful without an
  observable confirmation.

### 8.2 Action lifecycle

```text
Parse source element
  -> register element in page-lifetime action registry
  -> expose opaque action ID
  -> render modern control
  -> user clicks modern control
  -> validate page generation and source element
  -> dispatch native click or navigate through a validated URL
  -> observe navigation or DOM state change
  -> reparse affected section
```

### 8.3 Chapter opening

Chapter handling must support three observed/anticipated forms:

1. A stable validated `https:` URL is present: navigate normally.
2. A Novel Updates click handler resolves the destination: delegate to the
   original element.
3. No usable action exists: mark the chapter unavailable and offer original
   view.

The implementation must not infer publisher URLs from chapter/group names.

### 8.4 Mutation handling

Use a narrowly scoped `MutationObserver` for sections that NU updates in place,
such as:

- review sorting or expansion;
- group filtering;
- reading-list controls;
- rating state.

Observers must:

- debounce reparsing;
- disconnect during extension teardown;
- ignore mutations inside the extension Shadow DOM;
- reparse only the affected section;
- prevent render-observer feedback loops.

## 9. Novel Compass Integration

### 9.1 Static mode

The extension should initially use `StaticDataSource`. It must not depend on
FastAPI or a local Python process.

Required changes:

- allow an explicit extension data base URL;
- support `chrome-extension://` asset URLs;
- preserve schema and algorithm-version validation;
- keep API mode out of the default extension build;
- surface unavailable or incompatible recommendation data without affecting
  the live NU content.

### 9.2 Dataset packaging strategy

The current static export is approximately 163 MB and contains hundreds of
files. Shipping the entire dataset in every extension update is undesirable.

Milestone 1 should implement one of these explicitly chosen modes:

- **Development mode:** bundled local snapshot for deterministic tests.
- **Release mode:** small packaged bootstrap plus remote immutable data shards.

Remote resources may contain data only, not executable code. The extension
should:

- fetch a versioned manifest;
- validate schema and algorithm versions;
- restrict fetches to one configured HTTPS data origin;
- cache shards by dataset version;
- evict superseded versions;
- distinguish network failure from missing catalog membership;
- retain a minimal offline experience when cached data exists.

The release-data host and Web Store privacy disclosure are release decisions and
must not block local unpacked-extension testing.

### 9.3 Profile storage

The extension has a different origin from localhost and GitHub Pages. Existing
IndexedDB data will not automatically transfer.

Milestone 1 must:

- keep profile data local by default;
- provide JSON/HTML import using existing parser behavior where applicable;
- define an explicit export/import migration path;
- avoid cookie access;
- isolate extension preferences from website preferences;
- document that changing the unpacked extension ID resets its storage origin.

## 10. Security and Privacy Requirements

- Restrict content scripts to `https://www.novelupdates.com/*`.
- Verify protocol, origin, and supported route again at runtime.
- Do not request `<all_urls>`, cookies, browsing history, or unrelated hosts.
- Request only permissions used by current features.
- Treat all source-page text and attributes as untrusted input.
- Allow only `https:` Novel Updates or validated external navigation targets.
- Reject `javascript:`, `data:`, malformed, and unexpected-origin action URLs.
- Sanitize review formatting with an explicit allowlist.
- Do not execute inline handlers copied from the source document.
- Do not expose extension resources unnecessarily as web-accessible resources.
- Do not log profile contents, reviews, chapter destinations, or account state
  to remote telemetry.
- Do not transmit user reading data in Milestone 1.
- Provide a clear extension disclosure describing page access and local storage.

## 11. User Experience and Failure Recovery

### 11.1 Activation

The extension may enable replacement automatically on recognized series routes
after the user enables the feature. The setting should support:

- redesign enabled;
- original view for the current page;
- redesign disabled globally;
- reset extension preferences.

The original-view control must remain reachable even when a React child
component fails.

### 11.2 Loading

Avoid displaying the old page for a long interval and then abruptly replacing
it. Recommended sequence:

1. Apply a lightweight initialization marker.
2. Parse and validate quickly.
3. Mount the replacement shell.
4. Reveal live NU content immediately.
5. Load Novel Compass recommendations asynchronously.

Do not hide the original page until minimum parsing succeeds.

### 11.3 Partial failure

Each section has an independent state:

- live content ready;
- loading Compass enhancement;
- Compass enhancement unavailable;
- NU action unavailable;
- login required;
- unsupported markup.

Recommendation failure must not hide releases or reviews. Review parse failure
must not hide chapter navigation.

### 11.4 Accessibility

- Preserve semantic headings and landmark order.
- Provide keyboard access for tabs, filters, release rows, and original view.
- Restore focus after delegated actions when no navigation occurs.
- Announce section updates and errors appropriately.
- Do not rely only on color for status or rating.
- Respect reduced-motion preferences.
- Maintain usable behavior at 200% zoom and narrow desktop widths.

## 12. Testing Strategy

### 12.1 Fixtures

Commit sanitized, minimal fixtures for:

- logged-out series page with releases and reviews;
- series page with no reviews;
- series page with no releases;
- multiple release groups and pagination;
- truncated and expanded reviews;
- malformed or changed required markup;
- login/challenge/maintenance page detection;
- authenticated series page captured locally by the user and sanitized before
  commit.

Fixtures must remove usernames or identifiers not needed by the test contract.
Do not commit cookies, tokens, nonces tied to an active session, or private
profile content.

### 12.2 Unit tests

Test:

- page classification;
- slug and numeric-ID resolution;
- every normalized parser field;
- whitespace, Unicode, missing-field, and malformed-link handling;
- URL validation;
- capability derivation;
- review-content sanitization;
- action-registry invalidation;
- release and review pagination parsing;
- extension storage migrations.

### 12.3 Component tests

Test:

- full and partial series snapshots;
- unavailable chapter actions;
- logged-out review controls;
- recommendation loading and failure;
- original-view restoration;
- error-boundary recovery;
- keyboard navigation and accessible naming.

### 12.4 Browser tests

Run the unpacked extension against local fixture pages first. Browser smoke tests
must verify:

1. Supported pages are recognized.
2. Original DOM remains present.
3. Replacement UI mounts inside Shadow DOM.
4. Original view toggles without reload.
5. Delegated chapter action reaches the fixture target.
6. Review sort or expansion triggers a section reparse.
7. Unsupported markup stays in original view.
8. Recommendations load from the deterministic test snapshot.
9. Reload and back/forward navigation do not duplicate the extension root.
10. No content script runs on unrelated origins.

Live NU testing is a manual acceptance step, not a deterministic CI dependency.

### 12.5 Build verification

CI should verify:

- TypeScript;
- lint and formatting;
- existing Python and frontend tests;
- extension unit/component tests;
- extension production build;
- valid Manifest V3 JSON;
- absence of remote executable code;
- absence of unexpected permissions;
- extension ZIP integrity;
- deterministic fixture smoke test.

## 13. Work Breakdown

Tasks are grouped into workstreams suitable for parallel agents. An agent should
own only the listed paths unless coordination explicitly expands its scope.

### EP-000: approve architecture and milestone

**Owner:** primary agent/user  
**Dependencies:** none  
**Deliverable:** approved version of this document  
**Acceptance:**

- Milestone 1 scope is confirmed.
- Data packaging direction is confirmed for local testing.
- Original-DOM preservation and native action delegation are accepted.

### EP-100: extension build and Manifest V3 shell

**Suggested ownership:** `extension/manifest.json`, extension build config,
background bootstrap, extension HTML entry points  
**Dependencies:** EP-000  
**Can run with:** EP-200, EP-300, EP-400  
**Deliverables:**

- unpacked extension build;
- exact host match;
- service worker;
- content-script entry;
- development and production build commands.

**Acceptance:**

- Chrome loads the unpacked extension without manifest errors.
- Script runs on supported NU URLs and nowhere else.
- Build contains no remote executable JavaScript.
- Existing website build remains unchanged.

### EP-200: page contracts, classifier, and fixture corpus

**Suggested ownership:** `extension/src/adapters/contracts.ts`,
`page-classifier.ts`, sanitized fixtures, adapter test helpers  
**Dependencies:** EP-000  
**Can run with:** EP-100, EP-300, EP-400  
**Deliverables:**

- normalized contracts;
- route/origin validator;
- page classifier;
- fixture-loading test infrastructure;
- logged-out fixture variants.

**Acceptance:**

- supported series pages classify deterministically;
- challenge/login/unsupported pages do not activate replacement;
- identity confidence is explicit;
- fixture sanitization is documented.

### EP-210: live series metadata parser

**Suggested ownership:** `extension/src/adapters/series-page.ts` and its tests  
**Dependencies:** EP-200  
**Can run with:** EP-220, EP-230  
**Deliverables:**

- metadata, description, names, people, tags, status, ratings, and rankings
  parser;
- warnings for optional missing sections;
- fatal validation for missing identity/title.

**Acceptance:**

- all supported fixture fields normalize correctly;
- missing optional fields do not fail the page;
- malformed links are rejected;
- no parser emits raw executable markup.

### EP-220: release parser and action registry

**Suggested ownership:** release parsing, action-registry implementation, URL
validation, release tests  
**Dependencies:** EP-200  
**Can run with:** EP-210, EP-230  
**Deliverables:**

- release-page parser;
- pagination model;
- opaque action registry;
- chapter and group-filter delegation;
- stale-generation invalidation.

**Acceptance:**

- release metadata and page links match fixtures;
- direct URLs and delegated elements use separate validated paths;
- stale action IDs fail closed;
- unavailable actions expose a recoverable state.

### EP-230: review parser and native action bridge

**Suggested ownership:** review parsing, sanitization, review action delegation,
review tests  
**Dependencies:** EP-200  
**Can run with:** EP-210, EP-220  
**Deliverables:**

- review normalization;
- formatting sanitizer;
- sort, expand, like, report, and write-review action handles when present;
- login-required state.

**Acceptance:**

- reviewer, rating, progress, body, likes, and permalink parse correctly;
- unsafe markup and URLs are discarded;
- account controls are not synthesized when unavailable;
- post-action reparse updates the review section.

### EP-300: extension page host and reversible visibility

**Suggested ownership:** content bootstrap, Shadow DOM host, original-page
visibility controller, error boundary  
**Dependencies:** EP-100, EP-200  
**Can run with:** EP-210, EP-220, EP-230, EP-400  
**Deliverables:**

- idempotent mount/unmount;
- reversible original-page hiding;
- original-view toggle outside fragile child UI;
- fatal-error restoration.

**Acceptance:**

- original DOM is never deleted;
- repeated initialization creates only one extension root;
- UI exceptions restore an operable original page;
- extension styles do not leak into NU and NU styles do not leak into the
  extension root.

### EP-310: redesigned series interface

**Suggested ownership:** extension series UI and extension-specific CSS  
**Dependencies:** EP-210, EP-220, EP-230, EP-300  
**Can run with:** EP-410, EP-500  
**Deliverables:**

- series hero;
- Overview, Chapters, Reviews, and Similar navigation;
- release filtering/pagination controls;
- review cards and states;
- responsive and accessible layout.

**Acceptance:**

- complete and partial snapshots render without crashes;
- all delegated actions show meaningful pending/failure behavior;
- keyboard navigation works;
- original view remains reachable;
- no account capability is implied when absent.

### EP-400: shared Novel Compass data integration

**Suggested ownership:** narrow shared-component extraction, extension data-source
adapter, deterministic mini snapshot  
**Dependencies:** EP-000  
**Can run with:** EP-100, EP-200, EP-300  
**Deliverables:**

- extension-compatible `StaticDataSource` construction;
- identity-to-catalog resolution;
- packaged deterministic dataset for tests;
- shared recommendation/insight presentation components.

**Acceptance:**

- extension does not call the Python API by default;
- schema incompatibility is reported locally;
- unresolved series remains usable without Compass enhancements;
- website static and API modes still pass existing tests.

### EP-410: release dataset loading and caching

**Suggested ownership:** service-worker data fetch/cache module and tests  
**Dependencies:** EP-100, EP-400  
**Can run with:** EP-310, EP-500  
**Deliverables:**

- versioned manifest loading;
- HTTPS origin allowlist;
- cache lookup and version eviction;
- offline/cached/unavailable state;
- configuration for local bundled and release remote modes.

**Acceptance:**

- only the configured data origin is accessed;
- cached compatible data works offline;
- incompatible or incomplete datasets fail explicitly;
- code is always packaged locally.

### EP-500: extension-local storage and migration

**Suggested ownership:** extension preferences/profile storage and tests  
**Dependencies:** EP-100  
**Can run with:** EP-210 through EP-410  
**Deliverables:**

- enable/disable and original-view preferences;
- extension-local profile adapter;
- export/import migration path;
- schema-versioned storage.

**Acceptance:**

- no account/profile data is transmitted;
- corrupt or older storage fails safely or migrates;
- clearing extension data is explicit;
- existing website storage behavior is unchanged.

### EP-600: browser harness and CI

**Suggested ownership:** extension browser tests, packaging validation, CI changes  
**Dependencies:** EP-100, EP-300, EP-310, EP-400  
**Can run with:** EP-410, EP-500  
**Deliverables:**

- fixture-host browser harness;
- deterministic extension smoke suite;
- build and ZIP verification;
- permission and remote-code checks.

**Acceptance:**

- all browser cases in section 12.4 pass;
- current repository checks continue to pass;
- CI does not depend on live Novel Updates;
- failure artifacts make parser/UI failures diagnosable.

### EP-700: authenticated fixture validation

**Owner:** primary agent with user-provided browser session  
**Dependencies:** EP-220, EP-230, EP-310  
**Deliverables:**

- sanitized logged-in fixture;
- documented chapter-action contract;
- reading-list/rating/review capability observations;
- adapter updates for confirmed authenticated variants.

**Acceptance:**

- no credentials, cookies, or active tokens enter the repository;
- chapter opening works through supported native delegation;
- logged-in and logged-out pages both retain original-view fallback;
- account mutations occur only from direct user gestures.

### EP-800: manual browser acceptance and hardening

**Owner:** primary agent and user  
**Dependencies:** EP-210 through EP-700  
**Deliverables:**

- unpacked extension test build;
- manual acceptance checklist;
- documented known limitations;
- go/no-go assessment for Web Store preparation.

**Acceptance:**

- user can install the unpacked build;
- example series page renders correctly;
- chapters open in the expected flow;
- reviews and sorting behave correctly;
- recommendations load;
- original-view toggle always recovers the NU page;
- unrelated NU pages and unrelated origins are not modified.

## 14. Parallel Execution Plan

After EP-000 approval, implementation can fan out in this order.

### Wave 1: independent foundations

- Agent A: EP-100 extension shell.
- Agent B: EP-200 contracts, classifier, and fixtures.
- Agent C: EP-400 static-data integration investigation and mini dataset.
- Primary agent: integration conventions, task review, and collision management.

### Wave 2: parser and host implementation

- Agent A: EP-300 Shadow DOM host and visibility recovery.
- Agent B: EP-210 metadata parser.
- Agent C: EP-220 release parser and action registry.
- Primary agent or next available agent: EP-230 review parser and bridge.

EP-210, EP-220, and EP-230 should share contracts from EP-200 but own different
implementation files and fixtures where possible.

### Wave 3: product integration

- Agent A: EP-310 redesigned interface.
- Agent B: EP-410 caching and release data loading.
- Agent C: EP-500 local storage and migration.
- Primary agent: merge integration, contract adjustments, and end-to-end review.

### Wave 4: validation

- Agent A: EP-600 browser harness and CI.
- Primary agent plus user session: EP-700 authenticated validation.
- Primary agent plus user: EP-800 manual acceptance.

Do not begin broad UI work before parser contracts stabilize. Do not begin live
authenticated action support before a sanitized logged-in fixture exists.

## 15. Integration Rules for Parallel Agents

- Each agent receives one task ID, explicit owned paths, and acceptance checks.
- Agents must not commit unrelated formatting or dependency upgrades.
- Shared contracts are changed only by the primary agent or after notifying the
  primary agent.
- New dependencies require a stated reason and should be avoided when browser or
  platform APIs suffice.
- Every agent reports:
  - files changed;
  - behavior implemented;
  - tests run and results;
  - assumptions and unresolved risks.
- The primary agent reviews each result before assigning dependent work.
- Test fixtures are append-only during parallel parser work unless coordinated.
- Existing website functionality remains part of every integration check.

## 16. Definition of Done for Milestone 1

Milestone 1 is complete only when:

- the extension builds as Manifest V3 and installs unpacked;
- only supported Novel Updates series pages are replaced;
- the original page remains intact and recoverable;
- series metadata, chapters, and reviews render from the live document;
- chapter behavior works in confirmed logged-out and logged-in states;
- review sorting/expansion and available actions delegate safely;
- Novel Compass recommendations and insights load without Python;
- recommendation failure never blocks live NU content;
- permissions are narrow and documented;
- profile data remains local;
- unit, component, browser, existing frontend, and Python checks pass;
- the user completes manual browser testing on representative series pages;
- known unsupported states are documented and fail back to original view.

## 17. Decisions Required Before Implementation

The following defaults are recommended:

1. **Initial route:** series pages only.
2. **Activation:** redesign enabled by user preference, with per-page original
   view.
3. **Navigation:** normal NU page loads, not client-side interception.
4. **Chapter actions:** native delegation, never inferred publisher URLs.
5. **Account actions:** native delegation after explicit user gestures.
6. **Data during development:** bundled deterministic mini snapshot.
7. **Release dataset:** remote immutable data shards plus local cache.
8. **UI mounting:** Shadow DOM with preserved hidden NU DOM.
9. **Minimum Chrome version:** 116 if side-panel functionality is included;
   otherwise choose based on the APIs actually used.
10. **Distribution:** unpacked local testing first; Web Store work after browser
    acceptance.

Unless the user changes these decisions, implementation tasks should treat them
as the approved baseline.
