import { useEffect, useState } from 'react';

/**
 * On iOS the on-screen keyboard covers the page instead of resizing it. While the keyboard is
 * open, this sizes the app to the visual viewport (exposed as --vv-height / --vv-top), so the
 * editor and its toolbar sit just above the keyboard. Returns whether the keyboard is open.
 */
export function useVisualViewport(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const covered = window.innerHeight - viewport.height;
        const open = covered > 120 && viewport.scale < 1.05;
        if (open) {
          root.style.setProperty('--vv-height', `${viewport.height}px`);
          root.style.setProperty('--vv-top', `${viewport.offsetTop}px`);
        } else {
          root.style.removeProperty('--vv-height');
          root.style.removeProperty('--vv-top');
        }
        setKeyboardOpen(open);
      });
    };

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--vv-height');
      root.style.removeProperty('--vv-top');
    };
  }, []);

  return keyboardOpen;
}
