/**
 * Theme (dark / light) management. The inline bootstrap in Base.astro
 * already applied the class before first paint; this module only owns
 * toggling and change notifications.
 */
export type Theme = 'dark' | 'light';
const KEY = 'preferred-theme';

export function systemTheme(): Theme {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export function getTheme(): Theme {
  let stored: string | null = null;
  try { stored = localStorage.getItem(KEY); } catch {}
  if (stored === 'dark' || stored === 'light') return stored;
  return document.documentElement.classList.contains('light') ? 'light' : systemTheme();
}

function applyClasses(theme: Theme): void {
  const html = document.documentElement;
  html.classList.toggle('dark', theme === 'dark');
  html.classList.toggle('light', theme === 'light');
  if (document.body) {
    document.body.classList.toggle('dark', theme === 'dark');
    document.body.classList.toggle('light', theme === 'light');
  }
}

export function setTheme(theme: Theme): void {
  try { localStorage.setItem(KEY, theme); } catch {}
  const html = document.documentElement;
  const doc: any = document;
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => applyClasses(theme));
  } else {
    html.classList.add('theme-switching');
    applyClasses(theme);
    void html.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('theme-switching')));
  }
  window.dispatchEvent(new CustomEvent('pulse:theme', { detail: { theme } }));
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function toggleTheme(): void {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function onThemeChange(fn: (theme: Theme) => void): void {
  window.addEventListener('pulse:theme', (e: any) => fn(e.detail?.theme || getTheme()));
}
