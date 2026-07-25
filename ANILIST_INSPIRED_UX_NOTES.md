# AniList-inspired UX notes

This is a pattern study, not a request to copy AniList's branding, proportions,
or page composition. The useful lesson is how a large catalog separates
fast visual scanning from progressively disclosed detail.

Sources checked July 25, 2026:

- [AniList popular search](https://anilist.co/search/anime/popular) exposes the
  browse/search shell, although its content requires a modern JavaScript client.
- [AniList API media reference](https://anilist.gitbook.io/anilist-apiv2-docs/docs/reference/object/media)
  confirms which interface sections are backed by real AniList fields rather
  than being merely decorative.
- Public search/detail screenshots show a compact filter row over a cover-led
  grid, then a detail page with a strong media hero, concise facts, and grouped
  relations/recommendations. Screenshots were used only to identify information
  hierarchy, not to reproduce visual styling.

## Patterns worth adapting

### Browse and search

1. **Search first, refinement second.** Keep title search, sort, and one discovery
   action visible. Put the long-tail metadata filters behind a clearly labeled
   control, while displaying active filters as removable chips.
2. **Cover-led scanability.** Covers, titles, and one or two trustworthy signals
   should dominate each result. Secondary metadata should not make every card
   the height of a detail page.
3. **Stable result context.** Keep the result count, sort, active filters, loading
   state, and end-of-results status close to the grid. Incremental loading must
   preserve already loaded cards and provide a retry local to the failed batch.
4. **Preview versus destination.** A quick-look surface is useful for synopsis and
   a decision, but the title/cover should have an obvious route to the durable
   novel page. The preview should not duplicate every insight or relationship.
5. **Metadata as navigation.** Genre, tag, language, and author labels can link
   back into filtered Browse results. Link styling must remain distinguishable
   and keyboard accessible.

Our Browse page already has the right foundation: debounced search, sort,
advanced filters, active chips, random discovery, cover cards, incremental
loading with retry, and a quick-look modal. The implementation work should
mainly tighten hierarchy and ensure the durable novel-page action is primary.

### Novel detail

1. **A decisive hero.** Cover, preferred title, author, status, language/year,
   rating confidence, reader count, and chapter progress form the first decision
   block. Primary and external actions should remain visible without competing
   with every metadata field.
2. **Progressive sections.** Overview, catalog insights, and relationship
   evidence are easier to understand as named sections with a compact sticky or
   anchored section navigator.
3. **Connections are visual objects.** Related works and recommendations work
   best as cover-led cards with a relationship label. For this product, the
   relationship label should explain recommendation evidence or relation type,
   never imply an AniList-style franchise relation when none exists.
4. **Personal state is contextual.** Local “Love,” “Read,” and “Not for me”
   controls belong near the title/actions, but must continue saying they are
   private browser-local feedback—not a Novel Updates account mutation.
5. **Dense facts stay secondary.** Alternative titles, long tag sets, and detailed
   signal ranks should be collapsible or placed below the synopsis rather than
   overwhelming the hero.

Our Novel page already implements most of this: cover hero, high-value stats,
local feedback, anchored section navigation, collapsible facets, insights,
relationship evidence, and related-novel cards. The main QA focus is responsive
hierarchy and honest empty states.

## Features we must not imply

AniList has fields and services that this dataset does not. Do not create empty
or fabricated versions of these merely to resemble its detail pages:

- live trending, seasonal, airing, or release countdown data;
- authenticated favorites, public lists, follows, notifications, or account
  synchronization;
- characters, voice actors, staff, studios, producers, trailers, or streaming
  links;
- social activity, forums, reviews, review scores, or public recommendations
  attributed to users;
- typed adaptation/prequel/sequel graphs unless Novel Updates provides a stored
  relation type for that exact edge;
- official popularity/rating ranks, favorites counts, format labels, banner art,
  licensing, volumes, or completion dates not present in our database.

Supported fields include catalog/alternate titles, cover, author, language,
year, translation status and chapter counts, rating plus vote count, reading-list
count, synopsis, genres, tags, direct/related edges, curated-list co-occurrence,
recommendation evidence, and private local feedback. Missing values need an
honest omission or explicit unavailable state.

## Browse implementation acceptance checklist

- [ ] Search, sort, and the primary discovery action remain usable without
      opening advanced filters.
- [ ] Active filters are visible, individually removable, and have a clear-all
      action.
- [ ] Filter changes reset pagination without duplicating or mixing result sets.
- [ ] Cards prioritize cover, title, author, rating confidence, and readers;
      secondary facets do not dominate card height.
- [ ] Title or cover opens the durable novel page; “Quick look” is clearly a
      preview and has a visible route to the full page.
- [ ] Genre, tag, language, and author links produce deterministic Browse URLs
      and restore the selected filter on reload.
- [ ] Initial loading, incremental loading, empty results, batch failure/retry,
      and end-of-results are visually distinct and announced accessibly.
- [ ] Keyboard focus is trapped/restored for quick look; Escape and backdrop
      close it without losing the current result set.
- [ ] Mobile retains search and filter access without a horizontally scrolling
      control bar or clipped cards.
- [ ] Static and API modes expose only filters they can actually apply.

## Novel-page implementation acceptance checklist

- [ ] Hero establishes title, cover, author, status, language/year, rating with
      vote confidence, readers, and chapters without inventing missing facts.
- [ ] “Find similar” is the primary product action; Novel Updates remains a
      clearly external secondary action.
- [ ] Local feedback states are keyboard accessible, persist correctly, and are
      labeled as browser-local rather than account synchronization.
- [ ] Overview, Insights, and Relationships have stable anchors; the section
      navigator identifies the active location and respects reduced motion.
- [ ] Long synopsis, alternate-name, genre, and tag content remains readable and
      progressively disclosed on small screens.
- [ ] Relationship evidence names the origin novel, shows honest evidence/ranks,
      and distinguishes recommendation evidence from typed series relations.
- [ ] Related cards use real covers/metadata, provide durable navigation, and
      preserve the `from` context where relationship explanation is available.
- [ ] Missing synopsis, cover, insights, origin, relationship, or recommendations
      each have an honest local empty state—not a blank section.
- [ ] Desktop and mobile layouts avoid horizontal overflow and keep the primary
      actions reachable near the hero.
- [ ] No characters, staff, social reviews, trending, banners, or account state
      appear unless a future dataset contract explicitly supplies them.
