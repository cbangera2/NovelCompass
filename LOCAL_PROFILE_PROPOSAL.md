# Proposal: Local Profile Engine & 1-Click Profile HTML Importer

> Review status: the validated plan below supersedes any conflicting claims in
> the original proposal, especially “one-click complete history,” Dropped
> status, zero-risk storage, and creation of placeholder catalog novels.

## Validated Findings From the Saved cbboss Profile

The supplied HTML was inspected on July 25, 2026. It contains:

- profile identity and profile statistics
- 20 created-list summaries and their viewlist IDs
- 443 unique novels from the currently rendered **Reading** table
- per-row reading progress and optional user rating

It does not contain:

- Plan-to-Read or Completed rows
- a Dropped reading-list category
- followed-list contents
- review contents
- the novels contained inside each curated list

Novel Updates loads those tabs dynamically and replaces the same content
container. Saving the page preserves only the reading-list category currently
rendered. The importer must therefore support multiple files: open Reading,
Plan to Read, and Completed individually, wait for each table to load, and save
one HTML file for each desired category. A single file is still valid, but the
preview must state exactly which category and how many rows it contains.

The existing experimental `src/scraper/profile_parser.py` is not safe to use as
an importer. It scans every series link on the page, drops category, rating,
and progress information, and fabricates canonical novel IDs, ratings, votes,
and reader counts for unmatched titles. It should be replaced, not extended.
Canonical novels may only come from a trusted snapshot or a successfully
parsed Novel Updates series page.

## Revised Privacy and Security Position

Client-side parsing is privacy preserving and compatible with GitHub Pages, but
it is not “zero risk.” Saved profile HTML can include:

- username, avatar, user ID, and joined date
- private list names and descriptions
- page nonces and session-derived markup
- third-party scripts, links, and tracking markup

The importer must:

- parse with `DOMParser` without attaching the imported document to the page
- never execute scripts or render imported markup
- allowlist only Novel Updates profile selectors and URL shapes
- keep raw HTML in memory only
- persist normalized fields in IndexedDB, not the raw file or `localStorage`
- avoid logs and analytics containing imported data
- provide export, replace, merge, and complete-delete actions
- validate file size, page type, parser version, and detected category

## Revised Import Model

```typescript
interface LocalUserProfile {
  profile_id: string;
  parser_version: number;
  dataset_version: string;
  username?: string;
  imported_at: string;

  entries: Array<{
    novel_id?: number; // Resolved from the active catalog
    slug: string;
    imported_title: string;
    status: 'reading' | 'completed' | 'plan_to_read';
    rating?: number;
    progress?: string;
    source_file: string;
  }>;

  curated_lists: Array<{
    id: number;
    title: string;
    description?: string;
    series_count?: number;
    followers?: number;
    is_private?: boolean;
    membership_available: boolean;
  }>;
}
```

The slug is the stable import identity because the saved profile links do not
contain numeric series IDs. Resolve it against the shared catalog, which now
exports canonical slugs. Unmatched entries remain local unresolved records.
They must never receive synthetic IDs or made-up metadata.

In API mode, the user may explicitly queue an unmatched slug for the
`new_novel` crawl phase. A real numeric ID is assigned only after a successful
series-page parse. Static mode simply keeps it unmatched until a newer dataset
contains it.

## Revised Preference Model

Do not interpret every tag on an unfinished or low-rated novel as a disliked
tag. A user may stop because of translation quality, hiatus, availability, or
length. Imported ratings and explicit Love / Not for me feedback should be
stronger than inferred status.

Use prevalence-aware weights with shrinkage:

$$
\text{Affinity}(t) =
\frac{\sum_i w_{\text{status},i} w_{\text{rating},i}
      \mathbb{1}(t \in i)}
     {\alpha + \text{ProfileSupport}(t)}
\cdot \operatorname{IDF}(t)
$$

`alpha` prevents one or two titles from creating extreme preferences. Expose
the learned signals so the user can remove or disable incorrect inferences.

For “Favorites Mix,” begin with transparent multi-seed rank blending:

1. calculate each seed's normal recommendation channel ranks
2. normalize each seed independently
3. combine weighted seed scores
4. add a modest coverage bonus for candidates supported by multiple favorites
5. apply profile tag affinities as a separate, adjustable contribution

This fits the existing relationship-first system better than calling the
result a vector when many novels lack synopsis embeddings.

## Revised Implementation Plan

### Phase 1 — Sanitized fixtures and strict parser

1. Create sanitized fixtures for Reading, Plan to Read, and Completed.
2. Parse only `#profile_content3 .p_load_rl table` rows.
3. Detect status from `.am_mn.linkactive`, with an explicit override in preview.
4. Prefer the anchor `title` attribute over truncated visible text.
5. Accept only `https://www.novelupdates.com/series/<slug>/`.
6. Parse rating and progress as optional values; never invent defaults.
7. Parse profile identity and created-list summaries separately.
8. Return diagnostics and warnings instead of silently accepting partial data.

### Phase 2 — Import preview and catalog resolution

1. Show detected account, category, rows, duplicates, malformed rows, and
   matched/unmatched counts before confirmation.
2. Resolve by exact normalized slug, not fuzzy title.
3. Detect conflicting categories across files and let the user choose.
4. Let the user confirm, cancel, or download sanitized JSON.
5. Clearly label missing categories rather than presenting a partial import as
   complete history.

### Phase 3 — Versioned local profile store

1. Persist normalized data in IndexedDB with parser and dataset versions.
2. Fingerprint source files so accidental reimports can be detected.
3. Support replace and merge semantics.
4. Re-resolve unmatched slugs when the dataset version changes.
5. Provide Clear profile and Clear all local data actions.

### Phase 4 — Visible profile features

1. Add imported status and rating badges to recommendation cards and details.
2. Add Use as seed to cards and a profile quick picker.
3. Add Show read, Hide read, and Only unread controls.
4. Show a curated-list badge only when the active API database or static
   snapshot actually contains that list's membership.

Profile HTML contains list summaries, not membership. API mode can use the
existing `rec_list_items` data. Static mode will need a compact list-membership
artifact or must omit the badge.

### Phase 5 — Personalization

1. Implement multi-seed RRF blending with per-seed normalization.
2. Load tag facets once for static profile analysis instead of fetching
   hundreds of novel detail files.
3. Add a batched profile-resolution endpoint for API mode.
4. Weight explicit rating and feedback more heavily than inferred status.
5. Keep Curator boost, trope affinity, and negative signals independently
   adjustable.
6. Explain which profile signals changed each recommendation.

### Phase 6 — Tests and acceptance gates

Test:

- each saved category independently and as a multi-file merge
- the supplied file importing exactly 443 unique Reading slugs
- truncated titles, Unicode/mojibake, duplicate slugs, and missing ratings
- wrong page types, unsupported markup, oversized files, and hostile HTML
- no script execution, remote requests, raw-file persistence, or HTML rendering
- API/static catalog resolution parity
- dataset-version migration and newly resolved novels
- sparse profiles and contradictory ratings

Acceptance requires:

- a single saved file explicitly reports absent categories
- multiple category files preserve status, rating, and progress
- unmatched imports never create fabricated catalog novels
- list summary metadata never masquerades as list membership
- every stored field is visible in preview and removable
- API and static modes show identical badges for the same normalized profile

## 1. Executive Summary & Core Motivation

Currently, recommendation queries start from **a single seed novel** (e.g. *"Find novels like Lord of the Mysteries"*).

Every Novel Updates user has a personal reading profile containing:
- 400+ reading list novels (Reading, Completed, On Hold, Dropped, Plan to Read)
- Curated recommendation lists (e.g., *Peak Hidden Gems*, *Peak Yanderes*, *Peak Tragedy*)
- User reviews, ratings given, and favorite genres

Rather than hiding read novels, keeping them visible with **Status Badges** allows users to:
1. **Use any novel from their own reading list as an instant recommendation seed**.
2. **Build a comprehensive taste profile** from all their completed and favorite novels.
3. **Easily spot familiar titles** while exploring recommendations.

By supporting a **1-Click Profile HTML Upload** (`Ctrl+S` -> `Save Page As HTML`), users can drop their saved Novel Updates Profile page into the app. The browser parses their complete reading history in **under 5 milliseconds** using standard DOM parsing—**100% client-side, zero security risk, and 100% compatible with GitHub Pages**.

---

## 2. Key Features Powered by Profile HTML Upload

### Feature 1: Visible Status Badges & Instant "Use as Seed"
Instead of hiding novels you've read, recommendation cards show explicit, color-coded badges:
- 📖 **Reading** (Blue Badge)
- ✅ **Completed** (Green Badge)
- 📌 **Plan to Read** (Purple Badge)
- 🚫 **Dropped** (Red Badge)

Every card features a 1-click **"⚡ Use as Seed"** button, allowing you to instantly generate recommendations based on any novel from your reading list!

---

### Feature 2: Holistic Taste Profile & Favorite Trope Mining
Your entire reading list is analyzed to construct a **Personal Taste Vector**:
- **Completed & High-Rating Titles**: Extract shared tropes (e.g., `Cunning Protagonist`, `Time Loop`, `Dark`, `Kingdom Building`) to boost similar candidate novels.
- **Dropped Titles**: Identify anti-tropes (e.g., `Harem`, `Naive MC`, `Slow Pacing`) to apply gentle score penalties without hiding results entirely.

$$\text{Trope\_Affinity}(t) = \frac{\text{Count}(t \in \text{Completed}) - \text{Count}(t \in \text{Dropped})}{\text{Total\_Read}}$$

---

### Feature 3: Multi-Novel Taste Blending ("My Favorites Mix")
Select **3 to 5 favorite novels** directly from your imported reading list:

The engine computes a **blended preference vector**:
$$\vec{V}_{\text{user}} = \sum_{i \in \text{Favorites}} w_i \cdot \vec{V}_{\text{novel}_i}$$

Candidates connected to **multiple favorites** across different evidence channels (shared tropes, co-occurring lists, author relations) receive a multi-seed affinity boost.

---

### Feature 4: 1-Click Profile HTML Import (Zero Risk & Instant)
1. User saves their Novel Updates Profile page (`https://www.novelupdates.com/user/<username>/`) as an HTML file (`Ctrl+S`).
2. Drag and drop `profile.html` into the web application.
3. Browser's client-side `DOMParser` instantly extracts:
   - **400+ Reading List Titles** (Reading, Completed, Plan to Read, Dropped)
   - **Curated Lists** (Titles, viewlist URLs, item counts, follower counts)
   - **User Stats** (Total lists created, list followers, reviews)
4. Instantly populates your **Reading Badges**, **Seed Quick-Picker**, and **Personal Taste Vector**.

---

### Feature 5: Curator Gold Badge & Peak List Boosts
If your profile contains curated recommendation lists (e.g. *cbboss Peak Hidden Gems*, *Peak Yanderes*):
- Cards show a glowing badge: `⭐ Featured on your Peak Hidden Gems list`.
- Adds a **"Curator Boost"** toggle to favor titles endorsed on your own or followed curated lists.

---

## 3. Data Model & Browser Storage Schema

### Browser `localStorage` / `IndexedDB` Schema

```typescript
export interface LocalUserProfile {
  username: string;
  avatar_url?: string;
  joined_date?: string;
  total_list_followers?: number;
  updated_at: string;

  // Explicit Profile History (Parsed from Profile HTML)
  history: {
    reading_slugs: string[];        // Currently reading -> 📖 Badge
    completed_slugs: string[];      // Completed novels -> ✅ Badge (+1.5 Weight)
    plan_to_read_slugs: string[];   // Plan to read -> 📌 Badge
    dropped_slugs: string[];        // Dropped novels -> 🚫 Badge (-1.5 Weight)
    curated_list_ids: number[];     // User-created viewlist IDs
  };

  // Derived Preference Vector
  computed_preferences: {
    preferred_tag_weights: Record<string, number>;  // e.g. {"cunning protagonist": 1.8, "time loop": 1.5}
    penalized_tag_weights: Record<string, number>;  // e.g. {"harem": -2.0, "naive mc": -1.5}
    preferred_genres: string[];
    preferred_languages: string[];
  };

  // UI Settings
  settings: {
    show_reading_badges: boolean;
    hide_read_novels: boolean;       // Off by default
    hidden_gem_boost_default: boolean;
    default_result_limit: number;
  };
}
```

---

## 4. Proposed Profile Upload UI Mockup

```text
┌─────────────────────────────────────────────────────────────────────────┐
│  👤 My Profile & Reading List                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [ 📂 Drag & Drop Profile HTML File (e.g. cbboss_profile.html) ]        │
│                                                                         │
│  ✅ Loaded Profile: cbboss (2,915 List Followers)                       │
│  • 443 Reading titles imported · Completed and Planned not yet imported │
│  • 20 Curated Lists Connected (Peak Hidden Gems, Peak Yanderes, etc.)   │
│                                                                         │
│  ⚡ Quick Seed Picker from Your List:                                   │
│  [ Lord of the Mysteries ] [ Trash of the Count's Family ] [ A Regressor's Tale ]│
│                                                                         │
│  📊 Learned Trope Affinities:                                          │
│  Top Tropes:  Cunning Protagonist (+2.4) · Time Loop (+1.8) · Dark (+1.5)│
│  Anti-Tropes: Harem (-2.5) · Naive MC (-1.9)                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Implementation Roadmap

1. **Client-Side Profile HTML Parser (`web/src/services/profileParser.ts`)**:
   - Use browser `DOMParser` to extract novel links `/series/<slug>/` and list badges directly from uploaded HTML file.
2. **Profile Store (`web/src/services/profileStore.ts`)**:
   - Save imported user profile, reading list badges, and list IDs in `localStorage`.
3. **App.tsx Integration**:
   - Add status badges (📖 Reading, ✅ Completed, 📌 Plan to Read, 🚫 Dropped) to recommendation cards.
   - Add 1-click **"⚡ Use as Seed"** button on cards and in the Quick Seed Picker.
