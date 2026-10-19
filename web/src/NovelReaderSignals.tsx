import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, Users } from 'lucide-react';
import { CuratedListSummary, NovelDetail, NovelInsights, RelatedSeriesItem } from './types';
import { novelPageUrl } from './novelLinks';
import { staticListIds } from './forYouStatic';
import { listPageUrl } from './listPageUrl';

type Star = '5' | '4' | '3' | '2' | '1';
const STARS: Star[] = ['5', '4', '3', '2', '1'];

export interface RatingSummary {
  total: number;
  mean: number;
  highShare: number;
  lowShare: number;
  verdict: 'Divisive' | 'Widely loved' | 'Mixed reception' | null;
}

export function summarizeRatings(dist?: NovelDetail['rating_dist']): RatingSummary | null {
  if (!dist) return null;
  const total = STARS.reduce((sum, star) => sum + (dist[star] || 0), 0);
  if (total < 30) return null;
  const mean = STARS.reduce((sum, star) => sum + Number(star) * (dist[star] || 0), 0) / total;
  const variance = STARS.reduce((sum, star) => sum + (dist[star] || 0) * (Number(star) - mean) ** 2, 0) / total;
  const share = (stars: Star[]) => stars.reduce((sum, star) => sum + (dist[star] || 0), 0) / total;
  const highShare = share(['4', '5']);
  const lowShare = share(['1', '2']);
  let verdict: RatingSummary['verdict'] = null;
  if (lowShare >= 0.2 && share(['5']) >= 0.3) verdict = 'Divisive';
  else if (highShare >= 0.8) verdict = 'Widely loved';
  else if (Math.sqrt(variance) >= 1.2) verdict = 'Mixed reception';
  return { total, mean, highShare, lowShare, verdict };
}

/** Plain-language labels derived from catalog percentiles; a conclusion, not a score. */
export function catalogVerdicts(insights?: NovelInsights | null): string[] {
  if (!insights) return [];
  const pct = (key: 'rating' | 'rating_votes' | 'readers') => insights.metrics.find((m) => m.key === key)?.percentile ?? 0;
  const labels: string[] = [];
  if (pct('rating') >= 80 && pct('readers') <= 60) labels.push('Hidden gem');
  if (pct('rating') >= 75 && pct('readers') >= 90) labels.push('Crowd favorite');
  if (pct('readers') >= 90 && pct('rating') <= 40) labels.push('Popular but polarizing');
  return labels;
}

export function RatingDistributionCard({ detail }: { detail: NovelDetail }) {
  const summary = summarizeRatings(detail.rating_dist);
  if (!summary || !detail.rating_dist) return null;
  const dist = detail.rating_dist;
  const max = Math.max(1, ...STARS.map((star) => dist[star] || 0));
  return <section className="reader-ratings" aria-label="How readers rate this title">
    <header>
      <div><span className="eyebrow">Reader votes</span><h3>How readers rate it</h3></div>
      {summary.verdict && <span className={`verdict-chip ${summary.verdict === 'Divisive' ? 'warn' : ''}`}>{summary.verdict}</span>}
    </header>
    <div className="star-bars">
      {STARS.map((star) => {
        const count = dist[star] || 0;
        return <div key={star} className={`star-row s${star}`}>
          <span>{star}★</span>
          <div className="star-track"><i style={{ width: `${(count / max) * 100}%` }} /></div>
          <b>{((count / summary.total) * 100).toFixed(0)}%</b>
          <small>{count.toLocaleString()}</small>
        </div>;
      })}
    </div>
    <p>
      <strong>{Math.round(summary.highShare * 100)}%</strong> rate it 4–5★ · <strong>{Math.round(summary.lowShare * 100)}%</strong> rate it 1–2★ · from {summary.total.toLocaleString()} star votes
    </p>
  </section>;
}

const RELATION_LABELS: Record<string, string> = {
  prequel: 'Prequels', sequel: 'Sequels', parent: 'Main story', spin_off: 'Spin-offs',
  side_story: 'Side stories', adaptation: 'Adaptations', alternative: 'Alternative versions',
  character: 'Character appearances', source: 'Source material', other: 'Other', related: 'Related'
};
const RELATION_ORDER = ['parent', 'prequel', 'sequel', 'spin_off', 'side_story', 'adaptation', 'alternative', 'character', 'related', 'other'];

export function SeriesCard({ items, fromId }: { items: RelatedSeriesItem[]; fromId: number }) {
  if (!items.length) return null;
  const extra = [...new Set(items.map((item) => item.relation))].filter((relation) => !RELATION_ORDER.includes(relation));
  const groups = [...RELATION_ORDER, ...extra].map((relation) => ({ relation, items: items.filter((item) => item.relation === relation) }))
    .filter((group) => group.items.length);
  return <section className="series-card" aria-label="Series and adaptations">
    <header><div><span className="eyebrow">Same world</span><h3>Series &amp; adaptations</h3></div><span className="series-count">{items.length}</span></header>
    {groups.map((group) => <div key={group.relation} className="series-group">
      <h4>{RELATION_LABELS[group.relation] || group.relation}</h4>
      <ul>{group.items.slice(0, 6).map((item) => <li key={item.id}>
        <a href={novelPageUrl(item.id, fromId)} data-preview-id={item.id}>
          <span className="series-cover">{item.cover_url ? <img src={item.cover_url} alt="" loading="lazy" /> : <BookOpen size={14} />}</span>
          <span><strong>{item.title}</strong><small>{[item.media_type, item.year].filter(Boolean).join(' · ')}</small></span>
        </a>
      </li>)}</ul>
      {group.items.length > 6 && <small className="series-more">+{group.items.length - 6} more</small>}
    </div>)}
  </section>;
}

const GENERIC_LIST_TITLE = /^Novel Updates List \d+$/i;

export function CuratedListsCard({ lists }: { lists: CuratedListSummary[] }) {
  // Lists with a page in this snapshot open our list page; the rest still go to Novel Updates.
  const [known, setKnown] = useState<Set<number>>(new Set());
  useEffect(() => { void staticListIds().then(setKnown); }, []);
  if (!lists.length) return null;
  const named = lists.filter((list) => !GENERIC_LIST_TITLE.test(list.title));
  const unnamed = lists.length - named.length;
  if (named.length === 0) return <p className="curated-lists-note"><Users size={13} /> On {lists.length} reader-made list{lists.length === 1 ? '' : 's'} on Novel Updates.</p>;
  return <section className="curated-lists" aria-label="Curated lists featuring this title">
    <header><div><span className="eyebrow">Community curation</span><h3>On {lists.length} reader-made list{lists.length === 1 ? '' : 's'}</h3></div></header>
    {named.length > 0 && <ul>{named.slice(0, 6).map((list) => <li key={list.id}>
      <a
        href={known.has(list.id) ? listPageUrl(list.id) : `https://www.novelupdates.com/viewlist/${list.id}/`}
        {...(known.has(list.id) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      >
        <strong>{list.title}</strong>
        <small>{list.curator ? `by ${list.curator} · ` : ''}{list.item_count ? `${list.item_count} titles` : 'list'}{list.followers > 0 && <> · <Users size={11} /> {list.followers.toLocaleString()}</>}</small>
        {known.has(list.id) ? <BookOpen size={13} /> : <ExternalLink size={13} />}
      </a>
    </li>)}</ul>}
    {(unnamed > 0 || named.length > 6) && <p>{named.length > 6 ? `${named.length - 6} more named lists` : ''}{named.length > 6 && unnamed > 0 ? ' and ' : ''}{unnamed > 0 ? `${unnamed} list${unnamed === 1 ? '' : 's'} without a saved title` : ''}.</p>}
  </section>;
}
