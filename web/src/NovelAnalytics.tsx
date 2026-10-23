import { Check, Clock, Fingerprint, Gauge, Layers, UserCheck, X } from 'lucide-react';
import { Card } from './design-system';
import { browseFacetUrl } from './metadataLinks';
import {
  BUCKET_NOUN,
  FIT_LABEL,
  type FacetCohort,
  type FitResult,
  type TrustAnalysis,
} from './novelStats';
import type { TitleAnalysis } from './useNovelAnalytics';
import { novelPageUrl } from './novelLinks';
import './novel-analytics.css';

const pct = (value: number) => `${Math.round(value * 100)}%`;
const prevalenceLabel = (value: number) => (value < 0.01 ? '<1%' : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`);

function Eyebrow({ icon, children }: { icon: JSX.Element; children: string }) {
  return <span className="na-eyebrow">{icon}{children}</span>;
}

function TrustCard({ trust }: { trust: TrustAnalysis }) {
  const noun = BUCKET_NOUN[trust.bucket];
  const scale = (value: number) => `${Math.max(0, Math.min(100, ((value - 1) / 4) * 100))}%`;
  const moved = trust.adjustedRank - trust.rawRank;
  return (
    <Card className="na-card na-trust">
      <Eyebrow icon={<Gauge size={13} />}>Rating confidence</Eyebrow>
      <h3>Rating, adjusted for sample size</h3>
      <div className="na-trust-scores">
        <div><strong>{trust.adjusted.toFixed(2)}</strong><span>Adjusted</span></div>
        <div className="muted"><strong>{trust.rating.toFixed(2)}</strong><span>Raw · {trust.votes.toLocaleString()} votes</span></div>
        <span className={`na-chip sample-${trust.sample}`}>
          {{ thin: 'Thin sample', typical: 'Typical sample', large: 'Large sample' }[trust.sample]}
        </span>
      </div>
      <div className="na-scale" aria-hidden="true">
        <i className="mean" style={{ left: scale(trust.priorMean) }} title={`${noun} average ${trust.priorMean.toFixed(2)}`} />
        <i className="raw" style={{ left: scale(trust.rating) }} />
        <i className="adjusted" style={{ left: scale(trust.adjusted) }} />
      </div>
      <p className="na-legend"><b className="raw" />Raw <b className="adjusted" />Adjusted <b className="mean" />{noun} average {trust.priorMean.toFixed(2)}</p>
      <p>
        Pulled toward the {noun} average as if it had {Math.round(trust.priorVotes).toLocaleString()} more votes, so a few enthusiastic
        early ratings can&apos;t inflate it.
        {Math.abs(moved) >= 3
          ? ` Among ${trust.population.toLocaleString()} rated ${noun} it ranks #${trust.rawRank.toLocaleString()} by raw rating and #${trust.adjustedRank.toLocaleString()} once adjusted.`
          : ` It ranks #${trust.adjustedRank.toLocaleString()} of ${trust.population.toLocaleString()} rated ${noun} either way.`}
      </p>
      {trust.positive && (
        <p className="na-note">
          {pct(trust.positive.share)} of {trust.positive.votes.toLocaleString()} voters gave 4–5★ (95% interval {pct(trust.positive.low)}–{pct(trust.positive.high)}).
        </p>
      )}
    </Card>
  );
}

function NicheRow({ cohort, noun }: { cohort: FacetCohort; noun: string }) {
  const top = Math.max(1, Math.ceil((100 * cohort.ratingRank) / cohort.population));
  return (
    <li>
      <div>
        <a href={browseFacetUrl(cohort.kind, cohort.name)}>{cohort.name}</a>
        <small>{cohort.population.toLocaleString()} {noun}{cohort.avgRating ? ` · avg ${cohort.avgRating.toFixed(2)}` : ''}</small>
      </div>
      <div className="na-niche-rank">
        <strong>#{cohort.ratingRank.toLocaleString()}</strong>
        <small>top {top}% by rating · #{cohort.readerRank.toLocaleString()} by readers</small>
      </div>
      <div className="na-track" aria-hidden="true"><i style={{ width: `${Math.max(3, 100 - top)}%` }} /></div>
    </li>
  );
}

export function NovelAnalytics({
  analysis,
  profile,
  fit,
}: {
  analysis: TitleAnalysis;
  profile: boolean;
  fit: FitResult | null;
}) {
  const { trust, facets, length } = analysis;
  const noun = facets ? BUCKET_NOUN[facets.bucket] : 'titles';

  // Without a library the fit card is just a prompt, so it goes at the end as a slim banner instead of leading the block.
  const hasFit = fit != null && !('reason' in fit && fit.reason === 'no-profile');
  const showPrompt = fit != null && 'reason' in fit && fit.reason === 'no-profile';
  if (!trust && !facets?.niches.length && !facets?.distinctive.length && !length && !hasFit && !showPrompt) return null;

  return (
    <section className="novel-analytics" aria-label="Title analytics">
      {hasFit && fit && (
        <Card className={`na-card na-fit ${'verdict' in fit ? `fit-${fit.verdict}` : ''}`}>
          <Eyebrow icon={<UserCheck size={13} />}>Your fit</Eyebrow>
          {'verdict' in fit ? (
            <>
              <h3>{FIT_LABEL[fit.verdict]}</h3>
              <div className="na-fit-cols">
                <div>
                  <h4><Check size={13} />Matches what you like</h4>
                  {fit.liked.length
                    ? <div className="na-tags">{fit.liked.slice(0, 10).map((tag) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>)}</div>
                    : <p className="na-note">No overlap with the tags you rate highly.</p>}
                </div>
                <div>
                  <h4><X size={13} />Overlaps what you avoid</h4>
                  {fit.avoided.length
                    ? <div className="na-tags avoid">{fit.avoided.slice(0, 10).map((tag) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>)}</div>
                    : <p className="na-note">Nothing here matches titles you dropped or rated low.</p>}
                </div>
              </div>
              {fit.closest.length > 0 && (
                <div className="na-closest">
                  <h4>Closest to what you&apos;ve read</h4>
                  <ul>{fit.closest.map((item) => (
                    <li key={item.id}>
                      <a href={novelPageUrl(item.id)}>{item.title}</a>
                      <small>{item.rating ? `you rated ${item.rating}★ · ` : ''}{item.shared} shared tags</small>
                    </li>
                  ))}</ul>
                </div>
              )}
              <p className="na-note">
                Built from {fit.seedCount} {fit.scope === 'all' ? 'titles across all your formats' : `${BUCKET_NOUN[fit.scope]} you rated highly or finished`}. A signal from your own library, not a prediction.
              </p>
            </>
          ) : (
            <>
              <h3>{fit.reason === 'few-seeds' ? 'A few more ratings and this will light up' : 'See how this fits your taste'}</h3>
              <p>
                {fit.reason === 'few-seeds'
                  ? 'Rate at least three titles 4★ or higher, or mark some Completed, and this shows which tags you share with it and which you avoid.'
                  : 'Import your library or rate a few titles you loved and this shows which of its tags you like, which you avoid, and which of your titles are closest to it.'}
              </p>
              <a className="na-cta" href="?view=profile">{profile ? 'Open your profile' : 'Import your library'}</a>
            </>
          )}
        </Card>
      )}
      {trust && <TrustCard trust={trust} />}
      {length && (
        <Card className="na-card na-length">
          <Eyebrow icon={<Clock size={13} />}>Time commitment</Eyebrow>
          <h3>{length.units.toLocaleString()} {length.unitLabel}</h3>
          <p>
            {length.shape}. Longer than {Math.round(length.percentile)}% of {BUCKET_NOUN[length.bucket]}; the typical one runs {Math.round(length.median).toLocaleString()} {length.unitLabel}.
          </p>
          <p className="na-note" title={length.bucket === 'anime' ? 'Assumes 24 minutes per episode' : 'Assumes about 5 minutes per chapter'}>
            About {length.hours.toLocaleString()} hours to finish (estimate).
          </p>
        </Card>
      )}
      {facets && facets.distinctive.length > 0 && (
        <Card className={`na-card na-distinct${length ? ' na-wide' : ''}`}>
          <Eyebrow icon={<Fingerprint size={13} />}>What sets it apart</Eyebrow>
          <h3>Its rarest tags</h3>
          <div className="na-tags">{facets.distinctive.map((cohort) => (
            <a key={`${cohort.kind}-${cohort.name}`} href={browseFacetUrl(cohort.kind, cohort.name)} title={`${cohort.population.toLocaleString()} ${noun}`}>
              {cohort.name}<small>{prevalenceLabel(cohort.prevalence)}</small>
            </a>
          ))}</div>
          <p className="na-note">Share of all {noun} carrying the tag. Lower means rarer.</p>
          {facets.common.length > 0 && (
            <p className="na-common">Common here: {facets.common.map((cohort) => `${cohort.name} (${pct(cohort.prevalence)})`).join(', ')}</p>
          )}
        </Card>
      )}
      {facets && facets.niches.length > 0 && (
        <Card className="na-card na-niches">
          <Eyebrow icon={<Layers size={13} />}>Standing in its niches</Eyebrow>
          <h3>Where it ranks among similar {noun}</h3>
          <ul>{facets.niches.map((cohort) => <NicheRow key={`${cohort.kind}-${cohort.name}`} cohort={cohort} noun={noun} />)}</ul>
          <p className="na-note">Ranked by the sample-size-adjusted rating, against {noun} that share the same genre or tag.</p>
        </Card>
      )}
      {showPrompt && (
        <Card className="na-card na-wide na-prompt">
          <UserCheck size={16} aria-hidden="true" />
          <p>See how this title fits <em>your</em> taste: which of its tags you like, which you avoid, and which of your titles are closest.</p>
          <a className="na-cta" href="?view=profile">{profile ? 'Open your profile' : 'Import your library'}</a>
        </Card>
      )}
    </section>
  );
}
