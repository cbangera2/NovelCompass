# Novel Updates Recommender — Problem Statement

## Background

Novel Updates has a large catalog of translated web novels, but its existing discovery and recommendation experience is not good enough for finding novels that match a reader's specific taste.

The central user complaint is:

> Novel Updates has bad recommendations, and it is hard to find good novels.

Broad genres, tags, ratings, and popularity rankings do not adequately answer the question:

> If someone liked this particular novel, what other novels would they probably like?

The desired project is a better personal novel-discovery and recommendation system built from Novel Updates data and human-curated recommendation evidence.

## Primary objective

Create a system where a reader can provide one novel they liked and receive useful, explainable recommendations for what to read next.

The relationship between the selected novel and each recommendation should be more meaningful than merely sharing broad genres such as Fantasy, Action, or Romance.

The system should eventually understand relationships such as:

- similar premise
- similar protagonist personality or behavior
- similar character dynamics
- similar tropes
- similar setting or plot mechanism
- similar emotional tone
- similar romance or harem configuration
- similar reader or curator appeal
- same author, universe, or related series

For example, two novels may both have a `Yandere` tag while still being poor recommendations for each other because only one has the more specific dynamic of female yandere heroines pursuing an unwilling or intelligent male protagonist.

## Why the existing dataset is insufficient by itself

The user identified [`shaido987/novel-dataset`](https://github.com/shaido987/novel-dataset) as a potentially useful starting point.

That repository contains a Novel Updates dataset with:

- 24,639 novels
- titles and associated names
- authors and original languages
- genres and tags
- publication and translation information
- ratings, vote counts, and reading-list counts
- related-series IDs
- recommended-series IDs
- recommendation-list IDs

However, the published dataset was last updated on August 21, 2025. The user believes many novels have been added since then and does not want the system to depend on stale catalog data.

Therefore:

- the old dataset may be used as a bootstrap source or list of known IDs
- the project should rescrape Novel Updates to obtain a current catalog
- the scraper must also discover newly added novels that are absent from the old dataset

## Human-curated recommendation evidence

The user supplied the Novel Updates profile:

- [cbboss profile](https://www.novelupdates.com/user/546333/cbboss/)

This profile contains numerous curated recommendation lists with novels the user considers good. These lists provide stronger taste and relationship evidence than raw Novel Updates ratings alone.

The user specifically identified:

- [Peak Hidden Gems](https://www.novelupdates.com/viewlist/83544/)
- [Peak Tragedy, Suffering and Regret](https://www.novelupdates.com/viewlist/94083/)
- [Peak Yanderes](https://www.novelupdates.com/viewlist/83473/)
- [Peak Yandere](https://www.novelupdates.com/viewlist/115510/)

### Hidden-gem lists

The cbboss hidden-gem lists are intended to surface good novels that were relatively unpopular when added. They are useful evidence for finding quality novels that popularity rankings may bury.

These lists should not be treated as universal truth. They represent one curator's taste and may be biased toward particular languages, protagonist types, genres, and tropes.

### Topical lists

The topical lists are particularly important because they identify why their novels belong together.

Examples:

- `Peak Tragedy, Suffering and Regret` focuses on suffering, self-sacrifice, regret, misunderstandings, depression, and dark emotional experiences.
- `Peak Yanderes` focuses on female yandere characters and includes rough item-level judgments such as S-tier and A-tier.
- `Peak Yandere` focuses on female heroines, unwilling or smart male protagonists, obsessive or clingy relationships, and explicitly excludes BL and yuri. It contains detailed item comments and numeric judgments.

This demonstrates that simply recording two novels as being on the same list is not enough. The system should preserve the list's topic and item commentary as relationship evidence.

For example:

```text
Novel A → female yandere topic → Novel B
Novel A → regret and suffering topic → Novel C
```

A novel may belong to multiple topics. Those topics should remain distinct rather than being flattened into one generic similarity score.

Agreement across independent curators covering the same topic is potentially stronger evidence than repeated lists created by the same person.

## Available HAR browsing capture

The workspace contains:

- `www.novelupdates.com.har`

The user supplied this HAR as a captured browsing session and offered it for:

- understanding how Novel Updates pages and account features communicate
- reverse-engineering the site's first-party request shapes where necessary
- accessing the user's own Novel Updates account data or recommendation lists

Inspection found that Novel Updates uses authenticated WordPress AJAX requests, including `wp-admin/admin-ajax.php`, and often returns HTML fragments rather than a clean public JSON API.

The HAR may contain reusable cookies, tokens, or other session credentials. It must:

- remain local
- never be committed to Git
- never have credentials printed into logs or documentation
- only be used for the user's own account and data

The project must not bypass CAPTCHA, authentication, rate limits, or other access controls. An offline HAR importer is acceptable. Optional live account synchronization may later use the user's legitimate signed-in browser session if necessary.

## Core data problem

The project needs a fresh, auditable representation of Novel Updates containing:

### Novel information

- stable Novel Updates ID
- canonical URL and title
- associated names
- author
- language and novel type
- full synopsis
- genres
- tags
- chapter and completion information
- translation activity
- rating and rating-vote count
- reading-list count
- cover and publisher information

### Relationship information

- direct Novel Updates recommendations
- related, sequel, alternate, or shared-universe series
- recommendation lists containing each novel
- other novels on those lists
- list title, description, tags, curator, and follower count
- list ordering or tiers
- per-item curator comments
- same-author relationships

The scraper must discover novels from more than one page type. It should use the old dataset, listing/ranking pages, latest-series pages, recommendation lists, direct recommendations, and related-series links as discovery sources.

The scraping process must be restartable and clearly distinguish complete, partial, failed, and aborted runs. A partial crawl must never silently be presented as a complete current dataset.

## Core recommendation problem

The difficult part of the project is not building a catalog UI. It is learning good novel-to-novel relationships.

A useful system will probably need several independent signals:

### Semantic evidence

Compare synopses to identify similar premises, conflicts, settings, and protagonist situations that genres and tags do not express.

### Trope and tag evidence

Use tags with different importance levels. Specific tags such as `Cunning Protagonist`, `Time Loop`, `Obsessive Love`, or `Misunderstandings` should usually matter more than broad genres such as Fantasy.

Contradictory or unwanted attributes should be represented explicitly. Examples include harem versus no-harem preferences, romantic versus no-romantic-subplot preferences, and protagonist or relationship configurations.

### Direct recommendation evidence

Novel Updates' direct user-created recommendation links are human signals. Mutual links may be stronger than one-way links, although lack of reciprocity is not necessarily negative because coverage is incomplete.

### Topical-list evidence

Recommendation lists should provide labeled topics, not only pairwise co-occurrence.

The system should distinguish:

- how topically focused a list is
- how reliable or informative its curator appears
- how strongly each individual item belongs to the topic
- whether independent curators agree

List popularity should not automatically make a vague list more valuable than a smaller, highly specific list.

### Personal behavior

The system should eventually incorporate:

- loved novels
- liked novels
- disliked novels
- dropped novels
- already-read novels
- saved recommendations
- requests for more novels like a particular result
- the user's own Novel Updates reading lists, if imported

The initial public lists mostly provide positive examples. They do not provide reliable negative preferences, so explicit personal feedback will be important.

## Expected user experience

The most important initial interaction is:

1. Search for a novel.
2. Mark it as liked or loved.
3. Request similar novels.
4. Receive ranked recommendations.
5. See why each novel was selected.
6. Mark results as good, bad, already read, dropped, or not interested.
7. Refine the request with desired or excluded traits.

Useful refinements may include:

- more like this result
- use all of my favorite novels
- more like novel A than novel B
- require a particular trope
- exclude harem
- require or exclude romance
- darker or lighter tone
- smarter protagonist
- prioritize hidden gems
- require active or completed translation

Every recommendation should retain evidence supporting the relationship. Explanations must be based on collected data rather than invented after the fact.

## Quality and popularity

Raw ratings should not be trusted without considering vote counts. A 4.8 rating from five votes is not necessarily stronger than a 4.4 rating from hundreds of votes.

Popularity is also not the same as quality. One explicit goal is to find good novels that are not already the most popular titles.

The system should therefore treat the following as separate concepts:

- relationship or taste match
- rating confidence
- translation viability
- popularity
- hidden-gem novelty

Users should be able to favor hidden gems without forcing the system to return low-quality or weakly related novels.

## Evaluation requirement

The system must be compared against simpler alternatives:

- synopsis similarity alone
- genres/tags alone
- direct recommendation links alone
- popularity or rating ranking
- the combined relationship model

Possible evaluation evidence includes:

- hiding items from a focused topical list and testing whether they are recovered
- using older curated lists to predict items appearing in newer lists
- hiding known direct recommendation edges
- manually judging results for a set of favorite seed novels
- blind comparison of two ranked result sets

Evaluation must avoid leakage. If a list is used as the test answer, that same list's co-occurrence edges and comments cannot remain available to the model during the test.

Useful metrics include:

- Recall@K
- NDCG@K
- mean reciprocal rank
- catalog coverage
- diversity
- popularity distribution
- percentage of recommendations supported by multiple evidence types
- personal save and rejection rates

The most important ultimate measure is whether the user actually finds novels they want to read.

## Scope and implementation priorities

This is a personal/local project. It does not need commercialization, cloud scale, or a production SaaS architecture.

The first implementation should validate relationship quality before investing heavily in a polished interface.

A sensible proof of concept is:

1. Scrape 500–1,000 representative novels.
2. Include novels from the supplied hidden-gem and topical lists.
3. Expand through their direct recommendations and related graph neighbors.
4. Collect synopses, tags, direct recommendations, list membership, and item comments.
5. Build a command that accepts one novel and prints approximately 20 related novels.
6. Display the evidence and component scores for every result.
7. Manually evaluate results across approximately 20 seed novels.
8. Improve the relationship logic.
9. Only then run a complete catalog crawl and build the full interface.

## Security and access constraints

- Treat the HAR as sensitive.
- Keep cookies, tokens, raw authenticated responses, databases, and secrets out of Git.
- Do not print session credentials.
- Do not access other users' private account data.
- Do not bypass authentication, CAPTCHA, blocking, or rate limits.
- Use low request concurrency, caching, delays, retries, and backoff.
- Stop and report when site behavior indicates blocking or a schema change.
- Preserve raw public HTML locally so parsers can be tested without repeatedly requesting the site.

## Known project files

- `problemstatement.md` — this handoff document
- `PRODUCT_PLAN.md` — the current proposed technical/product plan
- `.gitignore` — excludes HAR files, local databases, raw data, caches, and environment secrets
- `www.novelupdates.com.har` — sensitive local browsing capture

## Decisions that remain open

The next planning agent should evaluate, rather than assume:

- the best method for discovering every current Novel Updates novel
- whether crawling all public recommendation lists is practical
- how frequently different pages should be refreshed
- whether Novel Updates exposes recommendation vote strength
- how to normalize free-form list themes and item comments
- which local embedding model works best for web-novel synopses
- how to distinguish premise similarity from reading-experience similarity
- how much curator identity and follower count should influence confidence
- how to avoid overfitting to cbboss or yandere-focused examples
- how to combine several liked novels without averaging away niche preferences
- whether offline HAR import is sufficient or live account synchronization is worth building
- licensing and redistribution limits for the old dataset and newly scraped data

## Definition of success

The project is successful when:

1. A reader can choose one novel they liked.
2. The system finds several novels the reader genuinely wants to try.
3. The results include newer and less-popular novels, not only obvious bestsellers.
4. Each recommendation has a clear, evidence-backed explanation.
5. Feedback improves subsequent recommendations.
6. The catalog refresh process is current, restartable, and honest about missing data.
