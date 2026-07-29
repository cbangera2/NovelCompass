// @vitest-environment happy-dom

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  LiveReleasePage,
  LiveReviewPage,
  LiveSeriesMetadata,
} from '../../src/adapters/contracts';
import { ExtensionSeriesApp } from '../../src/ui/ExtensionSeriesApp';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('ExtensionSeriesApp', () => {
  it('renders the series hero and useful overview metadata', () => {
    renderApp();

    expect(container.querySelector('h1')?.textContent).toBe('Fixture Mercenary');
    expect(container.textContent).toContain('A mercenary returns to his youth.');
    expect(container.textContent).toContain('1,234');
    expect(container.textContent).toContain('Regression');
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://www.novelupdates.com/stag/regression/"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      'Overview',
    );
  });

  it('renders actionable and unavailable chapter states without inventing account actions', () => {
    const onInvokeAction = vi.fn();
    renderApp({ onInvokeAction });
    selectTab('Chapters');

    const chapterButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.chapter-list > li > button'),
    );
    expect(chapterButtons).toHaveLength(2);
    expect(chapterButtons[0]?.disabled).toBe(false);
    expect(chapterButtons[1]?.disabled).toBe(true);

    act(() => chapterButtons[0]?.click());
    expect(onInvokeAction).toHaveBeenCalledWith('release:1');
    expect(container.textContent).toContain('Open the original view to use this chapter link.');
    expect(container.textContent).not.toContain('Add to reading list');
    expect(container.textContent).not.toContain('Rate this novel');
  });

  it('renders normalized review blocks and delegates only exposed actions', () => {
    const onInvokeAction = vi.fn();
    renderApp({
      onInvokeAction,
      reviews: { status: 'ready', data: reviews() },
    });
    selectTab('Reviews');

    expect(container.textContent).toContain('Fixture Reviewer');
    expect(container.textContent).toContain('A safe paragraph.');
    expect(container.querySelector('blockquote')?.textContent).toBe('A safe quote.');
    expect(container.textContent).toContain(
      'Log in through Novel Updates to write or interact with reviews.',
    );

    const like = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Like',
    );
    act(() => like?.click());
    expect(onInvokeAction).toHaveBeenCalledWith('review-like:1');
    expect(container.textContent).not.toContain('Report');
  });

  it('keeps recommendation failures isolated from live series content', () => {
    renderApp({
      similar: {
        status: 'unavailable',
        message: 'The recommendation snapshot is offline.',
      },
    });
    selectTab('Similar');

    expect(container.textContent).toContain('The recommendation snapshot is offline.');
    expect(container.textContent).toContain('Live Novel Updates chapters and metadata still work.');
    expect(container.querySelector('.series-hero h1')?.textContent).toBe('Fixture Mercenary');
  });

  it('navigates recommendation cards through the supplied extension handler', () => {
    const onNavigate = vi.fn();
    renderApp({
      onNavigate,
      similar: {
        status: 'ready',
        data: [
          {
            id: '101',
            title: 'A Similar Fixture',
            url: 'https://www.novelupdates.com/series/a-similar-fixture/',
            score: 0.86,
            reason: 'Shared progression and setting.',
          },
        ],
      },
    });
    selectTab('Similar');

    const viewButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'View on Novel Updates',
    );
    act(() => viewButton?.click());
    expect(onNavigate).toHaveBeenCalledWith(
      'https://www.novelupdates.com/series/a-similar-fixture/',
    );
  });
});

function renderApp(overrides: Partial<ComponentProps<typeof ExtensionSeriesApp>> = {}): void {
  act(() => {
    root.render(
      <ExtensionSeriesApp
        metadata={metadata()}
        releases={releases()}
        onInvokeAction={() => undefined}
        onNavigate={() => undefined}
        {...overrides}
      />,
    );
  });
}

function selectTab(label: string): void {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (candidate) => candidate.textContent?.startsWith(label),
  );
  act(() => tab?.click());
}

function metadata(): LiveSeriesMetadata {
  return {
    identity: {
      pageType: 'series',
      url: 'https://www.novelupdates.com/series/fixture-mercenary/',
      slug: 'fixture-mercenary',
      parserVersion: 1,
      confidence: 'high',
      resolutionSource: 'current-url',
    },
    title: 'Fixture Mercenary',
    description: 'A mercenary returns to his youth.',
    associatedNames: ['Fixture Regressor'],
    authors: [{ label: 'Fixture Author' }],
    artists: [],
    genres: [{ label: 'Action' }, { label: 'Fantasy' }],
    tags: [
      { label: 'Regression', url: 'https://www.novelupdates.com/stag/regression/' },
      { label: 'Mercenaries' },
    ],
    language: { label: 'Korean' },
    novelType: { label: 'Web Novel' },
    year: 2024,
    originalStatus: '312 Chapters (Complete)',
    translationStatus: 'Ongoing',
    publishers: { original: [], english: [] },
    rating: { average: 4.3, voteCount: 120 },
    rankings: {
      activity: { weekly: 12 },
      readingList: { allTime: 90 },
      readingListCount: 1234,
    },
    recommendationLists: [],
    warnings: [],
  };
}

function releases(): LiveReleasePage {
  return {
    currentPage: 1,
    pageLinks: [],
    groupFilterAvailable: false,
    rows: [
      {
        actionId: 'release:1',
        dateLabel: '01/03/26',
        dateIso: '2026-01-03',
        group: { label: 'Fixture Group' },
        chapterLabel: 'c12',
        isActionAvailable: true,
      },
      {
        actionId: '',
        dateLabel: '01/02/26',
        group: { label: 'Unavailable Group' },
        chapterLabel: 'c11',
        isActionAvailable: false,
      },
    ],
  };
}

function reviews(): LiveReviewPage {
  return {
    total: 1,
    order: 'likes',
    loginRequired: true,
    sortActionIds: {},
    rows: [
      {
        actionIds: { like: 'review-like:1' },
        reviewer: { label: 'Fixture Reviewer' },
        rating: 4,
        postedAtLabel: 'January 3, 2026',
        body: [
          { type: 'paragraph', text: 'A safe paragraph.' },
          { type: 'quote', text: 'A safe quote.' },
        ],
        isTruncated: false,
        likeCount: 8,
      },
    ],
  };
}
