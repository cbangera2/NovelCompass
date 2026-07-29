import { BookOpen, CalendarDays, Eye, MessageCircle, User, Users } from 'lucide-react';

import type { LivePublicProfilePage } from '../adapters/contracts';
import './extension-public-profile.css';

export interface ExtensionPublicProfileAppProps {
  page: LivePublicProfilePage;
  onShowOriginal: () => void;
}

export function ExtensionPublicProfileApp({
  page,
  onShowOriginal,
}: ExtensionPublicProfileAppProps): JSX.Element {
  return (
    <main className="novel-compass-public-profile">
      <header className="extension-profile-hero">
        <div className="extension-profile-identity">
          <div className="extension-profile-avatar">
            {page.avatarUrl ? <img alt="" src={page.avatarUrl} /> : <User aria-hidden="true" />}
          </div>
          <div>
            <p>Novel Updates member</p>
            <h1>{page.name}</h1>
            <div className="extension-profile-byline">
              {page.rank ? <span>{page.rank}</span> : null}
              {page.joinedAt ? <span><CalendarDays size={14} /> Joined {page.joinedAt}</span> : null}
            </div>
          </div>
        </div>
        <button type="button" onClick={onShowOriginal}>Original view</button>
      </header>

      {page.navigation.length || page.toolLinks.length ? (
        <nav className="extension-profile-navigation" aria-label="Profile navigation">
          {[...page.navigation, ...page.toolLinks].map((link) => (
            <a href={link.url} key={link.url}>{link.label}</a>
          ))}
        </nav>
      ) : null}

      {page.bio ? <section className="extension-profile-bio"><h2>About</h2><p>{page.bio}</p></section> : null}

      {page.stats.length ? (
        <dl className="extension-profile-stats">
          {page.stats.map((stat) => (
            <div key={stat.label}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>
          ))}
        </dl>
      ) : null}

      <section className="extension-profile-lists">
        <div className="extension-profile-section-heading">
          <div><p>Community curation</p><h2>Created lists</h2></div>
          <span>{page.lists.length} public {page.lists.length === 1 ? 'list' : 'lists'}</span>
        </div>
        {page.lists.length ? (
          <div className="extension-profile-list-grid">
            {page.lists.map((list) => (
              <article key={list.url}>
                <div className="extension-profile-list-title">
                  <BookOpen aria-hidden="true" />
                  <h3><a href={list.url}>{list.title}</a></h3>
                </div>
                {list.description ? <p>{list.description}</p> : null}
                {list.tags.length ? (
                  <div className="extension-profile-tags">
                    {list.tags.map((tag) => <a href={tag.url} key={tag.url}>{tag.label}</a>)}
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
        ) : (
          <div className="extension-profile-empty"><BookOpen /><p>No public lists found.</p></div>
        )}
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: JSX.Element; label: string; value?: number }) {
  return value === undefined ? null : <div><dt>{icon}{label}</dt><dd>{value.toLocaleString()}</dd></div>;
}
