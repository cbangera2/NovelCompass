/**
 * Normalized, UI-facing contracts for Novel Updates pages.
 *
 * Adapters must treat source-page content as untrusted. These records therefore
 * contain only plain text, validated URLs, and opaque action IDs; raw HTML,
 * selectors, and inline handlers do not belong in this boundary.
 */

export const NOVEL_UPDATES_PARSER_VERSION = 1;

export type SupportedPageType = 'series' | 'series-finder' | 'series-ranking';

export type IdentityConfidence = 'high' | 'medium' | 'low';

export type IdentityResolutionSource =
  | 'canonical-url'
  | 'current-url'
  | 'numeric-id'
  | 'catalog-slug'
  | 'normalized-title'
  | 'exact-route';

export interface NovelUpdatesPageIdentity {
  pageType: SupportedPageType;
  url: string;
  canonicalUrl?: string;
  slug?: string;
  novelUpdatesId?: number;
  parserVersion: number;
  confidence: IdentityConfidence;
  resolutionSource: IdentityResolutionSource;
}

export interface LinkedLabel {
  label: string;
  url?: string;
}

export type ParseWarningCode =
  | 'missing-optional-section'
  | 'invalid-url'
  | 'malformed-value'
  | 'identity-mismatch'
  | 'unsupported-markup';

export interface ParseWarning {
  code: ParseWarningCode;
  field?: string;
  message: string;
}

export interface LiveRating {
  average?: number;
  voteCount?: number;
  distribution?: Array<{
    stars: number;
    count?: number;
    percentage?: number;
  }>;
}

export interface LiveRankSet {
  weekly?: number;
  monthly?: number;
  allTime?: number;
}

export interface LiveRankings {
  activity?: LiveRankSet;
  readingList?: LiveRankSet;
  readingListCount?: number;
}

export interface LiveRelease {
  actionId: string;
  dateLabel: string;
  dateIso?: string;
  group: LinkedLabel;
  chapterLabel: string;
  volumeLabel?: string;
  isActionAvailable: boolean;
}

export interface LiveReleasePage {
  rows: LiveRelease[];
  currentPage: number;
  pageLinks: Array<{ page: number; url: string }>;
  previousUrl?: string;
  nextUrl?: string;
  groupFilterAvailable: boolean;
}

export type ReviewContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'list'; items: string[] };

export interface LiveReview {
  actionIds: {
    expand?: string;
    like?: string;
    report?: string;
  };
  permalink?: string;
  reviewer: LinkedLabel;
  reviewerAvatarUrl?: string;
  rating?: number;
  postedAtLabel: string;
  postedAtIso?: string;
  progressLabel?: string;
  body: ReviewContentBlock[];
  isTruncated: boolean;
  likeCount?: number;
}

export interface LiveReviewPage {
  rows: LiveReview[];
  total?: number;
  order: 'likes' | 'date' | 'unknown';
  sortActionIds: {
    likes?: string;
    date?: string;
  };
  writeReviewActionId?: string;
  loginRequired: boolean;
}

export interface SeriesPageCapabilities {
  canOpenChapters: boolean;
  canFilterReleaseGroups: boolean;
  canUseReadingList: boolean;
  canRate: boolean;
  canLikeReviews: boolean;
  canReportReviews: boolean;
  canWriteReview: boolean;
  isLoggedIn: boolean | 'unknown';
}

export type NovelUpdatesAccountState =
  | {
      status: 'logged-in';
      username: string;
      avatarUrl?: string;
      profileUrl?: string;
      accountUrl?: string;
      followingUrl?: string;
      alertsUrl?: string;
      alertCount?: number;
      messagesUrl?: string;
      logoutActionId?: string;
    }
  | {
      status: 'logged-out';
      loginUrl?: string;
      registerUrl?: string;
    }
  | {
      status: 'unknown';
      warnings: ParseWarning[];
    };

export interface LiveSeriesMetadata {
  identity: NovelUpdatesPageIdentity;
  title: string;
  coverUrl?: string;
  description?: string;
  associatedNames: string[];
  authors: LinkedLabel[];
  artists: LinkedLabel[];
  genres: LinkedLabel[];
  tags: LinkedLabel[];
  language?: LinkedLabel;
  novelType?: LinkedLabel;
  year?: number;
  originalStatus?: string;
  translationStatus?: string;
  licensed?: boolean;
  completelyTranslated?: boolean;
  publishers: {
    original: LinkedLabel[];
    english: LinkedLabel[];
  };
  releaseFrequency?: string;
  rating?: LiveRating;
  rankings?: LiveRankings;
  recommendationLists: LinkedLabel[];
  warnings: ParseWarning[];
}

export interface LiveSeriesSnapshot extends LiveSeriesMetadata {
  releases: LiveReleasePage;
  reviews: LiveReviewPage;
  capabilities: SeriesPageCapabilities;
}

export interface RankingFilterOption {
  label: string;
  value: string;
  selected: boolean;
}

export interface RankingFilters {
  rankingTypes: RankingFilterOption[];
  languages: RankingFilterOption[];
  storyStatuses: RankingFilterOption[];
  genres: Array<RankingFilterOption & { excluded: boolean }>;
  minimumChapters?: number;
}

export interface LiveRankingRow {
  rank: number;
  title: string;
  seriesUrl: string;
  coverUrl?: string;
  language?: string;
  rating?: number;
  chapterCount?: number;
  releaseFrequency?: string;
  readerCount?: number;
  reviewCount?: number;
  lastUpdated?: string;
  description?: string;
  genres: LinkedLabel[];
}

export interface LiveRankingPage {
  title: string;
  activeRankingLabel?: string;
  filters: RankingFilters;
  rows: LiveRankingRow[];
  currentPage: number;
  pageLinks: Array<{ page: number; url: string }>;
  previousUrl?: string;
  nextUrl?: string;
  warnings: ParseWarning[];
}

export type ReplacementBlockReason =
  | 'invalid-url'
  | 'wrong-origin'
  | 'insecure-origin'
  | 'login-page'
  | 'challenge-page'
  | 'maintenance-page'
  | 'non-html-document'
  | 'pass-through-route'
  | 'replacement-not-implemented'
  | 'unsupported-markup'
  | 'unsupported-route'
  | 'invalid-series-slug';

export type PageClassification =
  | {
      kind: 'supported';
      identity: NovelUpdatesPageIdentity;
    }
  | {
      kind: 'blocked';
      reason: ReplacementBlockReason;
      url?: string;
      route?: import('./route-registry').NovelUpdatesRouteMatch;
    };
