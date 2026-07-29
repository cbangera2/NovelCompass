import type { LiveSeriesMetadata } from '../../adapters/contracts';

export interface SeriesHeroProps {
  metadata: LiveSeriesMetadata;
}

export function SeriesHero({ metadata }: SeriesHeroProps): JSX.Element {
  const facts = [
    metadata.novelType?.label,
    metadata.language?.label,
    metadata.year ? String(metadata.year) : undefined,
  ].filter((value): value is string => Boolean(value));

  return (
    <header className="series-hero">
      <div className="series-hero-cover" aria-hidden={!metadata.coverUrl}>
        {metadata.coverUrl ? (
          <img src={metadata.coverUrl} alt={`Cover of ${metadata.title}`} />
        ) : (
          <span aria-hidden="true">{metadata.title.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="series-hero-copy">
        <p className="series-eyebrow">Novel Updates · enhanced by Novel Compass</p>
        <h1>{metadata.title}</h1>
        {facts.length ? <p className="series-facts">{facts.join(' · ')}</p> : null}
        {metadata.authors.length ? (
          <p className="series-byline">
            by{' '}
            {metadata.authors.map((author, index) => (
              <span key={`${author.label}-${index}`}>
                {index ? ', ' : ''}
                {author.url ? <a href={author.url}>{author.label}</a> : author.label}
              </span>
            ))}
          </p>
        ) : null}
        {metadata.rating?.average !== undefined ? (
          <div className="series-rating" aria-label={`Rated ${metadata.rating.average} out of 5`}>
            <strong>{metadata.rating.average.toFixed(1)}</strong>
            <span aria-hidden="true">★</span>
            {metadata.rating.voteCount !== undefined ? (
              <small>{metadata.rating.voteCount.toLocaleString()} ratings</small>
            ) : null}
          </div>
        ) : null}
        <div className="series-genre-row" aria-label="Genres">
          {metadata.genres.map((genre) => (
            <span key={genre.label}>{genre.label}</span>
          ))}
        </div>
      </div>
    </header>
  );
}
