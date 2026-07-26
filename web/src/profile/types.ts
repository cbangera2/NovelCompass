export type ReadingStatus = 'reading' | 'completed' | 'plan_to_read' | 'dropped' | 'paused';

export interface ProfileEntry {
  novel_id?: number;
  slug: string;
  imported_title: string;
  status: ReadingStatus;
  rating?: number;
  progress?: string;
  source_file: string;
}

export interface CuratedListSummary {
  id: number;
  title: string;
  description?: string;
  series_count?: number;
  followers?: number;
  is_private?: boolean;
  membership_available: false;
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
  feedback?: LocalNovelFeedback[];
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
