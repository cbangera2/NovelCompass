import {
  ArrowLeft, BookMarked, BookOpen, Check, ExternalLink, Heart, Library,
  MessageSquare, Search, Sparkles, Star, ThumbsDown
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createDataSource, externalMediaUrl, RecommendationDataSource, sourceDisplayName } from './data';
import { Card, DSButton, Skeleton } from './design-system';
import { browseFacetUrl } from './metadataLinks';
import { NovelInsightsPanel } from './NovelInsightsPanel';
import { loadLocalProfile, saveLocalProfile } from './profile/store';
import { LocalNovelFeedback, LocalUserProfile, ReadingStatus } from './profile/types';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { CuratedListSummary, NovelDetail, NovelInsights, Recommendation, RelatedSeriesItem } from './types';
import { catalogVerdicts, CuratedListsCard, RatingDistributionCard, SeriesCard, summarizeRatings } from './NovelReaderSignals';
import { formatStatusLabel, getMediaBadgeInfo, hasUsableCover, novelPageUrl } from './novelLinks';
import { CollapsibleFacetList } from './CollapsibleFacetList';
import './novel-page.css';
import { useDataModePreference } from './dataModePreference';

const STATUS_LABELS: Record<string, string> = {
  reading: 'Reading', completed: 'Completed', plan_to_read: 'Plan to read', dropped: 'Dropped', paused: 'Paused'
};

const CHANNEL_LABELS: Record<string, string> = {
  vector: 'Meaning', tag: 'Tags', direct_rec: 'Reader recs',
  rec_list: 'Curated lists', ease: 'Co-read pattern', structural: 'Catalog structure'
};

/** Rank 1 → full strength, rank ~100 → faint (ranks are pool positions, not percentages). */
const signalStrength = (rank: number) => Math.max(0.12, 1 - Math.log10(Math.max(1, rank)) / 2);

export default function NovelPage(): JSX.Element {
  const { mode: dataMode } = useDataModePreference();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const novelId = Number(params.get('id'));
  const fromId = Number(params.get('from')) || undefined;
  const { settings } = useDisplaySettings();
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [origin, setOrigin] = useState<NovelDetail | null>(null);
  const [relationship, setRelationship] = useState<Recommendation | null>(null);
  const [related, setRelated] = useState<Recommendation[]>([]);
  const [insights, setInsights] = useState<NovelInsights | null>(null);
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [error, setError] = useState('');
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const [hideKnown, setHideKnown] = useState(false);
  const [series, setSeries] = useState<RelatedSeriesItem[]>([]);
  const [curatedLists, setCuratedLists] = useState<CuratedListSummary[]>([]);
  const [activeSection, setActiveSection] = useState(() => window.location.hash.slice(1) || (fromId ? 'relationship' : 'overview'));

  useEffect(() => {
    let cancelled = false;
    if (!Number.isInteger(novelId) || novelId <= 0) {
      setError('This title link is missing a valid catalog ID.');
      return;
    }
    Promise.all([createDataSource(dataMode), loadLocalProfile().catch(() => null)])
      .then(async ([dataSource, localProfile]) => {
        if (cancelled) return;
        setSource(dataSource);
        setProfile(localProfile);
        const novel = await dataSource.getNovel(novelId);
        if (cancelled) return;
        setDetail(novel);
        const relatedRequest = dataSource.getRecommendations({ query: String(novelId), limit: 12 })
          .then((response) => !cancelled && setRelated(response.recommendations))
          .catch(() => undefined);
        const insightsRequest = dataSource.getNovelInsights(novelId)
          .then((value) => !cancelled && setInsights(value))
          .catch(() => undefined);
        dataSource.getRelatedSeries?.(novelId).then((value) => !cancelled && setSeries(value)).catch(() => undefined);
        dataSource.getCuratedLists?.(novelId).then((value) => !cancelled && setCuratedLists(value)).catch(() => undefined);
        const relationshipRequest = fromId
          ? Promise.all([
              dataSource.getNovel(fromId).catch(() => null),
              dataSource.getRecommendations({ query: String(fromId), limit: 100 }).catch(() => null)
            ]).then(([fromNovel, response]) => {
              if (cancelled) return;
              setOrigin(fromNovel);
              setRelationship(response?.recommendations.find((item) => item.target_id === novelId) || null);
            })
          : Promise.resolve();
        await Promise.all([relatedRequest, insightsRequest, relationshipRequest]);
      })
      .catch((reason) => !cancelled && setError(reason.message || 'Could not load this title.'));
    return () => { cancelled = true; };
  }, [dataMode, fromId, novelId]);

  const currentFeedback = profile?.feedback?.find((item) => item.novel_id === novelId)?.signal;
  const libraryEntry = profile?.entries.find((item) => item.novel_id === novelId);
  const currentRating = libraryEntry?.rating;
  const ratingSummary = useMemo(() => summarizeRatings(detail?.rating_dist), [detail]);
  const verdictChips = [...(ratingSummary?.verdict ? [ratingSummary.verdict] : []), ...catalogVerdicts(insights)];
  const libraryIds = useMemo(() => {
    const map = new Map<number, LocalUserProfile['entries'][number]>();
    profile?.entries.forEach((entry) => { if (entry.novel_id != null) map.set(entry.novel_id, entry); });
    return map;
  }, [profile]);
  const knownCount = related.slice(0, 10).filter((item) => libraryIds.has(item.target_id)).length;
  const title = detail ? displayNovelTitle(detail.title, detail.associated_names, settings.titlePreference) : '';

  const saveFeedback = async (signal: LocalNovelFeedback['signal']) => {
    if (!detail) return;
    const now = new Date().toISOString();
    const base: LocalUserProfile = profile || {
      profile_id: crypto.randomUUID(), parser_version: 1, dataset_version: 'local',
      imported_at: now, source_fingerprints: [], entries: [], curated_lists: [], feedback: []
    };
    const feedback = (base.feedback || []).filter((item) => item.novel_id !== novelId);
    if (currentFeedback !== signal) feedback.push({
      novel_id: novelId, slug: detail.slug, title: detail.title, signal, updated_at: now
    });
    const updated = { ...base, feedback };
    await saveLocalProfile(updated);
    setProfile(updated);
  };

  const saveRating = async (rating?: number) => {
    if (!detail) return;
    const now = new Date().toISOString();
    const base: LocalUserProfile = profile || {
      profile_id: crypto.randomUUID(), parser_version: 1, dataset_version: 'local',
      imported_at: now, source_fingerprints: [], entries: [], curated_lists: [], feedback: []
    };
    const existing = base.entries.find((entry) => entry.novel_id === novelId);
    const entries = base.entries.filter((entry) => entry.novel_id !== novelId);
    if (existing || rating != null) entries.push({
      novel_id: novelId, slug: detail.slug, imported_title: detail.title,
      status: existing?.status || 'plan_to_read', rating, progress: existing?.progress,
      source_file: existing?.source_file || 'local-rating'
    });
    const updated = { ...base, entries };
    await saveLocalProfile(updated);
    setProfile(updated);
  };

  const saveStatus = async (status: ReadingStatus) => {
    if (!detail) return;
    const now = new Date().toISOString();
    const base: LocalUserProfile = profile || {
      profile_id: crypto.randomUUID(), parser_version: 1, dataset_version: 'local',
      imported_at: now, source_fingerprints: [], entries: [], curated_lists: [], feedback: []
    };
    const existing = base.entries.find((entry) => entry.novel_id === novelId);
    const entries = base.entries.filter((entry) => entry.novel_id !== novelId);
    entries.push({
      novel_id: novelId, slug: detail.slug, imported_title: detail.title, status,
      rating: existing?.rating, progress: existing?.progress, source_file: existing?.source_file || 'local-rating'
    });
    const updated = { ...base, entries };
    await saveLocalProfile(updated);
    setProfile(updated);
  };

  const heroRef = useRef<HTMLElement>(null);
  const [heroGone, setHeroGone] = useState(false);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => setHeroGone(!entry.isIntersecting), { threshold: 0 });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [detail]);

  useEffect(() => {
    const sections = [...document.querySelectorAll<HTMLElement>('[data-novel-section]')];
    if (!sections.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
      const id = visible[0]?.target.id;
      if (id) setActiveSection(id);
    }, { rootMargin: '-22% 0px -58% 0px', threshold: [0, .1, .5] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [detail]);

  const goToSection = (id: string) => {
    const section = document.getElementById(id);
    if (!section) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${id}`);
    setActiveSection(id);
  };

  if (error) return <main className="novel-page-state"><Card><BookOpen /><h1>Title unavailable</h1><p>{error}</p><DSButton as="a" href={import.meta.env.BASE_URL}>Return to Discover</DSButton></Card></main>;
  if (!detail || !source) return <main className="novel-page novel-page-loading" aria-busy="true"><Skeleton className="novel-hero-skeleton" /><Skeleton className="novel-content-skeleton" /></main>;

  return <main className="novel-page">
    <nav className="novel-breadcrumbs" aria-label="Breadcrumb">
      <a href={fromId ? novelPageUrl(fromId) : import.meta.env.BASE_URL}><ArrowLeft size={15} />{origin ? `Back to ${origin.title}` : 'Back to discovery'}</a>
      <span>/</span><span aria-current="page">{title}</span>
    </nav>

    <section className="novel-hero" ref={heroRef} style={hasUsableCover(detail.cover_url) ? ({ ["--hero-cover" as string]: `url("${detail.cover_url}")` }) : undefined}>
      <div className="novel-cover-shell">
        {hasUsableCover(detail.cover_url) ? <img src={detail.cover_url} alt={`Cover of ${title}`} /> : <BookOpen aria-label="No cover available" />}
      </div>
      <div className="novel-hero-copy">
        <div className="novel-eyebrow">
          {(() => {
            const badge = getMediaBadgeInfo({ id: detail.id, media_type: detail.media_type, source: detail.source });
            return (
              <>
                <span className={`search-badge source-badge ${badge.sourceKey}`}>
                  {badge.sourceLabel}
                </span>
                <span className={`search-badge format-badge ${badge.formatKey}`}>
                  {badge.formatLabel}
                </span>
              </>
            );
          })()}
          {detail.status_trans && <span>{formatStatusLabel(detail.status_trans)}</span>}
        </div>
        <h1>{title}</h1>
        <p className="novel-byline">
          {detail.author ? <a href={browseFacetUrl('author', detail.author)}>{detail.author}</a> : 'Unknown author'}
          {detail.language && <> · <a href={browseFacetUrl('language', detail.language)}>{detail.language}</a></>}
          {detail.year && <> · {detail.year}</>}
        </p>
        <div className="novel-stats">
          <div><strong>{detail.rating.toFixed(1)}</strong><span>rating</span><small>{detail.rating_votes.toLocaleString()} votes</small></div>
          <div><strong>{Math.max(0, detail.reading_list_count).toLocaleString()}</strong><span>readers</span><small>on reading lists</small></div>
          <div><strong>{detail.chapters_trans > 0 ? detail.chapters_trans.toLocaleString() : '—'}</strong><span>chapters</span><small>{detail.chapters_trans > 0 ? (detail.chapters_orig ? `${detail.chapters_orig.toLocaleString()} original` : 'translated') : 'not tracked'}</small></div>
        </div>
        {insights && <div className="novel-standing" aria-label="Catalog standing">
          {insights.metrics.map((metric) => {
            const top = Math.max(0.1, 100 - metric.percentile);
            const label = metric.key === 'rating_votes' ? 'Votes' : metric.key === 'readers' ? 'Readers' : 'Rating';
            return <div key={metric.key} title={`Rank ${metric.rank.toLocaleString()} of ${metric.population.toLocaleString()}`}>
              <span>{label}</span>
              <strong>Top {top < 10 ? top.toFixed(1) : top.toFixed(0)}%</strong>
              <div className="standing-track"><i style={{ left: `${Math.min(98, Math.max(2, metric.percentile))}%` }} /></div>
              <small>#{metric.rank.toLocaleString()} of {metric.population.toLocaleString()}</small>
            </div>;
          })}
        </div>}
        {verdictChips.length > 0 && <div className="novel-verdicts">{verdictChips.map((label) => <span key={label} className={label === 'Divisive' || label.includes('polarizing') ? 'warn' : ''}>{label}</span>)}</div>}
        <div className="novel-library-state">
          <Library size={15} />
          <label>
            <span>{libraryEntry ? 'In your library' : 'Add to library'}</span>
            <select value={libraryEntry?.status || ''} onChange={(event) => saveStatus(event.target.value as ReadingStatus)} aria-label="Reading status">
              {!libraryEntry && <option value="" disabled>Choose status…</option>}
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {libraryEntry?.rating ? <span>{libraryEntry.rating}★</span> : null}
          {libraryEntry?.progress ? <span>{libraryEntry.progress}</span> : null}
        </div>
        <div className="novel-actions">
          <DSButton as="a" variant="primary" href={`${import.meta.env.BASE_URL}?seed=${novelId}`}><Sparkles size={17} />Find similar</DSButton>
          <DSButton as="a" variant="outline" href={detail.external_url || externalMediaUrl(detail.id, detail.source, detail.external_id, detail.media_type)} target="_blank" rel="noopener noreferrer">
            Open on {sourceDisplayName(detail.source, detail.id)} <ExternalLink size={15} />
          </DSButton>
        </div>
        <div className="novel-feedback" aria-label="Personal feedback">
          <span>Fine-tune your local profile</span>
          {([
            ['love', Heart, 'Love'], ['read', Check, 'Read'], ['not_for_me', ThumbsDown, 'Not for me']
          ] as const).map(([signal, Icon, label]) =>
            <button key={signal} className={currentFeedback === signal ? 'active' : ''} aria-pressed={currentFeedback === signal}
              onClick={() => saveFeedback(signal)}><Icon size={15} />{label}</button>
          )}
          <small>Saved only in this browser</small>
        </div>
        <div className="novel-personal-rating" aria-label="Your personal rating">
          <span>Your rating</span>
          <div>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button"
            className={(currentRating || 0) >= rating ? 'active' : ''}
            aria-label={`Rate ${rating} out of 5`} aria-pressed={currentRating === rating}
            onClick={() => saveRating(currentRating === rating ? undefined : rating)}>
            <Star size={18} fill="currentColor" />
          </button>)}</div>
          <small>{currentRating ? `${currentRating} of 5 · select again to clear` : 'Not rated · saved only in this browser'}</small>
        </div>
      </div>
    </section>

    <nav className="novel-section-nav" aria-label="Title sections">
      {([['overview', BookOpen, 'Overview'], ['relationship', MessageSquare, 'Relationships'], ['insights', Library, 'Insights']] as const)
        .map(([id, Icon, label]) => <button key={id} className={activeSection === id ? 'active' : ''}
          aria-current={activeSection === id ? 'location' : undefined} onClick={() => goToSection(id)}>
          <Icon size={15} />{label}
        </button>)}
      <div className={`novel-mini ${heroGone ? 'show' : ''}`} aria-hidden={!heroGone}>
        {hasUsableCover(detail.cover_url) && <img src={detail.cover_url} alt="" />}
        <strong>{title}</strong>
        <a href={`${import.meta.env.BASE_URL}?seed=${novelId}`} tabIndex={heroGone ? 0 : -1}><Sparkles size={13} />Find similar</a>
      </div>
    </nav>
    <div className="novel-sections">
      <section id="overview" data-novel-section className="novel-major-section">
        <header className="novel-section-heading"><span>01</span><div><h2>Overview</h2><p>Story details, genres, and themes.</p></div></header>
        <div className="novel-content-grid">
          <Card className="novel-about">
            <h2>About this title</h2>
            {(() => {
              const text = detail.synopsis || 'A synopsis is not available in this catalog snapshot.';
              const long = text.length > 520;
              return <>
                <p className={long && !synopsisOpen ? 'clamped' : ''}>{text}</p>
                {long && <button type="button" className="novel-readmore" aria-expanded={synopsisOpen}
                  onClick={() => setSynopsisOpen((value) => !value)}>{synopsisOpen ? 'Show less' : 'Read more'}</button>}
              </>;
            })()}
            {detail.associated_names.length > 0 && (detail.associated_names.length <= 4
              ? <div className="novel-aliases"><strong>Alternative titles</strong><ul>{detail.associated_names.map((name) => <li key={name}>{name}</li>)}</ul></div>
              : <details><summary>Alternative titles · {detail.associated_names.length}</summary><ul>{detail.associated_names.map((name) => <li key={name}>{name}</li>)}</ul></details>)}
          </Card>
          <Card className="novel-facets">
            <h2>Genres & themes</h2>
            <CollapsibleFacetList items={detail.genres} compactCount={8} noun="genres" hrefFor={(genre) => browseFacetUrl('genre', genre)} />
            <h3>Tags</h3>
            <CollapsibleFacetList className="tag-facets" items={detail.tags} compactCount={12} noun="tags" hrefFor={(tag) => browseFacetUrl('tag', tag)} />
          </Card>
        </div>
        {(detail.rating_dist || series.length > 0) && <div className="novel-signals-grid">
          <RatingDistributionCard detail={detail} />
          <SeriesCard items={series} fromId={novelId} />
        </div>}
      </section>
      <section id="relationship" data-novel-section className="novel-major-section">
        <header className="novel-section-heading"><span>02</span><div><h2>Relationships</h2><p>Recommendation evidence and related directions to explore.</p></div></header>
        {origin && <RelationshipPanel relationship={relationship} origin={origin} current={detail} />}
        {related.length > 0 && <section className="novel-related">
          <div className="section-heading"><div><span>Continue exploring</span><h2>Related titles</h2></div><a href={`${import.meta.env.BASE_URL}?seed=${novelId}`}>See full recommendations <Search size={15} /></a></div>
          <p className="related-definition">Ranked from the current recommendation candidate pool. Percent match is normalized within this seed’s result set. Hover or focus a card for the full evidence.</p>
          <label className="related-filter">
            <input type="checkbox" checked={hideKnown} onChange={(event) => setHideKnown(event.target.checked)} />
            Hide titles already in my library{knownCount > 0 && <span>{knownCount} in this list</span>}
          </label>
          <div className="novel-related-grid">{related.filter((item) => !hideKnown || !libraryIds.has(item.target_id)).slice(0, 10).map((item) => {
            const entry = libraryIds.get(item.target_id);
            const signals = Object.entries(CHANNEL_LABELS).map(([channel, label]) => ({ label, rank: item.channel_ranks[channel] }))
              .filter((signal) => Number.isFinite(signal.rank)).sort((x, y) => x.rank - y.rank);
            return <div className="related-item" key={item.target_id}>
              <a className="related-novel" href={novelPageUrl(item.target_id, novelId)}>
                <span className="related-cover">
                  <RelatedCover src={item.cover_url} />
                  <b>{item.match_score_percent.toFixed(0)}%</b>
                  {entry && <em className="related-owned">{STATUS_LABELS[entry.status] || 'In library'}</em>}
                </span>
                <strong>{item.title}</strong>
                <small>{item.author || item.language}</small>
                <small className="related-stats">{item.rating ? `${item.rating.toFixed(1)}★` : 'Unrated'} · {item.reading_list_count.toLocaleString()} readers</small>
                <span className="related-signals" aria-hidden="true">
                  {Object.keys(CHANNEL_LABELS).map((channel) => {
                    const rank = item.channel_ranks[channel];
                    const strength = Number.isFinite(rank) ? signalStrength(rank) : 0.06;
                    return <i key={channel} style={{ opacity: strength }} />;
                  })}
                </span>
                <small className="related-reason">{item.shared_tags.slice(0, 2).length ? `Shares ${item.shared_tags.slice(0, 2).join(', ')}` : (item.evidence_bullets[0] || '')}</small>
              </a>
              <div className="related-pop" role="tooltip">
                <strong>{item.title}</strong>
                <p>{[item.author, item.language].filter(Boolean).join(' · ')}</p>
                <div className="pop-facts">
                  <span><b>{item.rating ? item.rating.toFixed(1) : '—'}</b>rating · {item.rating_votes.toLocaleString()} votes</span>
                  <span><b>{item.reading_list_count.toLocaleString()}</b>readers</span>
                  <span><b>{item.chapters_trans > 0 ? item.chapters_trans.toLocaleString() : '—'}</b>chapters{item.status_trans ? ` · ${formatStatusLabel(item.status_trans)}` : ''}</span>
                </div>
                {signals.length > 0 && <div className="pop-signals">
                  <h5>Why it surfaced · {item.match_score_percent.toFixed(0)}% match</h5>
                  {signals.map((signal) => <div key={signal.label}>
                    <span>{signal.label}</span>
                    <i><u style={{ width: `${signalStrength(signal.rank) * 100}%` }} /></i>
                    <b>#{signal.rank}</b>
                  </div>)}
                </div>}
                {item.shared_tags.length > 0 && <div className="pop-tags">
                  <h5>Shared tags · {item.shared_tags.length}</h5>
                  <span>{item.shared_tags.slice(0, 8).map((tag) => <em key={tag}>{tag}</em>)}{item.shared_tags.length > 8 && <em>+{item.shared_tags.length - 8}</em>}</span>
                </div>}
                {extraEvidence(item).length > 0 && <ul>{extraEvidence(item).map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
                {(item.curated_lists?.length || 0) > 0 && <p className="pop-lists">On {item.curated_lists!.length} curated list{item.curated_lists!.length === 1 ? '' : 's'}</p>}
              </div>
            </div>;
          })}</div>
        </section>}
        <CuratedListsCard lists={curatedLists} />
        {!origin && <RelationshipPanel relationship={relationship} origin={origin} current={detail} />}
      </section>
      <section id="insights" data-novel-section className="novel-major-section">
        <header className="novel-section-heading"><span>03</span><div><h2>Insights</h2><p>How this title sits within the current catalog snapshot.</p></div></header>
        <NovelInsightsPanel novelId={novelId} source={source} providedInsights={insights} currentNovel={detail} />
      </section>
    </div>
  </main>;
}

/** Evidence not already shown as tag chips or the curated-list line in the hover card. */
function extraEvidence(item: Recommendation): string[] {
  return item.evidence_bullets.filter((bullet) => !/^(Shared key tropes|Co-occurs on)/i.test(bullet)).slice(0, 3);
}

function RelationshipPanel({ relationship, origin, current }: {
  relationship: Recommendation | null; origin: NovelDetail | null; current: NovelDetail;
}) {
  if (!origin) return <Card className="relationship-empty"><Sparkles /><h2>Why does this title connect?</h2><p>Open this title from a recommendation to see the exact evidence connecting it to your starting title.</p><DSButton as="a" href={`${import.meta.env.BASE_URL}?seed=${current.id}`}>Use as a starting point</DSButton></Card>;
  if (!relationship) return <Card className="relationship-empty"><h2>Relationship to {origin.title}</h2><p>This title is outside the saved candidate pool, so detailed ranking evidence is not available.</p></Card>;
  const ranks = Object.entries(relationship.channel_ranks).filter(([, rank]) => Number.isFinite(rank));
  const maxRank = Math.max(1, ...ranks.map(([, rank]) => rank));
  return <Card className="relationship-card">
    <div className="relationship-heading"><div><span>Recommendation evidence</span><h2><a href={novelPageUrl(origin.id)}>{origin.title}</a> <span>→</span> <a href={novelPageUrl(current.id, origin.id)}>{current.title}</a></h2></div><strong>{relationship.match_score_percent.toFixed(0)}%<small>match</small></strong></div>
    <div className="relationship-layout">
      <div><h3>Why it surfaced</h3><ul>{relationship.evidence_bullets.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul>
        {relationship.shared_tags.length > 0 && <div className="shared-facets">{relationship.shared_tags.slice(0, 12).map((tag) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>)}</div>}</div>
      <div className="rank-chart"><h3>Signal strength</h3><p>Lower rank means this signal connected the titles more strongly.</p>{ranks.map(([channel, rank]) =>
        <div key={channel}><span>{CHANNEL_LABELS[channel] || channel.replace(/_/g, ' ')}</span><div><i style={{ width: `${Math.max(8, 100 - ((rank - 1) / maxRank) * 88)}%` }} /></div><b>#{rank}</b></div>)}</div>
    </div>
  </Card>;
}

function RelatedCover({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!hasUsableCover(src) || failed) return <BookMarked />;
  return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
