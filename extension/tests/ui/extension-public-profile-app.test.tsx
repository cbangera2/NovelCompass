// @vitest-environment happy-dom

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LivePublicProfilePage } from '../../src/adapters/contracts';
import { ExtensionPublicProfileApp } from '../../src/ui/ExtensionPublicProfileApp';

const page: LivePublicProfilePage = {
  name: 'Fixture Curator',
  rank: 'Reader',
  joinedAt: 'January 2, 2020',
  bio: 'Enjoys thoughtful fantasy.',
  stats: [{ label: 'Lists', value: '1' }],
  navigation: [{ label: 'Profile', url: 'https://www.novelupdates.com/user/42/fixture/' }],
  toolLinks: [{ label: 'Reading List', url: 'https://www.novelupdates.com/reading-list/' }],
  lists: [{
    title: 'Fantasy with sharp edges',
    url: 'https://www.novelupdates.com/viewlist/101/',
    description: 'Stories where choices have consequences.',
    seriesCount: 12,
    tags: [{ label: 'Antihero', url: 'https://www.novelupdates.com/listtag/antihero/' }],
  }],
  warnings: [],
};

afterEach(() => { document.body.innerHTML = ''; });

describe('ExtensionPublicProfileApp', () => {
  it('renders public identity, safe navigation, list details, and Original view', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onShowOriginal = vi.fn();
    await act(async () => root.render(createElement(ExtensionPublicProfileApp, { page, onShowOriginal })));
    expect(host.textContent).toContain('Fixture Curator');
    expect(host.textContent).toContain('Fantasy with sharp edges');
    expect(host.querySelector('a[href="https://www.novelupdates.com/reading-list/"]')).not.toBeNull();
    await act(async () => {
      (Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Original view') as HTMLButtonElement).click();
    });
    expect(onShowOriginal).toHaveBeenCalledOnce();
    root.unmount();
  });
});
