import { ArrowLeft, ArrowRight, BookOpen, Eye, MessageCircle, Star, Users } from 'lucide-react';

import type { LiveRecommendationListsPage } from '../adapters/contracts';
import './extension-recommendation-lists.css';

export interface ExtensionRecommendationListsAppProps {
  page: LiveRecommendationListsPage;
  onShowOriginal: () => void;
}

export function ExtensionRecommendationListsApp({
  page,
  onShowOriginal,
}: ExtensionRecommendationListsAppProps): JSX.Element {
  return (
    <main className="novel-compass-recommendation-lists">
      <header className="extension-list-hero">
        <div>
          <p>{page.kind === 'detail' ? 'Community collection' : 'Novel Updates community'}</p>
          <h1>{page.title}</h1>
          {page.description ? <span>{page.description}</span> : null}
          {page.creator?.url ? (
            <span>
              Curated by <a href={page.creator.url}>{page.creator.label}</a>
            </span>
          ) : null}
        </div>
        <div className="extension-list-actions">
          {page.kind !== 'directory' ? (
            <a href="https://www.novelupdates.com/recommendation-lists/">Browse all lists</a>
          ) : (
            <a href="https://www.novelupdates.com/list-tags/">Explore list tags</a>
          )}
          <button type="button" onClick={onShowOriginal}>Original view</button>
        </div>
      </header>

      {page.kind === 'directory' ? <ListDirectory page={page} /> : null}
      {page.kind === 'detail' ? <ListDetail page={page} /> : null}
      {page.kind === 'tags' ? <TagDirectory page={page} /> : null}
      <Pagination page={page} />
    </main>
  );
}

function ListDirectory({ page }: { page: LiveRecommendationListsPage }): JSX.Element {
  return (
    <section className="extension-list-directory" aria-label="Recommendation lists">
      <div className="extension-list-section-heading">
        <div><p>Discover together</p><h2>Community lists</h2></div>
        <span>Page {page.currentPage}</span>
      </div>
      <div className="extension-list-grid">
        {page.lists.map((list) => (
          <article key={list.url}>
            <div className="extension-list-card-heading">
              {list.avatarUrl ? <img alt="" src={list.avatarUrl} /> : <BookOpen aria-hidden="true" />}
              <div>
                <h3><a href={list.url}>{list.title}</a></h3>
                {list.creator ? (
                  list.creator.url ? <a href={list.creator.url}>{list.creator.label}</a> : <span>{list.creator.label}</span>
                ) : null}
              </div>
            </div>
            {list.description ? <p className="extension-list-description">{list.description}</p> : null}
            {list.tags.length ? (
              <div className="extension-list-tags">
                {list.tags.map((tag) => tag.url ? <a href={tag.url} key={tag.url}>{tag.label}</a> : <span key={tag.label}>{tag.label}</span>)}
              </div>
            ) : null}
            <dl>
              <Metric icon={<BookOpen size={14} />} label="Series" value={list.seriesCount} />
              <Metric icon={<MessageCircle size={14} />} label="Comments" value={list.commentCount} />
              <Metric icon={<Eye size={14} />} label="Views" value={list.viewCount} />
              <Metric icon={<Users size={14} />} label="Follows" value={list.followCount} />
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function ListDetail({ page }: { page: LiveRecommendationListsPage }): JSX.Element {
  return (
    <section className="extension-list-series" aria-label="Novels in this list">
      <div className="extension-list-section-heading">
        <div><p>Curated shelf</p><h2>{page.series.length} novels</h2></div>
      </div>
      <ol>
        {page.series.map((series) => (
          <li key={series.url}>
            <a className="extension-list-cover" href={series.url}>
              {series.coverUrl ? <img alt="" src={series.coverUrl} /> : <BookOpen aria-hidden="true" />}
            </a>
            <article>
              <div className="extension-list-series-title">
                <h3><a href={series.url}>{series.title}</a></h3>
                {series.rating !== undefined ? <span><Star size={14} /> {series.rating.toFixed(1)}</span> : null}
              </div>
              {series.note ? <blockquote>{series.note}</blockquote> : null}
              {series.description ? <p>{series.description}</p> : null}
              <div className="extension-list-tags">
                {series.tags.map((tag) => tag.url ? <a href={tag.url} key={tag.url}>{tag.label}</a> : <span key={tag.label}>{tag.label}</span>)}
              </div>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TagDirectory({ page }: { page: LiveRecommendationListsPage }): JSX.Element {
  return (
    <section className="extension-list-tag-directory" aria-label="Recommendation list tags">
      <div className="extension-list-section-heading"><div><p>Browse a theme</p><h2>List tags</h2></div></div>
      <div className="extension-list-tags">
        {page.tags.map((tag) => <a href={tag.url} key={tag.url}>{tag.label}</a>)}
      </div>
    </section>
  );
}

function Pagination({ page }: { page: LiveRecommendationListsPage }): JSX.Element | null {
  if (!page.pageLinks.length && !page.previousUrl && !page.nextUrl) return null;
  return (
    <nav className="extension-list-pagination" aria-label="Recommendation list pages">
      {page.previousUrl ? <a href={page.previousUrl}><ArrowLeft size={16} /> Previous</a> : <span />}
      <div>
        {page.pageLinks.map((link) => <a aria-current={link.page === page.currentPage ? 'page' : undefined} href={link.url} key={link.page}>{link.page}</a>)}
      </div>
      {page.nextUrl ? <a href={page.nextUrl}>Next <ArrowRight size={16} /></a> : <span />}
    </nav>
  );
}

function Metric({ icon, label, value }: { icon: JSX.Element; label: string; value?: number }): JSX.Element | null {
  if (value === undefined) return null;
  return <div><dt>{icon}{label}</dt><dd>{value.toLocaleString()}</dd></div>;
}
