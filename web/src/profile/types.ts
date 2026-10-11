export type ReadingStatus = 'reading' | 'completed' | 'plan_to_read' | 'dropped' | 'paused';

export type ProfileMediaKind = 'anime' | 'manga' | 'novel';

export interface ProfileEntry {
  novel_id?: number;
  slug: string;
  imported_title: string;
  status: ReadingStatus;
  rating?: number;
  progress?: string;
  /** Numeric chapters/episodes parsed from progress for stats. */
  progress_units?: number;
  /** Coarse media kind for AniList-style overview filtering. */
  media_kind?: ProfileMediaKind;
  /** ISO date (YYYY-MM-DD) when the user started the title, if known. */
  started_on?: string;
  /** ISO date (YYYY-MM-DD) when the user finished the title, if known. */
  finished_on?: string;
  source_file: string;
}

export interface CuratedListSummary {
  id: number;
  title: string;
  description?: string;
  series_count?: number;
  followers?: number;
  is_private?: boolean;
  membership_available: boolean;
}

export type ListSignal = 'favorites' | 'mixed' | 'to_read';

export interface ListMember {
  slug: string;
  imported_title: string;
  novel_id?: number;
}

/** A user's own recommendation list with imported membership (from saved list pages). */
export interface ListMembership {
  list_id: number;
  title: string;
  signal: ListSignal;
  members: ListMember[];
  source_file: string;
}

export interface LocalUserProfile {
  profile_id: string;
  parser_version: number;
  dataset_version: string;
  username?: string;
  imported_at: string;
  source_fingerprints: string[];
  entries: ProfileEntry[];
  curated_lists: CuratedListSummary[];
  /** Imported contents of the user's own lists (favorites seed ranking). */
  list_membership?: ListMembership[];
  feedback?: LocalNovelFeedback[];
  /** Manual taste adjustments (pins/mutes). Optional: absent = purely inferred. */
  taste_overrides?: TasteOverrides;
}

export type TasteOverrideKind = 'tag' | 'genre';

export interface TastePin {
  /** Display name as typed by the user. Matched case-insensitively. */
  name: string;
  kind: TasteOverrideKind;
}

export interface TasteOverrides {
  /** Pinned likes: strong soft-boost in affinity (PIN_LIKE_WEIGHT). */
  likes: TastePin[];
  /** Pinned avoids: strong soft-penalty in affinity (PIN_AVOID_WEIGHT). */
  avoids: TastePin[];
  /** Ignored in affinity entirely (but still shown in the inferred lists). */
  muted: TastePin[];
}

export interface LocalNovelFeedback {
  novel_id: number;
  slug: string;
  title: string;
  signal: 'love' | 'read' | 'not_for_me';
  updated_at: string;
}

export interface ParsedProfileFile {
  filename: string;
  fingerprint: string;
  detected_status: ReadingStatus;
  selected_status: ReadingStatus;
  username?: string;
  entries: ProfileEntry[];
  curated_lists: CuratedListSummary[];
  malformed_rows: number;
  duplicate_slugs: string[];
  warnings: string[];
}

export interface ParsedListFile {
  filename: string;
  fingerprint: string;
  list_id: number;
  title: string;
  detected_signal: ListSignal;
  selected_signal: ListSignal;
  members: Array<{ slug: string; imported_title: string; position: number; novel_id?: number }>;
  duplicate_slugs: string[];
  warnings: string[];
}

export interface ImportPreview {
  files: ParsedProfileFile[];
  entries: ProfileEntry[];
  curated_lists: CuratedListSummary[];
  matched: number;
  unmatched: number;
  duplicate_slugs: string[];
  conflicts: string[];
  warnings: string[];
  missing_statuses: ReadingStatus[];
}
