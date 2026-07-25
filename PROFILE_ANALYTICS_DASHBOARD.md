# Profile Analytics: Validated Scope and Roadmap

## Decision

Build analytics only from normalized local profile fields and catalog metadata
that the active API or static snapshot can return. Do not present a saved
profile page as an activity history.

Recharts is not justified for the current scope. Two modest charts can be
rendered with semantic HTML, CSS, and a small accessible SVG without adding a
charting dependency to every visitor's bundle. Reconsider a lazy-loaded chart
library only after several complex charts are supported by real data.

## Feasibility matrix

| Proposed chart | Current evidence | Decision | Correct definition and limitation |
|---|---|---|---|
| Reading DNA radar | Profile status/rating plus novel genres/tags | Defer | No candidate weights, calibrated affinities, or negative preferences exist. Current recurring tags are descriptive counts from a disclosed sample, not a DNA score. |
| 18-year trope history | No read/import timestamps per title | Reject | Publication year is not the year the user read a novel. An imported snapshot cannot reconstruct personal history. |
| Hidden-gem scatter | Catalog rating, votes, and reading-list count from matched details | Implement | Plot published rating against current NU reading-list count for a bounded matched sample. “Potential hidden gem” is a visible rule, not a quality guarantee or Bayesian score. |
| Origin/language donut | Detail `language` on matched novels | Implement as bars | Language is available for matched details, but it is not nationality, author origin, or publication market. Unknown values remain visible. |
| Curator consensus bars | Some database list membership; imported profile has summaries only | Defer | Profile HTML does not include list contents. “Independent top curator” is not modeled, and private memberships must not be inferred. |
| Velocity/completion chart | Optional progress strings and current status only | Reject | No timestamps, sessions, chapter events, or reliable chapter totals exist. Completion rate would confuse list status with measured reading behavior. |

## Additional defensible summaries

- Status counts use every normalized imported entry.
- Personal rating distribution uses only entries with an explicit imported
  rating; missing ratings are not treated as zero.
- Recurring genres/tags use successfully loaded detail records and always show
  sample coverage.
- Language distribution and scatter points use the same detail sample so their
  denominators are consistent.

## Data and export constraints

- Static mode needs one detail artifact per sampled novel. Analytics therefore
  uses at most 40 matched entries and reports failures instead of downloading
  hundreds of files.
- API mode uses the same `RecommendationDataSource.getNovel` contract. It must
  not require a separate profile upload endpoint.
- The sample is deterministic: the first 40 matched entries in normalized
  profile order. This may not represent the whole library and is labeled as a
  sample.
- Ratings and reader counts are snapshot metadata and may be stale.
- The current exporter may omit some detail files. Those records count as
  failures, never as zero-valued data.
- No raw profile HTML is stored or sent for analytics.

## Accessibility requirements

- Every visualization has a text summary or table.
- Scatter points are keyboard focusable and open the same in-app novel detail
  view as library cards.
- Color is supplementary: hidden-gem points also have an explicit text label.
- Loading, empty, partial-coverage, and error states are written in plain text.
- Charts use theme variables and remain readable in light and dark modes.

## Implemented section

The Profile page provides:

1. full-profile status and personal-rating distributions;
2. matched-sample language distribution;
3. rating-versus-readers scatter with a transparent “potential hidden gem”
   rule of rating at least 4.2 and fewer than 2,000 readers;
4. a keyboard-accessible table of plotted novels;
5. sample size, failures, dataset version, and freshness caveats.

## Roadmap

1. Add a batched detail endpoint and compact static analytics artifact before
   increasing sample size.
2. Add explicit reading events if the user chooses to track activity locally.
3. Add preference weights only after explicit Love/Not-for-me signals have
   enough support and their formula is inspectable.
4. Add curator consensus only after sourced list memberships and curator
   identity/provenance are validated.
5. Re-evaluate lazy-loaded Recharts when the data supports timelines,
   comparisons, or multiple series that native primitives cannot express
   clearly.
