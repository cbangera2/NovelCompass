import { lazy, Suspense, useEffect, useState } from 'react';
import { BarChart3, Sparkles } from 'lucide-react';
import type { RecommendationDataSource } from '../data';
import type { DatasetManifest, NovelDetail } from '../types';
import { Card, DSButton } from '../design-system';
import { browseFacetUrl } from '../metadataLinks';
import { novelPageUrl } from '../novelLinks';
import { displayNovelTitle, useDisplaySettings } from '../settings';
import { computeTasteProfile, TasteProfile } from './taste';
import type { LocalUserProfile } from './types';
const ProfileAnalytics = lazy(() => import('./ProfileAnalytics'));

function appUrl(params = ''): string {
  return `${import.meta.env.BASE_URL}${params}`;
}

type Facet = TasteProfile['liked_genres'][number];

/** One labelled row of facet links; `kind` picks the Browse filter they open. */
function FacetRow({ label, kind, facets, empty, avoid, limit = 8 }: {
  label: string;
  kind: 'genre' | 'tag';
  facets: Facet[];
  empty: string;
  avoid?: boolean;
  /** Keeps the summary on one screen by showing only the strongest facets. */
  limit?: number;
}): JSX.Element {
  return (
    <div className="taste-facet-row">
      <h4>{label}</h4>
      <div className={`taste-chips ${avoid ? 'taste-chips-avoid' : ''}`}>
        {facets.slice(0, limit).map((facet) => (
          <a key={facet.name} href={browseFacetUrl(kind, facet.name)} title={`Weight ${facet.weight.toFixed(1)} from ${facet.count} title${facet.count === 1 ? '' : 's'}`}>
            {facet.name}<small>×{facet.count}</small>
          </a>
        ))}
        {!facets.length && <small>{empty}</small>}
      </div>
    </div>
  );
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
  // The stats module fetches up to 250 catalog details, so only mount it once the section is opened.

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

  const seedCount = taste?.positive_seeds.length ?? 0;
  const negativeCount = taste?.negative_ids.length ?? 0;

  return (
    <>
      <Card className="taste-snapshot" aria-labelledby="taste-title">
        <div className="taste-head">
          <div>
            <span className="eyebrow">What we learned</span>
            <h2 id="taste-title">Your taste so far</h2>
            <p className="taste-lede">
              {seedCount
                ? `Learned from ${seedCount} title${seedCount === 1 ? '' : 's'} you rated highly or finished${negativeCount ? `, and ${negativeCount} you dropped or disliked` : ''}.`
                : 'Rate a few matched titles 4★ or higher, or mark some as Completed, and this fills in.'}
            </p>
          </div>
          {seedCount > 0 && (
            <DSButton as="a" variant="primary" className="taste-cta" href={appUrl('?view=discover&for_you=1')}>
              <Sparkles size={15} aria-hidden="true" /> See your For You picks
            </DSButton>
          )}
        </div>
        {tasteLoading && <p className="profile-list-note" aria-live="polite">Reading catalog genres and tags for your titles…</p>}
        {taste && (
          <>
            <div className="taste-learned">
              <div>
                <h3>You tend to like</h3>
                <FacetRow label="Genres" kind="genre" facets={taste.distinct.liked_genres} empty="Needs matched titles to read genres." />
                <FacetRow label="Tags" kind="tag" facets={taste.distinct.liked_tags} empty="Needs matched titles to read tags." />
              </div>
              <div>
                <h3>You tend to avoid</h3>
                <FacetRow label="Genres" kind="genre" facets={taste.distinct.avoid_genres} empty="No dropped or low-rated titles yet." avoid />
                <FacetRow label="Tags" kind="tag" facets={taste.distinct.avoid_tags} empty="No negative tag signal yet." avoid />
              </div>
            </div>
            {taste.evidence.caveats.length > 0 && (
              <ul className="taste-caveats">
                {taste.evidence.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
              </ul>
            )}
            <details className="taste-sample">
              <summary>How this is calculated</summary>
              <p className="profile-list-note">
                {taste.positive_seeds.length} positive seeds · {taste.negative_ids.length} negatives ·{' '}
                {taste.exclude_ids.length} matched IDs excluded from ranking ·{' '}
                {taste.evidence.matched}/{taste.evidence.total_entries} library titles matched to catalog.
                {tasteLoadFailed ? ` ${tasteLoadFailed} detail shard${tasteLoadFailed === 1 ? '' : 's'} failed to load.` : ''}
                {' '}Genre and tag weights use rating, status and feedback, not equal title counts. Catalog snapshot {dataset?.dataset_version || profile.dataset_version}.
              </p>
              <h4>Positive seeds ({taste.positive_seeds.length}), used for For You</h4>
              <ul>
                {taste.positive_seeds.map((seed) => (
                  <li key={seed.novel_id}>
                    <a href={novelPageUrl(seed.novel_id)}>{seed.title}</a>
                    {' '}· weight {seed.weight.toFixed(2)} · {seed.reason}
                  </li>
                ))}
                {!taste.positive_seeds.length && <li>None yet. Rate matched titles 4★+ or mark Completed.</li>}
              </ul>
              {tasteDetails.length > 0 && (
                <>
                  <h4>Catalog titles loaded for genres and tags ({tasteDetails.length})</h4>
                  <ul>
                    {tasteDetails.map((detail) => (
                      <li key={detail.id}>
                        {displayNovelTitle(detail.title, detail.associated_names, settings.titlePreference)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          </>
        )}
      </Card>

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

      <details className="profile-stats-disclosure" open>
        <summary>
          <BarChart3 size={18} aria-hidden="true" />
          <span><strong>Library stats</strong><small>Status, scores, formats, activity, release years and genres</small></span>
        </summary>
        <Suspense fallback={<p className="analytics-state">Loading stats…</p>}>
          <ProfileAnalytics profile={profile} source={source} />
        </Suspense>
      </details>
    </>
  );
}
