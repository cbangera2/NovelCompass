import { useState } from 'react';

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

type SeriesTab = 'overview' | 'chapters' | 'reviews' | 'similar';

const TABS: Array<{ id: SeriesTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'chapters', label: 'Chapters' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'similar', label: 'Similar' },
];

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
  const [activeTab, setActiveTab] = useState<SeriesTab>('overview');

  return (
    <div className="novel-compass-series">
      <a className="series-skip-link" href="#series-content">
        Skip to series content
      </a>
      <SeriesHero metadata={metadata} />

      <nav className="series-tabs" aria-label="Series sections" role="tablist">
        {TABS.map((tab) => (
          <button
            aria-controls={`series-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'is-active' : undefined}
            id={`series-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
            {tab.id === 'chapters' && releases.rows.length > 0 ? (
              <span aria-label={`${releases.rows.length} chapters on this page`}>
                {releases.rows.length}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      <main className="series-content" id="series-content">
        <section
          aria-labelledby="series-tab-overview"
          hidden={activeTab !== 'overview'}
          id="series-panel-overview"
          role="tabpanel"
        >
          <SeriesOverview metadata={metadata} />
        </section>
        <section
          aria-labelledby="series-tab-chapters"
          hidden={activeTab !== 'chapters'}
          id="series-panel-chapters"
          role="tabpanel"
        >
          <ChapterList page={releases} onInvokeAction={onInvokeAction} onNavigate={onNavigate} />
        </section>
        <section
          aria-labelledby="series-tab-reviews"
          hidden={activeTab !== 'reviews'}
          id="series-panel-reviews"
          role="tabpanel"
        >
          <ReviewList state={reviews} onInvokeAction={onInvokeAction} />
        </section>
        <section
          aria-labelledby="series-tab-similar"
          hidden={activeTab !== 'similar'}
          id="series-panel-similar"
          role="tabpanel"
        >
          <SimilarNovels state={similar} onNavigate={onNavigate} />
        </section>
      </main>
    </div>
  );
}
