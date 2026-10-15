import { useEffect } from 'react';
import { applyTheme } from './lib/prefs';
import { store, useApp } from './state/store';
import { LockScreen, LoginScreen, MessageScreen, SetupScreen, SplashScreen } from './components/AuthScreens';
import { BusyOverlay, DialogHost, ToastHost } from './components/Overlays';
import { Shell } from './components/Shell';

export default function App() {
  const phase = useApp((s) => s.phase);
  const theme = useApp((s) => s.prefs.theme);

  useEffect(() => {
    void store.boot();
  }, []);

  // Follow the system appearance while the theme is set to "System".
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  let screen;
  switch (phase) {
    case 'booting':
      screen = <SplashScreen />;
      break;
    case 'unconfigured':
    case 'needsNetwork':
      screen = <MessageScreen kind={phase} />;
      break;
    case 'signedOut':
      screen = <LoginScreen />;
      break;
    case 'setup':
      screen = <SetupScreen />;
      break;
    case 'locked':
      screen = <LockScreen />;
      break;
    case 'unlocked':
      screen = <Shell />;
      break;
  }

  return (
    <>
      {screen}
      <DialogHost />
      <ToastHost />
      <BusyOverlay />
    </>
  );
}
