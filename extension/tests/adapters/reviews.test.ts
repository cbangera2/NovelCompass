// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import reviewsFixture from '../fixtures/reviews-truncated.html?raw';
import noReviewsFixture from '../fixtures/series-no-reviews.html?raw';
import { OpaqueActionRegistry } from '../../src/adapters/action-registry';
import { normalizeReviewBody, parseReviewPage } from '../../src/adapters/reviews';

function fixtureDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const pageUrl = 'https://www.novelupdates.com/series/fixture-truncated-review/';

describe('parseReviewPage', () => {
  it('normalizes review metadata, safe content blocks, sort state, and capabilities', () => {
    const document = fixtureDocument(reviewsFixture);
    const result = parseReviewPage(document, pageUrl, new OpaqueActionRegistry());

    expect(result.page).toMatchObject({
      total: 12,
      order: 'likes',
      loginRequired: true,
    });
    expect(result.page.sortActionIds).toEqual({
      likes: expect.any(String),
      date: expect.any(String),
    });
    expect(result.page.writeReviewActionId).toEqual(expect.any(String));
    expect(result.page.rows).toHaveLength(1);
    expect(result.page.rows[0]).toEqual({
      actionIds: {
        expand: expect.any(String),
        like: expect.any(String),
        report: expect.any(String),
      },
      permalink: 'https://www.novelupdates.com/series/fixture-truncated-review/#review-77',
      reviewer: {
        label: 'Fixture Reviewer',
        url: 'https://www.novelupdates.com/user/fixture-reviewer/',
      },
      reviewerAvatarUrl: 'https://cdn.example.test/avatar.png',
      rating: 4.5,
      postedAtLabel: '2026-01-04',
      postedAtIso: '2026-01-04',
      progressLabel: 'c30',
      body: [
        { type: 'paragraph', text: 'A synthetic truncated review.' },
        { type: 'quote', text: 'A safe quoted thought.' },
        { type: 'list', items: ['Strong opening', 'Clear action'] },
      ],
      isTruncated: true,
      likeCount: 1234,
    });
    expect(JSON.stringify(result.page)).not.toContain('window.fixtureUnsafe');
    expect(JSON.stringify(result.page)).not.toContain('<');
  });

  it('delegates controls through opaque handles and invalidates old generations', () => {
    const document = fixtureDocument(reviewsFixture);
    const like = document.querySelector<HTMLElement>('[data-review-like]')!;
    Object.defineProperty(like, 'isConnected', { value: true });
    const click = vi.spyOn(like, 'click');
    const registry = new OpaqueActionRegistry();
    const first = parseReviewPage(document, pageUrl, registry);
    const likeAction = first.page.rows[0]!.actionIds.like!;

    expect(registry.invoke(likeAction)).toEqual({ kind: 'delegated' });
    expect(click).toHaveBeenCalledOnce();
    expect(registry.invoke(first.page.rows[0]!.actionIds.report!)).toEqual({
      kind: 'navigate',
      url: 'https://www.novelupdates.com/report/review/77/',
    });

    parseReviewPage(document, pageUrl, registry);
    expect(registry.invoke(likeAction)).toEqual({ kind: 'unavailable' });
  });

  it('returns an explicit empty page and fails closed for an untrusted page URL', () => {
    const noReviews = fixtureDocument(noReviewsFixture);
    const registry = new OpaqueActionRegistry();
    expect(parseReviewPage(noReviews, pageUrl, registry).page).toEqual({
      rows: [],
      order: 'unknown',
      sortActionIds: {},
      loginRequired: false,
    });
    expect(parseReviewPage(noReviews, 'https://evil.test/series/example/', registry).page).toEqual({
      rows: [],
      order: 'unknown',
      sortActionIds: {},
      loginRequired: false,
    });
  });

  it('discards cross-origin reviewer, permalink, and action URLs', () => {
    const document = fixtureDocument(reviewsFixture);
    document
      .querySelector<HTMLElement>('[data-reviewer]')!
      .setAttribute('href', 'https://evil.test/user/fixture-reviewer/');
    document
      .querySelector<HTMLElement>('[data-review-permalink]')!
      .setAttribute('href', 'https://evil.test/review/77/');
    document
      .querySelector<HTMLElement>('[data-review-report]')!
      .setAttribute('href', 'https://evil.test/report/77/');

    const review = parseReviewPage(document, pageUrl, new OpaqueActionRegistry()).page.rows[0]!;
    expect(review.reviewer).toEqual({ label: 'Fixture Reviewer' });
    expect(review.permalink).toBeUndefined();
    expect(review.actionIds.report).toBeUndefined();
  });

  it('parses the current live w-comments wrapper and metadata layout', () => {
    const document = fixtureDocument(`
      <div id="comments" class="w-comments has_form">
        <div class="w-comments-list">
          <div class="w-comments-item" id="comment-575070">
            <div class="w-comments-item-meta-new">
              <table><tbody><tr>
                <td><a href="/user/9615/Sephi/">Sephi</a> rated it
                  <i class="fa fa-star"></i><i class="fa fa-star"></i>
                  <i class="fa fa-star"></i><i class="fa fa-star"></i>
                  <i class="fa fa-star"></i>
                </td>
                <td><div>June 2, 2026</div><div>Status: <span id="stat575070">c30</span></div></td>
              </tr></tbody></table>
            </div>
            <div class="w-comments-item-text"><p>A live-shaped review body.</p></div>
          </div>
        </div>
      </div>
    `);

    const review = parseReviewPage(document, pageUrl, new OpaqueActionRegistry()).page.rows[0];
    expect(review).toMatchObject({
      reviewer: {
        label: 'Sephi',
        url: 'https://www.novelupdates.com/user/9615/Sephi/',
      },
      rating: 5,
      postedAtLabel: 'June 2, 2026',
      postedAtIso: '2026-06-02',
      progressLabel: 'c30',
      body: [{ type: 'paragraph', text: 'A live-shaped review body.' }],
    });
  });
});

describe('normalizeReviewBody', () => {
  it('falls back to one sanitized paragraph for legacy unstructured bodies', () => {
    const document = fixtureDocument(
      '<div id="body">Plain <b>review</b><button>Like</button><script>bad()</script></div>',
    );
    expect(normalizeReviewBody(document.querySelector<HTMLElement>('#body')!)).toEqual([
      { type: 'paragraph', text: 'Plain review' },
    ]);
  });
});
