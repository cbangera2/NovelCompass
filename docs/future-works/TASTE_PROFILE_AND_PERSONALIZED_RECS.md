# Taste Profile & Personalized Recommendations

Ideas for turning a local library into **custom recs** that know what you have read and what you like — without reinventing the ranking stack we already ship.

This is a **product / design note**, not an implementation plan. Existing multi-source identity work stays in:

- [`MULTI_SOURCE_INGESTION_ANALYSIS.md`](./MULTI_SOURCE_INGESTION_ANALYSIS.md)
- [`ANILIST_MULTIMEDIA_INTEGRATION.md`](./ANILIST_MULTIMEDIA_INTEGRATION.md)

---

## 1. Inventory: what we already do

### Recommendation core (server + static)

| Capability | Where | Notes |
|---|---|---|
| **Single-seed discovery** | Discover UI, `/api/recommend`, static rec shards | One title → similar titles |
| **5 candidate channels** | `CandidateGenerator` | `vector`, `tag`, `direct_rec`, `rec_list`, `structural` |
| **RRF fusion** | `rrf_ranker.calculate_rrf_scores` | Weighted reciprocal rank fusion |
| **Channel weight sliders** | Discover controls | Tag / direct rec / list / structural + hidden-gem strength |
| **Hidden-gem boost** | `apply_hidden_gem_boost` | Inverse popularity on RRF score |
| **MMR diversity** | `apply_mmr_reranking` | Available in engine (check live path) |
| **Hard filters** | `HardFilterEngine` | Tags, genres, language, rating, year, completed, chapters, media_type, **exclude_novel_ids** |
| **Explainability** | `EvidenceExplainer` | Shared tags, lists, ranks per channel |
| **Match %** | `ranking_contract` | Stable percent for UI |
| **Cross-media filtering** | media_type prefs / format switcher | Novel / manga / anime scope |
| **Score normalization** | `normalize_anilist_rating`, popularity scaling | Cross-source comparable metrics |

### Local profile (browser only)

| Capability | Where | Notes |
|---|---|---|
| **NU HTML import** | `profile/parser.ts` | Reading / completed / plan lists |
| **AniList GDPR import** | `profile/anilistGdpr.ts` | Full list + scores + progress; titles via GraphQL |
| **JSON backup import/export** | `transfer.ts` | Full `LocalUserProfile` round-trip |
| **IndexedDB store** | `store.ts` | Merge / replace / clear |
| **Catalog resolve** | `resolve.ts`, `/api/resolve-slugs`, `/api/resolve-ids` | Match library → catalog IDs |
| **Library UI** | `ProfilePage` | Search, status filter, ratings, seed from entry |
| **Taste snapshot** | `ProfilePage` | Top **12** rated/completed → genre/tag counts only |
| **AniList-style stats** | `ProfileAnalytics` + `profileStats` | KPIs, status pie, score/year/activity area charts, genres |
| **Feedback signals** | Discover + Novel page | `love` / `read` / `not_for_me` on **recommendations**, stored in profile |
| **Client-side rec filtering** | `App.tsx` | Hide `not_for_me`; optional hide titles already in library |
| **Reading status on recs** | Discover cards | Set reading / completed / plan / paused / dropped |

### Explicitly **not** built yet

- Multi-seed / whole-library recommendation (“for me”)
- Taste vector or preference model that feeds the ranker
- Server-side use of profile ratings or feedback (all personalization is client-side post-filter)
- Negative taste from **dropped** / low ratings
- Franchise-aware “already consumed this story as anime” exclusion
- Curated list **membership** (we only store list metadata from NU HTML)
- Collaborative filtering from other users’ libraries
- Cold-start quiz without a library

---

## 2. Realistic library shape (from a live export)

Observed on a real `novel-compass-profile-*.json` (structure only; personal file stays gitignored):

| Signal | Approx. | Implication |
|---|---:|---|
| Entries | ~1.4k | Scale is “whole library,” not a shortlist |
| Matched to catalog | ~35% | Taste models must tolerate unmatched AniList rows |
| Rated | ~30% | Sparse ratings; do not require every row scored |
| Feedback | **0** | Love/Not-for-me is underused; library ratings matter more |
| Status mix | Heavy **reading** + completed + plan | AniList CURRENT inflates “reading”; weight completed/high ratings more |
| Sources | NU HTML + AniList GDPR | Dual-source is the default advanced user |
| Curated lists | Titles only, no members | List affinity is weak until membership is imported |
| media_kind / dates | Often missing on older exports | Infer from slug / id ranges; don’t hard-require |

Design rule: **prefer signals that already exist on import** (status, rating, progress, matched id) over new UI burden.

---

## 3. Gaps (where “custom recs” fall short today)

1. **Discover is still one-seed.** Profile is a library browser + seed picker, not a preference engine.
2. **Taste snapshot is shallow.** 12 titles → unweighted genre/tag frequency. No score weighting, no negatives, no format split.
3. **Library is not excluded from ranking.** `exclude_novel_ids` only drops the seed server-side; “hide library titles” is a client filter after fetch (wastes slots, hurts static pools).
4. **Feedback is local post-filter only.** `not_for_me` never reshapes candidates; `love` never boosts similar works.
5. **Dropped / low scores unused.** Perfect negative signal from GDPR + NU stars.
6. **Cross-media already-read.** Watched anime of a novel you finished still looks like a fresh rec unless the user filters formats.
7. **Unmatched library is invisible to recs.** AniList-only IDs never seed or exclude until hydrated into the catalog.
8. **Progress unused.** “Reading c106/c137” could mean “want same-length epics” or “don’t rec finished short works” — unused.

---

## 4. Layered product vision

Stay local-first and compatible with static Pages mode. Prefer **compose existing channels** over a black-box model.

```
┌─────────────────────────────────────────────────────────────┐
│  Local profile (IndexedDB)                                  │
│  entries · ratings · status · feedback · optional dates     │
└───────────────────────────┬─────────────────────────────────┘
                            │ derive
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  TasteProfile (computed, versioned, cacheable)              │
│  positive seeds · negatives · tag priors · format prefs     │
└───────────────────────────┬─────────────────────────────────┘
                            │ drive
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        Multi-seed RRF   Hard filters   UI surfaces
        (existing        (existing      (For You, Why,
         channels)        exclude_ids)   Taste page)
```

---

## 5. Idea backlog (ordered by leverage)

### P0 — High value, mostly reuses existing engine

#### 5.1 “For You” = multi-seed RRF over a smart seed set

**What:** A Discover mode with no single seed (or “seed = me”).

**How (build on existing pieces):**

1. Select **K positive seeds** from the library:
   - `rating >= 4` (or top quantile of user’s scores)
   - else `status === completed`
   - else `feedback === love`
   - prefer **matched** `novel_id`s; cap K (e.g. 8–15) for cost
2. Run existing `get_candidate_channels` per seed (API live path) **or** merge precomputed static rec pools for those seeds.
3. Fuse with RRF **across seeds and channels** (same math, extra outer sum).
4. Pass `exclude_novel_ids` = all matched library IDs + `not_for_me` + seed set.
5. Optional: soft-boost candidates that appear under multiple loved seeds.

**Static mode:** client-side pool merge of `recs/{bucket}/{id}.json` for the K seeds — no new backend required for v1.

#### 5.2 Push library / feedback into hard filters

**What:** Stop relying on client-only hide.

**How:**

- Extend recommend request with `exclude_novel_ids: number[]` (HardFilterEngine already supports this key; API currently hardcodes only seed).
- Client always sends: matched library + `not_for_me` (+ optional “hide reading” vs “hide completed only”).
- Discover “Hide titles already in library” becomes a real ranking constraint.

#### 5.3 Weighted taste snapshot (fix the existing panel)

**What:** Replace equal-count tags with preference-aware weights.

**How:**

- Weight title contribution by: `rating` (or 4.0 default for completed), `status` multipliers, `love` boost, `dropped` / low rating negative.
- Split by `media_kind` (novel / manga / anime) — reuse `profileStats.inferMediaKind`.
- Show **positive tropes** vs **avoid tropes** (from dropped + not_for_me + low scores).
- Use full matched set (or cap 100–250 like analytics), not 12.

This is pure client-side; no API change.

#### 5.4 Seed packs from profile

**What:** One-click seeds that feel personal without multi-seed ranking.

Examples:

- “From my 5★”
- “From completed hidden gems” (high rating, low readers via catalog)
- “Continue the vibe of what I’m reading now” (status=reading, highest progress)

Each pack still uses **single-seed or small multi-seed** RRF — UI convenience first.

---

### P1 — Real “taste profile” object

#### 5.5 Versioned `TasteProfile` derived blob

```ts
type TasteProfile = {
  version: 1;
  computed_at: string;
  dataset_version: string;
  scope: 'all' | 'novel' | 'manga' | 'anime';
  positive_seed_ids: number[];      // matched only
  negative_ids: number[];           // dropped, low rating, not_for_me
  exclude_ids: number[];            // full matched library for “already know”
  tag_weights: Record<string, number>;   // signed
  genre_weights: Record<string, number>;
  format_affinity: Record<string, number>;
  language_affinity: Record<string, number>;
  length_prior?: { mean_chapters: number; std: number };
  evidence: {
    rated: number;
    completed: number;
    unmatched: number;
    sources: string[];  // source_file names
  };
};
```

- Recompute on import / feedback / dataset change (same pattern as slug rematch).
- Store next to profile or recompute on the fly (1.4k entries is fine).
- **Do not** send raw library to a third-party cloud model by default.

#### 5.6 Tag-channel prior (soft personalization)

**What:** Bias tag similarity toward tropes you like / away from tropes you hate.

**How:** When scoring tag channel (or as a post-RRF reweight):

```
personal_boost(c) = sum_t tag_weight[t] * 1[t in candidate]
```

Clamp so one over-weighted tag cannot dominate direct_rec evidence. Prefer **reweight after RRF** for explainability (“+0.12 from your love of academy / progression”).

#### 5.7 Negative seeds

- Dropped + rating ≤ 2.5 + `not_for_me` → negative set.
- Candidates too close to negatives (shared rare tags / same author) get penalized or filtered.
- Start with hard exclude of exact IDs only; soft negative is P1.

---

### P2 — Smarter library understanding

#### 5.8 Progress & abandonment models

- High progress + still “reading” → treat as soft positive (engaged).
- Low progress + dropped → stronger negative than completed-low-score.
- Parse NU `c106 / c137` and AniList `progress_units` (already partially stored).

#### 5.9 Cross-media consumption graph

Once franchise relations exist (see multi-source doc):

- If user completed novel X and anime adaptation Y is related, demote Y unless format filter invites cross-media.
- “Adaptations of my completed novels” as a **navigation** shelf, not a similarity rec (aligns with MULTI_SOURCE invariants).

#### 5.10 Unmatched library hydration

Optional pipeline:

1. From GDPR / unmatched slugs, queue AniList IDs.
2. Ingest missing media into SQLite (live mode) / note “not in static snapshot.”
3. Re-resolve profile → match rate climbs → For You improves.

Without this, multi-source libraries stay half-blind.

#### 5.11 Curated list membership (when available)

Today curated lists are metadata-only. If we ever import list contents:

- Prefer rec_list channel edges from lists the user follows/creates.
- Weight “Peak Hidden Gems”-style lists higher for hidden-gem mode.

---

### P3 — Product surfaces

#### 5.12 Profile “For You” tab

- Shelves: Because you rated ★★★★★ · Because you completed X · Hidden gems in your taste · Cleanse (downrank your usual tropes).
- Each shelf explains **which seeds** fired (reuse evidence bullets).

#### 5.13 Taste editor

- Pin/unpin tropes (“I like progression, not harem”).
- Manual boosts that override derived weights.
- Reset to “recompute from library.”

#### 5.14 Session vs durable taste

- Temporary Discover filters (exclude harem, language) already exist — keep them.
- Durable taste = library-derived; session filters = trip-specific.

#### 5.15 Privacy copy

Be explicit: profile never leaves the browser unless the user exports JSON or enables an optional hydrate API. Any future cloud model is opt-in.

---

## 6. Ranking recipes (concrete)

### Recipe A — For You v1 (static-safe)

1. Build seed set S (|S| ≤ 12) from matched high ratings.
2. For each s ∈ S, load static rec pool (or API recommend).
3. Score candidate c:  
   `sum_{s} w(s) * rrf_from_pool(s,c)`  
   with `w(s) ∝ rating(s)` or 1.
4. Exclude library IDs + not_for_me.
5. Optional hidden-gem boost (existing).
6. Diversify lightly (MMR if vectors available; else author-cap).

### Recipe B — For You v2 (live API)

1. Single endpoint `POST /api/recommend/profile` with seed_ids + exclude_ids + channel_weights + media_type.
2. Server runs multi-seed channel gen with shared filter.
3. Returns evidence: `seed_contributions: [{seed_id, channels}]`.

### Recipe C — “More like my loves” without full multi-seed

1. User clicks a love on a rec → boost that rec’s tag/vector neighborhood in **session** channel weights.
2. Cheap; teaches feedback loop even before For You ships.

---

## 7. Data we should collect (still local)

| Field | Status | Use |
|---|---|---|
| status | ✅ | Seed / exclude priors |
| rating | ✅ (sparse) | Seed weights |
| progress / progress_units | ✅ partial | Engagement |
| media_kind | ✅ optional | Scope |
| started_on / finished_on | ✅ AniList | Recency decay |
| feedback love/read/not_for_me | ✅ underused | Strong pos/neg |
| curated list membership | ❌ | rec_list affinity |
| explicit trope pins | ❌ | Taste editor |
| “why I dropped” | ❌ | Too heavy; skip |

Avoid expanding the GDPR/HTML parsers until a recipe needs a field.

---

## 8. Success metrics (honest)

- **Coverage:** % of For You slots that are new (not in library).
- **Match dependency:** quality vs matched library size (expect cliff below ~50 matched).
- **Feedback adoption:** loves/not_for_me per session after For You launches.
- **Diversity:** unique authors / tags in top 20.
- **Trust:** % of recs with non-empty evidence bullets.

Do **not** optimize for “clicked seed” alone — that is the old single-seed product.

---

## 9. Suggested build order

| Step | Deliverable | Touches |
|---|---|---|
| 0 | Gitignore profile exports; this doc | repo hygiene |
| 1 | Weighted taste snapshot + avoid tropes | Profile UI only |
| 2 | `exclude_novel_ids` on recommend API + client sends library | API + App |
| 3 | For You v1 multi-seed merge (static + live) | App + thin API |
| 4 | TasteProfile compute module | `profile/taste.ts` |
| 5 | Tag prior reweight + evidence line | ranker / explainer |
| 6 | Negatives from dropped/low score | filters |
| 7 | Hydrate unmatched AniList IDs | scraper + import |
| 8 | Cross-media already-consumed demotion | needs relations |

---

## 10. Non-goals (for now)

- Training a global collaborative model on other users’ libraries.
- Replacing RRF with a neural ranker as the default.
- Auto-merging franchises (see multi-source doc — false merges are worse than missed recs).
- Cloud-sync of profiles without an explicit product decision.
- Requiring every library title to be catalog-matched before personalization works.

---

## 11. Open questions

1. Should **reading** (especially AniList CURRENT with progress 0) count as positive or nearly neutral?
2. Default For You scope: respect global format switcher, or always “all formats I consume”?
3. How aggressive to hide library titles — completed only vs everything including plan-to-read?
4. Is multi-seed static merge good enough for Pages, or do we accept “For You requires live API”?
5. Should loves auto-add a library entry with status completed, or stay pure feedback?

---

## 12. Bottom line

We already have the hard parts of a recommender: **channels, RRF, filters, evidence, multi-media, local library, stats, and feedback**.

What we lack is a **bridge**: derive a taste profile from the library and drive **multi-seed ranking + real exclusions** with the same machinery.

The fastest path to “it knows what I like” is not a new algorithm — it is **For You = multi-seed RRF + exclude my library + weighted taste UI**, using the profile JSON users already export.
