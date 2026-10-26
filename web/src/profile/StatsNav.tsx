import { useEffect, useState } from 'react';

export interface StatsSection {
  id: string;
  label: string;
}

/** Highlights the section nearest the top of the viewport; mirrors the title page's section nav. */
function useActiveSection(ids: string[]): [string, (id: string) => void] {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join('|');

  useEffect(() => {
    const sections = ids.flatMap((id) => {
      const element = document.getElementById(id);
      return element ? [element] : [];
    });
    if (!sections.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-20% 0px -65% 0px' });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
    // `key` stands in for `ids`, which is a fresh array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (ids.length && !ids.includes(active)) setActive(ids[0]);
  }, [key, active]); // eslint-disable-line react-hooks/exhaustive-deps

  return [active, setActive];
}

export default function StatsNav({ sections, reducedMotion }: { sections: StatsSection[]; reducedMotion: boolean }) {
  const [active, setActive] = useActiveSection(sections.map((section) => section.id));
  if (sections.length < 2) return null;

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <nav className="stats-nav" aria-label="Stats sections">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={active === section.id ? 'active' : ''}
          aria-current={active === section.id ? 'location' : undefined}
          onClick={() => go(section.id)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
