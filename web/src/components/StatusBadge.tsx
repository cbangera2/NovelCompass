import type { ReadingStatus } from '../profile/types';
import './novel-card.css';

export const READING_STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  completed: 'Completed',
  plan_to_read: 'Plan to read',
  dropped: 'Dropped',
  paused: 'Paused',
};

/** Library status of a title. `overlay` sits on a cover; `pill` sits in a badge row. */
export function StatusBadge({
  status,
  rating,
  variant = 'pill',
}: {
  status: ReadingStatus;
  rating?: number;
  variant?: 'pill' | 'overlay';
}) {
  return (
    <span className={`status-badge status-badge-${variant} status-${status}`}>
      {READING_STATUS_LABELS[status] ?? 'In library'}
      {rating ? ` · ${rating}★` : ''}
    </span>
  );
}
