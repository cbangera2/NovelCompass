import { lazy, Suspense, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { RecommendationDataSource } from '../data';
import type { DatasetManifest, NovelDetail } from '../types';
import { Card } from '../design-system';
import { browseFacetUrl } from '../metadataLinks';
import { novelPageUrl } from '../novelLinks';
import { displayNovelTitle, useDisplaySettings } from '../settings';
import { computeTasteProfile, TasteProfile } from './taste';
import type { LocalUserProfile } from './types';
import { navigateTo } from '../viewTransitions';
const ProfileAnalytics = lazy(() => import('./ProfileAnalytics'));

function appUrl(params = ''): string {
  return `${import.meta.env.BASE_URL}${params}`;
}

export function ProfileTaste({
  profile,
  source,
  dataset,
}: {
  profile: LocalUserProfile;
  source: RecommendationDataSource | null;
  dataset: DatasetManifest | null;
}): JSX.Element {
  const { settings } = useDisplaySettings();
  const [taste, setTaste] = useState<TasteProfile | null>(null);
  const [tasteDetails, setTasteDetails] = useState<NovelDetail[]>([]);
  const [tasteLoading, setTasteLoading] = useState(false);
  const [tasteLoadFailed, setTasteLoadFailed] = useState(0);

  useEffect(() => {
    // Seeds/excludes work without catalog details; facets need detail fetches.
    const draft = computeTasteProfile(profile, [], {
      datasetVersion: dataset?.dataset_version || profile.dataset_version,
    });
    setTaste(draft);
    if (!source || (draft.positive_seeds.length === 0 && draft.negative_ids.length === 0)) {
      setTasteDetails([]);
      setTasteLoadFailed(0);
      setTasteLoading(false);
      return;
    }
    const ids = [
      ...draft.positive_seeds.map((s) => s.novel_id),
      ...draft.negative_ids,
    ].filter((id, index, all) => all.indexOf(id) === index).slice(0, 80);
    let cancelled = false;
    setTasteLoading(true);
    Promise.allSettled(ids.map((id) => source.getNovel(id))).then((results) => {
      if (cancelled) return;
      const details = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      setTasteDetails(details);
      setTasteLoadFailed(results.length - details.length);
      setTaste(computeTasteProfile(profile, details, {
        datasetVersion: dataset?.dataset_version || profile.dataset_version,
      }));
      setTasteLoading(false);
    });
    return () => { cancelled = true; };
  }, [profile, source, dataset?.dataset_version]);

  return (
    <>
      {(profile.feedback?.length || 0) > 0 && (
        <Card className="profile-feedback-summary">
          <div><span className="eyebrow">Explicit local signals</span><h2>Recommendation feedback</h2></div>
          <p>Love is a favorite signal, Read is a local read marker, and Not for me hides that title from recommendation results. None of these edits your Novel Updates account.</p>
          <div>{profile.feedback!.map((item) => (
            <span key={item.novel_id} className={`feedback-${item.signal}`}>
              {item.title}<strong>{item.signal === 'not_for_me' ? 'Not for me' : item.signal === 'love' ? 'Loved' : 'Read'}</strong>
            </span>
          ))}</div>
        </Card>
      )}

      <Card className="taste-snapshot" aria-labelledby="taste-title">
        <div className="profile-library-heading">
          <div><span className="eyebrow">Weighted from your library</span><h2 id="taste-title">Taste profile</h2></div>
          <span>{dataset?.dataset_version || profile.dataset_version}</span>
        </div>
        {tasteLoading && <p className="profile-list-note">Loading catalog metadata for seeds and negatives…</p>}
        {taste && (
          <>
            <p className="profile-list-note">
              {taste.positive_seeds.length} positive seeds · {taste.negative_ids.length} negatives ·{' '}
              {taste.exclude_ids.length} matched IDs excluded from ranking ·{' '}
              {taste.evidence.matched}/{taste.evidence.total_entries} library titles matched to catalog.
              {tasteLoadFailed ? ` ${tasteLoadFailed} detail shard${tasteLoadFailed === 1 ? '' : 's'} failed to load.` : ''}
              {' '}Facet weights use rating/status/feedback — not equal title counts.
            </p>
            {taste.evidence.caveats.length > 0 && (
              <ul className="taste-caveats">
                {taste.evidence.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
              </ul>
            )}
            <div className="taste-actions">
              <a className="taste-for-you" href={appUrl('?view=discover&for_you=1')}>
                <Sparkles size={15} /> For You recommendations
              </a>
              <small>Multi-seed RRF over your positive seeds; works in live API and static Pages mode.</small>
            </div>
            <div className="taste-columns taste-columns-4">
              <div>
                <h3>Liked genres</h3>
                <div className="taste-chips">
                  {taste.liked_genres.map((facet) => (
                    <a key={facet.name} href={browseFacetUrl('genre', facet.name)}>
                      {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                    </a>
                  ))}
                  {!taste.liked_genres.length && <small>Need matched seed details for genres.</small>}
                </div>
              </div>
              <div>
                <h3>Liked tags</h3>
                <div className="taste-chips">
                  {taste.liked_tags.map((facet) => (
                    <a key={facet.name} href={browseFacetUrl('tag', facet.name)}>
                      {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                    </a>
                  ))}
                  {!taste.liked_tags.length && <small>Need matched seed details for tags.</small>}
                </div>
              </div>
              <div>
                <h3>Avoid genres</h3>
                <div className="taste-chips taste-chips-avoid">
                  {taste.avoid_genres.map((facet) => (
                    <a key={facet.name} href={browseFacetUrl('genre', facet.name)}>
                      {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                    </a>
                  ))}
                  {!taste.avoid_genres.length && <small>No dropped / low-rated / not-for-me signal yet.</small>}
                </div>
              </div>
              <div>
                <h3>Avoid tags</h3>
                <div className="taste-chips taste-chips-avoid">
                  {taste.avoid_tags.map((facet) => (
                    <a key={facet.name} href={browseFacetUrl('tag', facet.name)}>
                      {facet.name}<strong>{facet.weight.toFixed(1)}</strong><small>×{facet.count}</small>
                    </a>
                  ))}
                  {!taste.avoid_tags.length && <small>No negative tag signal yet.</small>}
                </div>
              </div>
            </div>
            <details className="taste-sample" open={taste.positive_seeds.length > 0 && taste.positive_seeds.length <= 8}>
              <summary>Positive seeds ({taste.positive_seeds.length}) — used for For You</summary>
              <ul>
                {taste.positive_seeds.map((seed) => (
                  <li key={seed.novel_id}>
                    <a href={novelPageUrl(seed.novel_id)}>{seed.title}</a>
                    {' '}· weight {seed.weight.toFixed(2)} · {seed.reason}
                  </li>
                ))}
                {!taste.positive_seeds.length && <li>None yet — rate matched titles 4★+ or mark Completed.</li>}
              </ul>
            </details>
            {tasteDetails.length > 0 && (
              <details className="taste-sample">
                <summary>Catalog titles loaded for facets ({tasteDetails.length})</summary>
                <ul>
                  {tasteDetails.map((detail) => (
                    <li key={detail.id}>
                      {displayNovelTitle(detail.title, detail.associated_names, settings.titlePreference)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </Card>

      <Suspense fallback={<section className="profile-analytics"><p className="analytics-state">Loading analytics module…</p></section>}>
        <ProfileAnalytics
          profile={profile}
          source={source}
          datasetVersion={dataset?.dataset_version || profile.dataset_version}
          onOpenNovel={(novelId) => { navigateTo(novelPageUrl(novelId)); }}
        />
      </Suspense>
    </>
  );
}
