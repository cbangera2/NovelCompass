import {
  ArrowLeft, BookMarked, BookOpen, Check, ExternalLink, Heart, Library,
  MessageSquare, Search, Sparkles, Star, ThumbsDown
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createDataSource, externalMediaUrl, RecommendationDataSource, sourceDisplayName } from './data';
import { Card, DSButton, Skeleton } from './design-system';
import { browseFacetUrl } from './metadataLinks';
import { NovelInsightsPanel } from './NovelInsightsPanel';
import { loadLocalProfile, saveLocalProfile } from './profile/store';
import { LocalNovelFeedback, LocalUserProfile } from './profile/types';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { NovelDetail, NovelInsights, Recommendation } from './types';
import { getMediaBadgeInfo, novelPageUrl } from './novelLinks';
import { CollapsibleFacetList } from './CollapsibleFacetList';
import './novel-page.css';
import { useDataModePreference } from './dataModePreference';

const CHANNEL_LABELS: Record<string, string> = {
  vector_rank: 'Meaning', tag_rank: 'Tags', direct_rec_rank: 'Reader recs',
  rec_list_rank: 'Curated lists', structural_rank: 'Catalog structure'
};

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
  const currentRating = profile?.entries.find((item) => item.novel_id === novelId)?.rating;
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

    <section className="novel-hero">
      <div className="novel-cover-shell">
        {detail.cover_url ? <img src={detail.cover_url} alt={`Cover of ${title}`} /> : <BookOpen aria-label="No cover available" />}
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
          {detail.status_trans && <span>{detail.status_trans}</span>}
        </div>
        <h1>{title}</h1>
        <p className="novel-byline">
          {detail.author ? <a href={browseFacetUrl('author', detail.author)}>{detail.author}</a> : 'Unknown author'}
          {detail.language && <> · <a href={browseFacetUrl('language', detail.language)}>{detail.language}</a></>}
          {detail.year && <> · {detail.year}</>}
        </p>
        <div className="novel-stats">
          <div><strong>{detail.rating.toFixed(1)}</strong><span>rating</span><small>{detail.rating_votes.toLocaleString()} votes</small></div>
          <div><strong>{detail.reading_list_count.toLocaleString()}</strong><span>readers</span><small>on reading lists</small></div>
          <div><strong>{detail.chapters_trans.toLocaleString()}</strong><span>chapters</span><small>{detail.chapters_orig ? `${detail.chapters_orig.toLocaleString()} original` : 'translated'}</small></div>
        </div>
        {insights && <div className="novel-rank-strip" aria-label="Catalog ranks">
          {insights.metrics.map((metric) => <div key={metric.key}>
            <span>{metric.key === 'rating_votes' ? 'votes' : metric.key}</span>
            <strong>#{metric.rank.toLocaleString()}</strong>
            <small>of {metric.population.toLocaleString()}</small>
          </div>)}
        </div>}
        <dl className="novel-facts" aria-label="Publication details">
          {detail.language && <div><dt>Language</dt><dd><a href={browseFacetUrl('language', detail.language)}>{detail.language}</a></dd></div>}
          {detail.year && <div><dt>Year</dt><dd>{detail.year}</dd></div>}
          {detail.status_trans && <div><dt>Status</dt><dd>{detail.status_trans}</dd></div>}
          <div><dt>Translated</dt><dd>{detail.chapters_trans.toLocaleString()} chapters</dd></div>
        </dl>
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
      {([['overview', BookOpen, 'Overview'], ['insights', Library, 'Insights'], ['relationship', MessageSquare, 'Relationships']] as const)
        .map(([id, Icon, label]) => <button key={id} className={activeSection === id ? 'active' : ''}
          aria-current={activeSection === id ? 'location' : undefined} onClick={() => goToSection(id)}>
          <Icon size={15} />{label}
        </button>)}
    </nav>
    <div className="novel-sections">
      <section id="overview" data-novel-section className="novel-major-section">
        <header className="novel-section-heading"><span>01</span><div><h2>Overview</h2><p>Story details, genres, and themes.</p></div></header>
        <div className="novel-content-grid">
          <Card className="novel-about">
            <h2>About this title</h2>
            <p>{detail.synopsis || 'A synopsis is not available in this catalog snapshot.'}</p>
            {detail.associated_names.length > 0 && (detail.associated_names.length <= 4
              ? <div className="novel-aliases"><strong>Alternative titles</strong><ul>{detail.associated_names.map((name) => <li key={name}>{name}</li>)}</ul></div>
              : <details><summary>Alternative titles · {detail.associated_names.length}</summary><ul>{detail.associated_names.map((name) => <li key={name}>{name}</li>)}</ul></details>)}
          </Card>
          <Card className="novel-facets">
            <h2>Genres & themes</h2>
            <CollapsibleFacetList items={detail.genres} compactCount={8} noun="genres" hrefFor={(genre) => browseFacetUrl('genre', genre)} />
            <h3>Tags</h3>
            <CollapsibleFacetList items={detail.tags} compactCount={12} noun="tags" hrefFor={(tag) => browseFacetUrl('tag', tag)} />
          </Card>
        </div>
      </section>
      <section id="insights" data-novel-section className="novel-major-section">
        <header className="novel-section-heading"><span>02</span><div><h2>Insights</h2><p>How this title sits within the current catalog snapshot.</p></div></header>
        <NovelInsightsPanel novelId={novelId} source={source} providedInsights={insights} currentNovel={detail} />
      </section>
      <section id="relationship" data-novel-section className="novel-major-section">
        <header className="novel-section-heading"><span>03</span><div><h2>Relationships</h2><p>Recommendation evidence and related directions to explore.</p></div></header>
        {origin && <RelationshipPanel relationship={relationship} origin={origin} current={detail} />}
        {related.length > 0 && <section className="novel-related">
          <div className="section-heading"><div><span>Continue exploring</span><h2>Related titles</h2></div><a href={`${import.meta.env.BASE_URL}?seed=${novelId}`}>See full recommendations <Search size={15} /></a></div>
          <p className="related-definition">Ranked from the current recommendation candidate pool. Percent match is normalized within this seed’s result set; signal ranks show which evidence channels surfaced each title.</p>
          <div className="novel-related-grid">{related.slice(0, 10).map((item) =>
            <a className="related-novel" key={item.target_id} href={novelPageUrl(item.target_id, novelId)}>
              {item.cover_url ? <img src={item.cover_url} alt="" loading="lazy" /> : <BookMarked />}
              <span><strong>{item.title}</strong><small>{item.author || item.language}</small>
                <span className="related-match"><b>{item.match_score_percent.toFixed(0)}% match</b>{topSignals(item).map((signal) => <em key={signal}>{signal}</em>)}</span>
                <small className="related-reason">{item.evidence_bullets[0] || `${item.shared_tags.length} shared tags`}</small>
              </span>
            </a>)}</div>
        </section>}
        {!origin && <RelationshipPanel relationship={relationship} origin={origin} current={detail} />}
      </section>
    </div>
  </main>;
}

function topSignals(item: Recommendation): string[] {
  return Object.entries(item.channel_ranks)
    .filter(([, rank]) => Number.isFinite(rank))
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([channel]) => CHANNEL_LABELS[channel] || channel.replace(/_rank$/, '').replace(/_/g, ' '));
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
