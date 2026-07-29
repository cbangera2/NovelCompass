import type { MouseEvent } from 'react';

import type { LiveReleasePage, LiveReviewPage, LiveSeriesMetadata } from '../adapters/contracts';
import { ChapterList } from './components/ChapterList';
import { ReviewList } from './components/ReviewList';
import { SeriesHero } from './components/SeriesHero';
import { SeriesOverview } from './components/SeriesOverview';
import { SimilarNovels, type SimilarNovel } from './components/SimilarNovels';
import './extension-series.css';

export type SeriesSectionState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'unavailable'; message?: string };

export interface ExtensionSeriesAppProps {
  metadata: LiveSeriesMetadata;
  releases: LiveReleasePage;
  reviews?: SeriesSectionState<LiveReviewPage>;
  similar?: SeriesSectionState<SimilarNovel[]>;
  onInvokeAction: (actionId: string) => void;
  onNavigate: (url: string) => void;
}

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'similar', label: 'Similar' },
] as const;

const DEFAULT_REVIEWS: SeriesSectionState<LiveReviewPage> = {
  status: 'unavailable',
  message: 'Reviews are not available for this page yet.',
};

const DEFAULT_SIMILAR: SeriesSectionState<SimilarNovel[]> = {
  status: 'loading',
};

export function ExtensionSeriesApp({
  metadata,
  releases,
  reviews = DEFAULT_REVIEWS,
  similar = DEFAULT_SIMILAR,
  onInvokeAction,
  onNavigate,
}: ExtensionSeriesAppProps): JSX.Element {
  return (
    <div className="novel-compass-series">
      <a className="series-skip-link" href="#series-content">
        Skip to series content
      </a>
      <SeriesHero metadata={metadata} />

      <nav className="series-section-nav" aria-label="Jump to series section">
        {SECTIONS.map((section) => (
          <a
            href={`#series-${section.id}`}
            id={`series-nav-${section.id}`}
            key={section.id}
            onClick={(event) => scrollToSection(event, section.id)}
          >
            {section.label}
            {section.id === 'chapters' && releases.rows.length > 0 ? (
              <span aria-label={`${releases.rows.length} chapters on this page`}>
                {releases.rows.length}
              </span>
            ) : null}
          </a>
        ))}
      </nav>

      <main className="series-content" id="series-content">
        <section
          aria-labelledby="series-nav-overview"
          className="series-page-section"
          id="series-overview"
        >
          <SeriesOverview metadata={metadata} />
        </section>
        <section
          aria-labelledby="series-nav-chapters"
          className="series-page-section"
          id="series-chapters"
        >
          <ChapterList page={releases} onInvokeAction={onInvokeAction} onNavigate={onNavigate} />
        </section>
        <section
          aria-labelledby="series-nav-reviews"
          className="series-page-section"
          id="series-reviews"
        >
          <ReviewList state={reviews} onInvokeAction={onInvokeAction} />
        </section>
        <section
          aria-labelledby="series-nav-similar"
          className="series-page-section"
          id="series-similar"
        >
          <SimilarNovels state={similar} onNavigate={onNavigate} />
        </section>
      </main>
    </div>
  );
}

function scrollToSection(event: MouseEvent<HTMLAnchorElement>, sectionId: string): void {
  const root = event.currentTarget.getRootNode() as ParentNode;
  const section = root.querySelector<HTMLElement>(`#series-${sectionId}`);
  if (!section) return;

  event.preventDefault();
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.history.replaceState(window.history.state, '', `#series-${sectionId}`);
}
