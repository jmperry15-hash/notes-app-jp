import { useEffect } from 'react';
import { store } from '../state/store';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl+';

/**
 * Desktop shortcuts: ⌘N new note (⌘⌥N also works where the browser reserves ⌘N), ⌘F search,
 * ⌘L lock. Formatting shortcuts are handled by the editor itself.
 */
export function useShortcuts(focusSearch: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (!mod || event.repeat) return;
      const key = event.key.toLowerCase();
      const code = event.code;
      if ((key === 'n' || code === 'KeyN') && !event.shiftKey) {
        event.preventDefault();
        store.createNote();
      } else if ((key === 'f' || code === 'KeyF') && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        focusSearch();
      } else if ((key === 'l' || code === 'KeyL') && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        void store.lock('manual');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusSearch]);
}
