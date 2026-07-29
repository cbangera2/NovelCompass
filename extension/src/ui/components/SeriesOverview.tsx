import type { LinkedLabel, LiveRankSet, LiveSeriesMetadata } from '../../adapters/contracts';

export interface SeriesOverviewProps {
  metadata: LiveSeriesMetadata;
}

export function SeriesOverview({ metadata }: SeriesOverviewProps): JSX.Element {
  return (
    <div className="series-overview">
      <div className="series-overview-main">
        <section className="series-card">
          <h2>About this series</h2>
          {metadata.description ? (
            <p className="series-description">{metadata.description}</p>
          ) : (
            <p className="series-empty-copy">No description is available.</p>
          )}
        </section>

        {metadata.associatedNames.length ? (
          <section className="series-card">
            <h2>Associated names</h2>
            <ul className="series-plain-list">
              {metadata.associatedNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {metadata.tags.length ? (
          <section className="series-card">
            <h2>Tags</h2>
            <div className="series-tag-cloud">
              {metadata.tags.map((tag) => (
                <span key={tag.label}>{tag.label}</span>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <aside className="series-overview-side" aria-label="Series details">
        <section className="series-card">
          <h2>Details</h2>
          <dl className="series-detail-list">
            <Detail label="Status" value={metadata.originalStatus} />
            <Detail label="Translation" value={metadata.translationStatus} />
            <Detail label="Release frequency" value={metadata.releaseFrequency} />
            <Detail
              label="Licensed"
              value={metadata.licensed === undefined ? undefined : metadata.licensed ? 'Yes' : 'No'}
            />
            <LinkedDetail label="Artists" values={metadata.artists} />
            <LinkedDetail label="Original publisher" values={metadata.publishers.original} />
            <LinkedDetail label="English publisher" values={metadata.publishers.english} />
          </dl>
        </section>

        {metadata.rankings ? (
          <section className="series-card">
            <h2>Novel Updates activity</h2>
            {metadata.rankings.readingListCount !== undefined ? (
              <p className="series-list-count">
                <strong>{metadata.rankings.readingListCount.toLocaleString()}</strong>
                <span>reading lists</span>
              </p>
            ) : null}
            <RankRows label="Activity rank" ranks={metadata.rankings.activity} />
            <RankRows label="Reading-list rank" ranks={metadata.rankings.readingList} />
          </section>
        ) : null}

        {metadata.recommendationLists.length ? (
          <section className="series-card">
            <h2>Featured in lists</h2>
            <LinkedList values={metadata.recommendationLists} />
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}): JSX.Element | null {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LinkedDetail({
  label,
  values,
}: {
  label: string;
  values: LinkedLabel[];
}): JSX.Element | null {
  if (!values.length) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {values.map((value, index) => (
          <span key={`${value.label}-${index}`}>
            {index ? ', ' : ''}
            {value.url ? <a href={value.url}>{value.label}</a> : value.label}
          </span>
        ))}
      </dd>
    </div>
  );
}

function LinkedList({ values }: { values: LinkedLabel[] }): JSX.Element {
  return (
    <ul className="series-linked-list">
      {values.map((value, index) => (
        <li key={`${value.label}-${index}`}>
          {value.url ? <a href={value.url}>{value.label}</a> : value.label}
        </li>
      ))}
    </ul>
  );
}

function RankRows({
  label,
  ranks,
}: {
  label: string;
  ranks: LiveRankSet | undefined;
}): JSX.Element | null {
  if (!ranks) return null;
  const rows = [
    ['Weekly', ranks.weekly],
    ['Monthly', ranks.monthly],
    ['All time', ranks.allTime],
  ] as const;
  return (
    <div className="series-ranks">
      <h3>{label}</h3>
      <dl>
        {rows.flatMap(([name, rank]) =>
          rank === undefined ? (
            []
          ) : (
            <div key={name}>
              <dt>{name}</dt>
              <dd>#{rank.toLocaleString()}</dd>
            </div>
          ),
        )}
      </dl>
    </div>
  );
}
