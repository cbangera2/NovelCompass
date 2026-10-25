import { Star } from 'lucide-react';
import './novel-card.css';

/** One rating format everywhere: always one decimal, an em dash when unrated. */
export function formatRating(rating?: number | null): string {
  return rating && rating > 0 ? rating.toFixed(1) : '—';
}

/**
 * The amber star + rating used on every card. `overlay` sits on a cover gradient, `pill` is a
 * bordered badge, `plain` is inline text.
 */
export function RatingChip({
  rating,
  votes,
  showVotes = true,
  variant = 'plain',
  size = 13,
  hint = true,
  className = '',
}: {
  rating?: number | null;
  votes?: number | null;
  showVotes?: boolean;
  variant?: 'plain' | 'pill' | 'overlay';
  size?: number;
  /** Native tooltip with the vote count. Turn off inside cards, where the hover card is the one tooltip. */
  hint?: boolean;
  className?: string;
}) {
  const hasVotes = votes != null && votes > 0;
  return (
    <span
      className={`rating-chip rating-chip-${variant} ${className}`.trim()}
      title={hint ? (hasVotes ? `${votes.toLocaleString()} rating votes` : 'Rating') : undefined}
    >
      <Star size={size} fill="currentColor" aria-hidden="true" />
      <b>{formatRating(rating)}</b>
      {showVotes && hasVotes && <small>({votes.toLocaleString()})</small>}
    </span>
  );
}
