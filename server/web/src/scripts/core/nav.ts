import { sanitizeSvg } from './dom';
import { applyI18n, getLang, onLangChange, t, toggleLang } from './i18n';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import { navbarConfig } from './api';
import { installFocusMode } from './focus';

const DEFAULT_LOGO =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" class="default-logo"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6.5 12h2l2-6 3 18 2.5-12h2"><animate attributeName="opacity" values="0.55;1;0.55" dur="2.4s" repeatCount="indefinite"/></path><path stroke="currentColor" stroke-linecap="round" stroke-width="1.8" d="M2.5 12h2M19.5 12h2" opacity="0.5"/></svg>';

function applyBrand(): void {
  const cfg = navbarConfig();
  const text = document.getElementById('brand-text');
  const logo = document.getElementById('brand-logo');
  if (text) text.textContent = (cfg && cfg.text && String(cfg.text).trim()) || 'Pulse';
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

function refreshButtons(): void {
  const themeBtn = document.getElementById('theme-btn');
  if (themeBtn) {
    const label = getTheme() === 'dark' ? t('common.themeLight') : t('common.themeDark');
    themeBtn.setAttribute('title', label);
    themeBtn.setAttribute('aria-label', label);
  }
  applyI18n(document);
}

export function initNav(): void {
  installFocusMode();
  applyBrand();
  refreshButtons();
  document.getElementById('lang-btn')?.addEventListener('click', () => toggleLang());
  document.getElementById('theme-btn')?.addEventListener('click', () => toggleTheme());
  onLangChange(refreshButtons);
  onThemeChange(refreshButtons);
  // Expose for operator custom_js that used the old event names.
  document.documentElement.setAttribute('data-lang', getLang());
  onLangChange((l) => document.documentElement.setAttribute('data-lang', l));
}
