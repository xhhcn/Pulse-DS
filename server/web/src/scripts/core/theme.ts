/**
 * Theme (dark / light) management. The inline bootstrap in Base.astro
 * already applied the class before first paint; this module owns the
 * changes (the theme menu, the system's theme, another tab) and their
 * notifications.
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

function rgba(c: string): number[] | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
}

/**
 * Keep the browser chrome (the iPhone status bar, Safari's tinted tab bar)
 * the colour of the top bar, or of the page where there is none (login).
 * A translucent bar (glass mode) is flattened over the page background.
 */
export function syncThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta || !document.body) return;
  const page = rgba(getComputedStyle(document.body).backgroundColor) || [0, 0, 0, 1];
  const bar = document.querySelector<HTMLElement>('.topbar');
  const top = (bar && rgba(getComputedStyle(bar).backgroundColor)) || page;
  const a = top[3];
  meta.content = '#' + [0, 1, 2].map((i) => Math.round(top[i] * a + page[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}

function crossFade(theme: Theme): void {
  const html = document.documentElement;
  const doc: any = document;
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => {
      applyClasses(theme);
      syncThemeColor();
    });
  } else {
    html.classList.add('theme-switching');
    applyClasses(theme);
    syncThemeColor();
    void html.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('theme-switching')));
  }
}

/**
 * Show a theme and tell the page. Picking System while the system's theme is
 * already on screen repaints nothing, but the menu still moves its tick.
 */
function show(theme: Theme): void {
  if (!document.documentElement.classList.contains(theme)) crossFade(theme);
  window.dispatchEvent(new CustomEvent('pulse:theme', { detail: { theme } }));
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function setTheme(theme: Theme): void {
  try { localStorage.setItem(KEY, theme); } catch {}
  show(theme);
}

/** What the theme menu offers: the system's theme (nothing stored), or one kept. */
export type ThemePref = Theme | 'system';

export function getThemePref(): ThemePref {
  const stored = storedTheme();
  return stored === 'dark' || stored === 'light' ? stored : 'system';
}

export function setThemePref(pref: ThemePref): void {
  if (pref !== 'system') {
    setTheme(pref);
    return;
  }
  try { localStorage.removeItem(KEY); } catch {}
  show(systemTheme());
}

export function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function onThemeChange(fn: (theme: Theme) => void): void {
  window.addEventListener('pulse:theme', (e: any) => fn(e.detail?.theme || getTheme()));
}

// Unless light or dark is picked in the theme menu, the page follows the
// system's theme, also when the system changes it while the page is open (an
// automatic dark mode at dusk).
function storedTheme(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const stored = storedTheme();
    if (stored === 'dark' || stored === 'light') return;
    const theme = systemTheme();
    if (document.documentElement.classList.contains(theme)) return;
    applyClasses(theme);
    syncThemeColor();
    window.dispatchEvent(new CustomEvent('pulse:theme', { detail: { theme } }));
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  });
} catch {}

// A theme picked in another tab of this site shows here too (System included).
window.addEventListener('storage', (e) => {
  if (e.key !== KEY && e.key !== null) return;
  const stored = storedTheme();
  show(stored === 'dark' || stored === 'light' ? stored : systemTheme());
});

// The boot script guessed the top bar's colour before the page existed; now
// that it does, measure it (the login page has no top bar at all).
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncThemeColor);
else syncThemeColor();
