import { LayoutGrid, LayoutList } from 'lucide-react';
import { DSButton } from '../design-system';
import { Tooltip } from '../ui';
import type { ResultLayout } from '../preferences';

/** Compact posters ↔ detailed cards, shared by Browse and Discover. */
export function ResultLayoutToggle({ value, onChange }: { value: ResultLayout; onChange: (layout: ResultLayout) => void }) {
  return (
    <div className="result-layout-toggle" role="group" aria-label="Result layout">
      <Tooltip content="Compact posters: rating, status and match on the cover. Hover for the synopsis.">
        <DSButton
          variant={value === 'compact' ? 'primary' : 'ghost'}
          aria-label="Compact posters"
          aria-pressed={value === 'compact'}
          onClick={() => onChange('compact')}
        >
          <LayoutGrid size={16} aria-hidden="true" />
        </DSButton>
      </Tooltip>
      <Tooltip content="Detailed cards: author, genres or match evidence, and actions">
        <DSButton
          variant={value === 'detailed' ? 'primary' : 'ghost'}
          aria-label="Detailed cards"
          aria-pressed={value === 'detailed'}
          onClick={() => onChange('detailed')}
        >
          <LayoutList size={16} aria-hidden="true" />
        </DSButton>
      </Tooltip>
    </div>
  );
}
