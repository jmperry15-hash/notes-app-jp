import { useEffect, useSyncExternalStore } from 'react';
import { store, type Layout } from '../state/store';

function subscribeMedia(query: string) {
  return (callback: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', callback);
    return () => media.removeEventListener('change', callback);
  };
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(subscribeMedia(query), () => window.matchMedia(query).matches);
}

/** Desktop (≥1024px): three columns. Tablet (≥700px): two columns. Phone: a navigation stack. */
export function useLayout(): Layout {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const tablet = useMediaQuery('(min-width: 700px)');
  const layout: Layout = desktop ? 'desktop' : tablet ? 'tablet' : 'phone';
  useEffect(() => store.setLayout(layout), [layout]);
  return layout;
}

export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
