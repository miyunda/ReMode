// Theme preference: 'system' follows prefers-color-scheme; 'light' (Rosé Pine
// Dawn) and 'dark' (Rosé Pine) are manual choices saved in localStorage.
// Storage can be missing or throw (private mode, blocked site data): every
// access is guarded and the app works without it. Keep the key in sync with
// public/theme-init.js.

export type ThemePref = 'system' | 'light' | 'dark';

export const THEME_KEY = 'remode.theme';

export function readThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* not persisted; the choice still applies to this page */
  }
}

export function applyThemePref(pref: ThemePref, root: HTMLElement = document.documentElement) {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}
