/** Per-device, non-sensitive preferences kept in localStorage. */

export type ThemePref = 'system' | 'light' | 'dark';

export interface Prefs {
  theme: ThemePref;
  autoLockMinutes: number;
  sidebarWidth: number;
  listWidth: number;
  sidebarCollapsed: boolean;
  lastBackupAt: number | null;
  backupReminderSnoozedAt: number | null;
}

export const AUTO_LOCK_OPTIONS = [1, 2, 5, 10, 15, 30, 60];

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  autoLockMinutes: 5,
  sidebarWidth: 220,
  listWidth: 300,
  sidebarCollapsed: false,
  lastBackupAt: null,
  backupReminderSnoozedAt: null,
};

const KEY = 'folio.prefs';

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing or storage full: preferences just won't persist.
  }
}

export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export const THEME_COLORS = { dark: '#0b1222', light: '#f7f5f0' } as const;

export function applyTheme(pref: ThemePref): void {
  const theme = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    if (pref === 'system') {
      const media = meta.getAttribute('media') ?? '';
      meta.setAttribute('content', media.includes('light') ? THEME_COLORS.light : THEME_COLORS.dark);
    } else {
      meta.setAttribute('content', THEME_COLORS[theme]);
    }
  });
}
