import { sanitizeSvg } from './dom';
import { applyI18n, getLang, onLangChange, t, toggleLang } from './i18n';
import { getThemePref, onThemeChange, setThemePref, type ThemePref } from './theme';
import { navbarConfig } from './api';
import { installFocusMode } from './focus';
import { menuButton } from './menu';

const DEFAULT_LOGO =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" class="default-logo"><path class="pulse-beat" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6.5 12h2l2-6 3 18 2.5-12h2"/><path stroke="currentColor" stroke-linecap="round" stroke-width="1.8" d="M2.5 12h2M19.5 12h2" opacity="0.5"/></svg>';

function applyBrand(): void {
  const cfg = navbarConfig();
  const text = document.getElementById('brand-text');
  const logo = document.getElementById('brand-logo');
  if (text) text.textContent = (cfg && cfg.text && String(cfg.text).trim()) || 'Pulse-DS';
  if (!logo) return;
  const raw = cfg && cfg.logo ? String(cfg.logo).trim() : '';
  if (!raw) { logo.innerHTML = DEFAULT_LOGO; return; }
  if (/^(https?:)?\/\/[^\s<>"']+$/i.test(raw) || /^\/[^\s<>"']+$/.test(raw) || /^data:image\//i.test(raw)) {
    const img = document.createElement('img');
    img.alt = '';
    img.width = 22;
    img.height = 22;
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    img.addEventListener('error', () => { logo.innerHTML = DEFAULT_LOGO; });
    img.src = raw;
    logo.replaceChildren(img);
    return;
  }
  if (raw.startsWith('<svg')) {
    const clean = sanitizeSvg(raw, 22);
    logo.innerHTML = clean || DEFAULT_LOGO;
    return;
  }
  logo.innerHTML = DEFAULT_LOGO;
}

// Tab title: "<page> · <site>" in the current language. Base.astro sets the
// same string before first paint; this keeps it right after a language switch.
const PAGE_TITLE: Record<string, string> = { admin: 'page.admin', login: 'page.login' };
function applyTitle(): void {
  const cfg = navbarConfig();
  const site = (cfg && cfg.text && String(cfg.text).trim()) || 'Pulse-DS';
  const key = PAGE_TITLE[document.documentElement.getAttribute('data-page') || ''];
  document.title = key ? `${t(key)} · ${site}` : site;
}

// The theme menu ticks what was picked: System until light or dark is.
function refreshTheme(): void {
  const pref = getThemePref();
  document.querySelectorAll<HTMLElement>('[data-theme-pref]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themePref === pref)));
}

function refreshButtons(): void {
  refreshTheme();
  applyI18n(document);
}

function setupThemeMenu(): void {
  const btn = document.getElementById('theme-btn');
  const menu = document.getElementById('theme-menu');
  if (btn && menu) menuButton(btn, menu, (item) => setThemePref(item.dataset.themePref as ThemePref));
}

export function initNav(): void {
  installFocusMode();
  applyBrand();
  applyTitle();
  refreshButtons();
  document.getElementById('lang-btn')?.addEventListener('click', () => toggleLang());
  setupThemeMenu();
  onLangChange(refreshButtons);
  onLangChange(applyTitle);
  // Only the tick: translating the page again would reset the texts that
  // scripts keep up to date (the live indicator read "Reconnecting").
  onThemeChange(refreshTheme);
  // Expose for operator custom_js that used the old event names.
  document.documentElement.setAttribute('data-lang', getLang());
  onLangChange((l) => document.documentElement.setAttribute('data-lang', l));
}
