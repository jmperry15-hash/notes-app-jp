import { useEffect } from 'react';
import { store } from '../state/store';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'input'] as const;

/**
 * Locks after `minutes` without interaction, and when the app comes back after being in the
 * background for longer than that. (A web page's timers are paused in the background on iOS,
 * so the background case is checked on return.)
 */
export function useAutoLock(minutes: number): void {
  useEffect(() => {
    const limit = minutes * 60_000;
    let lastActive = Date.now();
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

    const touch = () => {
      lastActive = Date.now();
    };
    const check = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActive >= limit) void store.lock('timeout');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else {
        if (hiddenAt !== null && Date.now() - hiddenAt >= limit) void store.lock('timeout');
        hiddenAt = null;
        check();
      }
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, touch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    const timer = window.setInterval(check, 10_000);
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, touch, { capture: true }));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
      window.clearInterval(timer);
    };
  }, [minutes]);
}
