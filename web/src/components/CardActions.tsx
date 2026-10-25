import type { ReactNode } from 'react';
import { BookOpen, Check, Heart, Sparkles, X } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import { DSButton as Button } from '../design-system';
import { useLocalProfile } from '../profile/useLocalProfile';
import type { FeedbackSignal, NovelRef } from '../profile/cardActions';
import type { ReadingStatus } from '../profile/types';
import { Tooltip } from '../ui';

const STATUS_CHOICES = [
  ['', 'Add'],
  ['reading', 'Reading'],
  ['completed', 'Completed'],
  ['plan_to_read', 'Plan'],
  ['paused', 'Paused'],
  ['dropped', 'Dropped'],
] as const;

export type CardActionsVariant =
  /** Icon buttons over a tile's cover (revealed by NovelCard on hover or focus). */
  | 'tile'
  /** Discover's detailed footer: a "Similar" button, status menu, and love / hide buttons. */
  | 'detailed'
  /** Compact icon footer for Browse's row cards. */
  | 'row';

interface CardActionsProps {
  variant: CardActionsVariant;
  /** The title as stored in the catalog; this is what gets written to the profile. */
  novel: NovelRef;
  /** The title as shown to the user; used in accessible names. */
  label: string;
  /** Find-similar target: a link where the surface navigates, a handler where it reseeds in place. */
  similar?: { href: string } | { onClick: () => void };
  /** Set false to leave out the status and love / hide buttons (e.g. the embedded extension page). */
  profileActions?: boolean;
  datasetVersion?: string;
  /** Extra buttons after the shared ones (Browse adds "Open on <source>"). */
  children?: ReactNode;
}

/**
 * The buttons every title card shares: find similar titles, set a reading status, love a pick,
 * hide picks like it. Status and feedback are written straight to the local profile, so every
 * surface (Discover, Browse, For You) behaves the same and badges follow the profile.
 */
export function CardActions({ variant, novel, label, similar, profileActions = true, datasetVersion, children }: CardActionsProps) {
  const { entries, feedback, setReadingStatus, setFeedback } = useLocalProfile(datasetVersion);
  const status = entries.get(novel.id)?.status;
  const signal = feedback.get(novel.id);
  const iconClass = variant === 'row' ? 'browse-icon-action' : '';
  const report = (error: unknown) => console.error('Could not update your local profile', error);
  const chooseStatus = (next: ReadingStatus | '') => { setReadingStatus(novel, next).catch(report); };
  const choose = (next: FeedbackSignal) => { setFeedback(novel, next).catch(report); };

  const feedbackClass = (selected: boolean) => ['btn-feedback', 'icon-only', iconClass, selected && 'selected'].filter(Boolean).join(' ');

  const similarLabel = `Find titles similar to ${label}`;
  const similarButton = !similar ? null : variant === 'detailed' ? (
    <Button variant="primary" className="card-primary-action" onClick={'onClick' in similar ? similar.onClick : undefined}>
      <Sparkles size={14} aria-hidden="true" /> Similar
    </Button>
  ) : (
    <Tooltip content="Find similar titles">
      {'href' in similar ? (
        <Button as="a" variant="ghost" className={iconClass} href={similar.href} aria-label={similarLabel}>
          <Sparkles size={16} aria-hidden="true" />
        </Button>
      ) : (
        <Button variant="ghost" className={iconClass} aria-label={similarLabel} onClick={similar.onClick}>
          <Sparkles size={variant === 'tile' ? 14 : 16} aria-hidden="true" />
        </Button>
      )}
    </Tooltip>
  );

  const statusMenu = (
    <Menu.Root>
      <Tooltip content="Set reading status">
        <Menu.Trigger className={`card-icon-action ${iconClass}`.trim()} aria-label={`Set reading status for ${label}`}>
          <BookOpen size={16} aria-hidden="true" />
        </Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="reading-menu-positioner">
          <Menu.Popup className="reading-menu">
            {STATUS_CHOICES.map(([value, text]) => (
              <Menu.Item key={value || 'add'} className="reading-menu-item" onClick={() => chooseStatus(value)}>
                <span>{text}</span>
                {(status || '') === value && <Check size={14} aria-hidden="true" />}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );

  const feedbackButtons = (
    <>
      <Tooltip content="Love this recommendation">
        <Button variant="ghost" className={feedbackClass(signal === 'love')}
          aria-label={`Love ${label}`} aria-pressed={signal === 'love'} onClick={() => choose('love')}>
          <Heart size={16} aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content="Hide recommendations like this">
        <Button variant="ghost" className={feedbackClass(signal === 'not_for_me')}
          aria-label={`${label} is not for me`} aria-pressed={signal === 'not_for_me'} onClick={() => choose('not_for_me')}>
          <X size={16} aria-hidden="true" />
        </Button>
      </Tooltip>
    </>
  );

  return (
    <>
      {similarButton}
      {profileActions && statusMenu}
      {profileActions && (variant === 'detailed' ? <div className="card-preference-actions">{feedbackButtons}</div> : feedbackButtons)}
      {children}
    </>
  );
}
