import { useEffect, useState } from 'react';
import BrowsePage from '../../../web/src/BrowsePage';
import {
  createExtensionStaticDataSource,
  type RecommendationDataSource,
} from '../../../web/src/data';
import { extensionFinderNovelUrl } from './finder-links';
import './extension-finder.css';

export interface ExtensionFinderAppProps {
  datasetBaseUrl: string;
  fetch?: typeof fetch;
  onShowOriginal: () => void;
}

export function ExtensionFinderApp({
  datasetBaseUrl,
  fetch: fetcher,
  onShowOriginal,
}: ExtensionFinderAppProps): JSX.Element {
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError('');
    createExtensionStaticDataSource({ baseUrl: datasetBaseUrl, fetch: fetcher })
      .then((next) => !cancelled && setSource(next))
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : 'The catalog is unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, [datasetBaseUrl, fetcher]);

  return (
    <div className="novel-compass-finder">
      <header className="extension-finder-toolbar">
        <div>
          <strong>Novel Compass Search</strong>
          <span>Enhanced catalog search for Novel Updates</span>
        </div>
        <button type="button" onClick={onShowOriginal}>
          Use original Series Finder
        </button>
      </header>

      <aside className="extension-finder-boundary">
        Novel Compass searches its versioned catalog snapshot. Use the original finder for
        translation groups, publishers, release frequency, review counts, release dates, or
        reading-list membership.
      </aside>

      {error ? (
        <section className="extension-finder-error" role="alert">
          <h1>Novel Compass search is unavailable</h1>
          <p>{error}</p>
          <button type="button" onClick={onShowOriginal}>
            Continue with the original finder
          </button>
        </section>
      ) : source ? (
        <BrowsePage
          source={source}
          syncHistory={false}
          persistPreferences={false}
          showMediaTypes={false}
          fixedMediaType="novel"
          nativeControls
          novelUrl={extensionFinderNovelUrl}
          similarUrl={() => null}
          eyebrow="Novel Updates catalog"
          heading="Find your next novel."
          description="Search and filter Novel Compass results, then open any title on its redesigned Novel Updates series page."
        />
      ) : (
        <div className="extension-finder-loading" role="status" aria-live="polite">
          Loading the Novel Compass catalog…
        </div>
      )}
    </div>
  );
}
