import { useState, useEffect } from 'react';

export type MediaTypeChoice = 'novel' | 'manga' | 'anime';

const STORAGE_KEY = 'novel-compass:media-types:v1';
const EVENT_NAME = 'novel-compass-media-types-changed';

export function getSelectedMediaTypes(): MediaTypeChoice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return ['novel', 'manga', 'anime'];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as MediaTypeChoice[];
  } catch {
    // fallback to all
  }
  return ['novel', 'manga', 'anime'];
}

export function setSelectedMediaTypes(types: MediaTypeChoice[]): void {
  const clean = types.length > 0 ? types : ['novel', 'manga', 'anime'];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: clean }));
}

export function toggleMediaType(type: MediaTypeChoice): MediaTypeChoice[] {
  const current = getSelectedMediaTypes();
  let next: MediaTypeChoice[];
  if (current.includes(type)) {
    // Don't allow unselecting all - if only 1 remains, keep it or reset
    if (current.length === 1) next = ['novel', 'manga', 'anime'];
    else next = current.filter((t) => t !== type);
  } else {
    next = [...current, type];
  }
  setSelectedMediaTypes(next);
  return next;
}

export function useMediaFilterState() {
  const [selectedTypes, setSelected] = useState<MediaTypeChoice[]>(getSelectedMediaTypes);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<MediaTypeChoice[]>;
      setSelected(custom.detail || getSelectedMediaTypes());
    };
    window.addEventListener(EVENT_NAME, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  return {
    selectedTypes,
    toggleType: (type: MediaTypeChoice) => toggleMediaType(type),
    setTypes: (types: MediaTypeChoice[]) => setSelectedMediaTypes(types),
    isAllSelected: selectedTypes.length === 3,
    isSelected: (type: MediaTypeChoice) => selectedTypes.includes(type)
  };
}
