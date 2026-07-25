import { useId, useState } from 'react';

export function CollapsibleFacetList({
  items,
  hrefFor,
  noun,
  compactCount = 12,
  className = ''
}: {
  items: string[];
  hrefFor: (item: string) => string;
  noun: string;
  compactCount?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const hasOverflow = items.length > compactCount;
  const visible = expanded ? items : items.slice(0, compactCount);
  return <div className={`collapsible-facets ${className}`}>
    <div id={id}>{visible.map((item) => <a key={item} href={hrefFor(item)}>{item}</a>)}</div>
    {hasOverflow && <button type="button" aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded((value) => !value)}>
      {expanded ? 'Show fewer' : `Show all ${items.length} ${noun}`}
    </button>}
  </div>;
}
