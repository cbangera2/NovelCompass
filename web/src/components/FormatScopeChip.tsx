import { useEffect, useRef, useState } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { useMediaFilterState, type MediaTypeChoice } from '../mediaFilterState';
import './format-scope-chip.css';

const CHOICES: Array<{ type: MediaTypeChoice; label: string; short: string }> = [
  { type: 'novel', label: 'Light Novels', short: 'Novels' },
  { type: 'manga', label: 'Manga & Comics', short: 'Manga' },
  { type: 'anime', label: 'Anime & Series', short: 'Anime' },
];

/**
 * Page-header chip shown only while a format toggle is off, so the silent
 * Novels/Manga/Anime scope is visible on every page it affects. Clicking opens
 * the toggles plus a reset.
 */
export function FormatScopeChip(): JSX.Element | null {
  const { selectedTypes, isAllSelected, isSelected, toggleType, setTypes } = useMediaFilterState();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (isAllSelected) return null;

  const shorts = CHOICES.filter((c) => selectedTypes.includes(c.type)).map((c) => c.short);
  const label = shorts.length === 1 ? `${shorts[0]} only` : shorts.join(' + ');

  return (
    <div className="format-chip-root" ref={rootRef}>
      <button
        type="button"
        className="format-chip"
        aria-expanded={open}
        aria-haspopup="true"
        title="Formats are filtered across search, browse and recommendations. Click to change."
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={13} aria-hidden="true" />
        {label}
      </button>
      {open && (
        <div className="format-chip-popover" role="group" aria-label="Formats">
          {CHOICES.map(({ type, label: choiceLabel }) => {
            const on = isSelected(type);
            return (
              <button
                key={type}
                type="button"
                className={`format-chip-option${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleType(type)}
              >
                <span className="format-chip-check" aria-hidden="true">{on && <Check size={11} strokeWidth={3} />}</span>
                {choiceLabel}
              </button>
            );
          })}
          <button
            type="button"
            className="format-chip-reset"
            onClick={() => {
              setTypes(['novel', 'manga', 'anime']);
              setOpen(false);
            }}
          >
            Show all formats
          </button>
        </div>
      )}
    </div>
  );
}
