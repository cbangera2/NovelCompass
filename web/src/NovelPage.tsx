import { Tabs } from '@base-ui/react/tabs';
import {
  ArrowLeft, BookMarked, BookOpen, Check, ExternalLink, Heart, Library,
  MessageSquare, Search, Sparkles, ThumbsDown
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createDataSource, RecommendationDataSource } from './data';
import { Badge, Card, DSButton, Skeleton } from './design-system';
import { browseFacetUrl } from './metadataLinks';
import { NovelInsightsPanel } from './NovelInsightsPanel';
import { loadLocalProfile, saveLocalProfile } from './profile/store';
import { LocalNovelFeedback, LocalUserProfile } from './profile/types';
import { displayNovelTitle, useDisplaySettings } from './settings';
import { NovelDetail, Recommendation } from './types';
import { novelPageUrl } from './novelLinks';
import './novel-page.css';

const CHANNEL_LABELS: Record<string, string> = {
  vector_rank: 'Meaning', tag_rank: 'Tags', direct_rec_rank: 'Reader recs',
  rec_list_rank: 'Curated lists', structural_rank: 'Catalog structure'
};

export default function NovelPage(): JSX.Element {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const novelId = Number(params.get('id'));
  const fromId = Number(params.get('from')) || undefined;
  const { settings } = useDisplaySettings();
  const [source, setSource] = useState<RecommendationDataSource | null>(null);
  const [detail, setDetail] = useState<NovelDetail | null>(null);
  const [origin, setOrigin] = useState<NovelDetail | null>(null);
  const [relationship, setRelationship] = useState<Recommendation | null>(null);
  const [related, setRelated] = useState<Recommendation[]>([]);
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!Number.isInteger(novelId) || novelId <= 0) {
      setError('This novel link is missing a valid catalog ID.');
      return;
    }
    Promise.all([createDataSource(), loadLocalProfile().catch(() => null)])
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
        await Promise.all([relatedRequest, relationshipRequest]);
      })
      .catch((reason) => !cancelled && setError(reason.message || 'Could not load this novel.'));
    return () => { cancelled = true; };
  }, [fromId, novelId]);

  const currentFeedback = profile?.feedback?.find((item) => item.novel_id === novelId)?.signal;
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

  if (error) return <main className="novel-page-state"><Card><BookOpen /><h1>Novel unavailable</h1><p>{error}</p><DSButton as="a" href={import.meta.env.BASE_URL}>Return to Discover</DSButton></Card></main>;
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
        <div className="novel-eyebrow"><Badge>Novel</Badge>{detail.status_trans && <span>{detail.status_trans}</span>}</div>
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
        <div className="novel-actions">
          <DSButton as="a" variant="primary" href={`${import.meta.env.BASE_URL}?seed=${novelId}`}><Sparkles size={17} />Find similar</DSButton>
          <DSButton as="a" variant="outline" href={detail.novelupdates_url} target="_blank" rel="noopener noreferrer">Novel Updates <ExternalLink size={15} /></DSButton>
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
      </div>
    </section>

    <Tabs.Root className="novel-tabs" defaultValue={fromId ? 'relationship' : 'overview'}>
      <Tabs.List className="novel-tab-list" aria-label="Novel information">
        <Tabs.Tab value="overview"><BookOpen size={16} />Overview</Tabs.Tab>
        <Tabs.Tab value="insights"><Library size={16} />Insights</Tabs.Tab>
        <Tabs.Tab value="relationship"><MessageSquare size={16} />Relationships</Tabs.Tab>
        <Tabs.Indicator className="novel-tab-indicator" />
      </Tabs.List>
      <Tabs.Panel value="overview" className="novel-tab-panel">
        <div className="novel-content-grid">
          <Card className="novel-about">
            <h2>About this novel</h2>
            <p>{detail.synopsis || 'A synopsis is not available in this catalog snapshot.'}</p>
            {detail.associated_names.length > 0 && <details><summary>Alternative titles</summary><ul>{detail.associated_names.map((name) => <li key={name}>{name}</li>)}</ul></details>}
          </Card>
          <Card className="novel-facets">
            <h2>Genres & themes</h2>
            <div>{detail.genres.map((genre) => <a key={genre} href={browseFacetUrl('genre', genre)}>{genre}</a>)}</div>
            <h3>Tags</h3>
            <div>{detail.tags.map((tag) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>)}</div>
          </Card>
        </div>
      </Tabs.Panel>
      <Tabs.Panel value="insights" className="novel-tab-panel">
        <NovelInsightsPanel novelId={novelId} source={source}
          onPeer={(peerId) => { window.location.href = novelPageUrl(peerId, novelId); }} />
      </Tabs.Panel>
      <Tabs.Panel value="relationship" className="novel-tab-panel">
        <RelationshipPanel relationship={relationship} origin={origin} current={detail} />
        {related.length > 0 && <section className="novel-related">
          <div className="section-heading"><div><span>Continue exploring</span><h2>Related novels</h2></div><a href={`${import.meta.env.BASE_URL}?seed=${novelId}`}>See full recommendations <Search size={15} /></a></div>
          <div className="novel-related-grid">{related.slice(0, 8).map((item) =>
            <a className="related-novel" key={item.target_id} href={novelPageUrl(item.target_id, novelId)}>
              {item.cover_url ? <img src={item.cover_url} alt="" loading="lazy" /> : <BookMarked />}
              <span><strong>{item.title}</strong><small>{item.author || item.language}</small><b>{item.match_score_percent.toFixed(0)}% match</b></span>
            </a>)}</div>
        </section>}
      </Tabs.Panel>
    </Tabs.Root>
  </main>;
}

function RelationshipPanel({ relationship, origin, current }: {
  relationship: Recommendation | null; origin: NovelDetail | null; current: NovelDetail;
}) {
  if (!origin) return <Card className="relationship-empty"><Sparkles /><h2>Why does this novel connect?</h2><p>Open this title from a recommendation to see the exact evidence connecting it to your starting novel.</p><DSButton as="a" href={`${import.meta.env.BASE_URL}?seed=${current.id}`}>Use as a starting point</DSButton></Card>;
  if (!relationship) return <Card className="relationship-empty"><h2>Relationship to {origin.title}</h2><p>This title is outside the saved candidate pool, so detailed ranking evidence is not available.</p></Card>;
  const ranks = Object.entries(relationship.channel_ranks).filter(([, rank]) => Number.isFinite(rank));
  const maxRank = Math.max(1, ...ranks.map(([, rank]) => rank));
  return <Card className="relationship-card">
    <div className="relationship-heading"><div><span>Recommendation evidence</span><h2>{origin.title} <span>→</span> {current.title}</h2></div><strong>{relationship.match_score_percent.toFixed(0)}%<small>match</small></strong></div>
    <div className="relationship-layout">
      <div><h3>Why it surfaced</h3><ul>{relationship.evidence_bullets.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul>
        {relationship.shared_tags.length > 0 && <div className="shared-facets">{relationship.shared_tags.slice(0, 12).map((tag) => <a key={tag} href={browseFacetUrl('tag', tag)}>{tag}</a>)}</div>}</div>
      <div className="rank-chart"><h3>Signal strength</h3><p>Lower rank means this signal connected the novels more strongly.</p>{ranks.map(([channel, rank]) =>
        <div key={channel}><span>{CHANNEL_LABELS[channel] || channel.replace(/_/g, ' ')}</span><div><i style={{ width: `${Math.max(8, 100 - ((rank - 1) / maxRank) * 88)}%` }} /></div><b>#{rank}</b></div>)}</div>
    </div>
  </Card>;
}
