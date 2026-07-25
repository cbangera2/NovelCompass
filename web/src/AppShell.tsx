import { ReactNode, useEffect, useState } from 'react';
import { BookMarked, BookOpen, Database, Settings, Sparkles, User } from 'lucide-react';
import type { LocalUserProfile } from './profile/types';
import { loadLocalProfile, subscribeLocalProfile } from './profile/store';
import { Badge } from './design-system';
import { defaultHomeUrl } from './preferences';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger
} from './components/ui/sidebar';
import './app-shell.css';
import { useDataModePreference } from './dataModePreference';

export type AppView = 'discover' | 'browse' | 'profile' | 'settings' | 'scraper' | 'novel';

const NAV_ITEMS = [
  { view: 'discover' as const, label: 'Discover', note: 'Find related novels', icon: Sparkles },
  { view: 'browse' as const, label: 'Browse', note: 'Explore the catalog', icon: BookOpen },
  { view: 'settings' as const, label: 'Settings', note: 'Appearance & titles', icon: Settings },
  { view: 'scraper' as const, label: 'Scraper', note: 'Update local data', icon: Database }
];

function viewUrl(view: AppView): string {
  const base = import.meta.env.BASE_URL;
  return view === 'discover' ? `${base}?view=discover` : `${base}?view=${view}`;
}

export default function AppShell({ activeView, children }: { activeView: AppView; children: ReactNode }): JSX.Element {
  const [profile, setProfile] = useState<LocalUserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [homeUrl, setHomeUrl] = useState(defaultHomeUrl);
  const { mode: dataMode } = useDataModePreference();
  const staticDeployment = dataMode === 'static' || window.location.hostname.endsWith('.github.io');
  const navItems = NAV_ITEMS.filter((item) => item.view !== 'scraper' || !staticDeployment);

  useEffect(() => {
    const refreshProfile = () => loadLocalProfile().then(setProfile).catch(() => setProfile(null)).finally(() => setProfileLoaded(true));
    refreshProfile();
    const unsubscribe = subscribeLocalProfile((next) => { setProfile(next); setProfileLoaded(true); });
    window.addEventListener('focus', refreshProfile);
    return () => { unsubscribe(); window.removeEventListener('focus', refreshProfile); };
  }, []);

  useEffect(() => {
    const refreshHome = () => setHomeUrl(defaultHomeUrl());
    window.addEventListener('storage', refreshHome);
    window.addEventListener('novel-navigation-preferences', refreshHome);
    return () => {
      window.removeEventListener('storage', refreshHome);
      window.removeEventListener('novel-navigation-preferences', refreshHome);
    };
  }, []);

  const profileLabel = !profileLoaded ? 'Loading local library…'
    : profile ? `${profile.entries.length.toLocaleString()} saved title${profile.entries.length === 1 ? '' : 's'}`
      : 'Private to this browser';

  return <SidebarProvider>
    <header className="shell-mobile-header">
      <a className="shell-brand compact" href={homeUrl} aria-label="Novel Compass home">
        <span><BookMarked size={18} /></span><strong>Novel Compass</strong>
      </a>
      <div className="shell-mobile-actions">
        <a className="shell-mobile-account" href={viewUrl('profile')}
          aria-label={profile ? `Open local profile for ${profile.username || 'reader'}` : 'Open local profile'}>
          <User size={17} />{profile && <Badge tone="violet">{profile.entries.length}</Badge>}
        </a>
        <SidebarTrigger />
      </div>
    </header>
    <Sidebar>
      <SidebarHeader>
        <a className="shell-brand" href={homeUrl}>
          <span><BookMarked size={21} /></span>
          <div className="sidebar-brand-copy"><strong>Novel Compass</strong><small>Relationship-first discovery</small></div>
        </a>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Explore</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const Icon = item.icon;
              return <SidebarMenuItem key={item.view}>
                <SidebarMenuButton asChild active={activeView === item.view} tooltip={item.label}>
                  <a href={viewUrl(item.view)}><Icon size={18} /><span><strong>{item.label}</strong><small>{item.note}</small></span></a>
                </SidebarMenuButton>
              </SidebarMenuItem>;
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild active={activeView === 'profile'} tooltip="Local profile" className="shell-account">
              <a href={viewUrl('profile')}><span className="shell-avatar"><User size={16} /></span>
                <span><strong>{profile?.username || 'Local profile'}</strong><small>{profileLabel}</small></span></a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset>
      <div className="shell-content">{children}</div>
      <footer className="shell-footer">
        <span>Novel Compass · personal discovery workspace</span>
        <nav aria-label="Footer links">
          <a href={viewUrl('profile')}>Local data</a>
          {!staticDeployment && <a href={viewUrl('scraper')}>Catalog tools</a>}
          <a href="https://github.com/shaido987/novel-dataset" target="_blank" rel="noopener noreferrer">Source dataset</a>
        </nav>
      </footer>
    </SidebarInset>
  </SidebarProvider>;
}
