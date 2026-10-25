import { readTransitionCover } from '../viewTransitions';

/** The clicked cover, shown in the hero's slot while the novel page loads so the page transition has somewhere to land. */
export function NovelCoverGhost({ id }: { id: number }) {
  const src = readTransitionCover(id);
  if (!src) return null;
  return <span className="vt-ghost-cover" aria-hidden="true"><img src={src} alt="" decoding="sync" /></span>;
}

