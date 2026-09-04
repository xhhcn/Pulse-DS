/** Login / first-run password setup. */
import { applyI18n, t } from '../core/i18n';
import { apiBase, ADMIN_TOKEN_KEY } from '../core/api';
import { initNav } from '../core/nav';

function validateRedirect(raw: string | null): string {
  if (!raw || typeof raw !== 'string') return '/admin';
  const r = raw.trim();
  if (!r.startsWith('/') || r.startsWith('//')) return '/admin';
  try {
    const u = new URL(r, window.location.origin);
    if (u.origin !== window.location.origin || u.pathname.includes('..')) return '/admin';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/admin';
  }
}

async function passwordIsSet(): Promise<boolean> {
  try {
    const res = await fetch(apiBase() + '/api/auth/status', { cache: 'no-store' });
    if (res.ok) return !!(await res.json()).set;
  } catch {}
  return true;
}

async function setup(password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(apiBase() + '/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return { ok: false, error: (await res.text().catch(() => '')) || t('login.setupFailed') };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch(apiBase() + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) return false;
    const d = await res.json();
    if (d && d.success && d.token) {
      localStorage.setItem(ADMIN_TOKEN_KEY, d.token);
      return true;
    }
  } catch {}
  return false;
}

function showError(msg: string): void {
  const el = document.getElementById('login-error') as HTMLElement;
  el.textContent = msg;
  el.hidden = !msg;
}

async function boot(): Promise<void> {
  initNav();
  applyI18n(document);
  const form = document.getElementById('login-form') as HTMLFormElement;
  const pw = document.getElementById('password') as HTMLInputElement;
  const confirmWrap = document.getElementById('confirm-wrap') as HTMLElement;
  const confirm = document.getElementById('confirm') as HTMLInputElement;
  const submit = document.getElementById('login-submit') as HTMLButtonElement;
  const title = document.getElementById('login-title') as HTMLElement;
  const subtitle = document.getElementById('login-subtitle') as HTMLElement;

  const toggle = document.getElementById('toggle-password') as HTMLButtonElement;
  toggle.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    confirm.type = pw.type;
    (toggle.querySelector('.i-show') as HTMLElement).hidden = show;
    (toggle.querySelector('.i-hide') as HTMLElement).hidden = !show;
    toggle.setAttribute('data-i18n-title', show ? 'login.hide' : 'login.show');
    applyI18n(toggle.parentElement as HTMLElement);
    pw.focus();
  });

  const isSet = await passwordIsSet();
  if (!isSet) {
    title.setAttribute('data-i18n', 'login.setupTitle');
    subtitle.setAttribute('data-i18n', 'login.setupSubtitle');
    submit.setAttribute('data-i18n', 'login.setupSubmit');
    confirmWrap.hidden = false;
    confirm.required = true;
    pw.autocomplete = 'new-password';
    applyI18n(document);
  }

  let inFlight = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight) return;
    showError('');
    const password = pw.value.trim();
    if (password.length < 6) return showError(t('login.tooShort'));
    inFlight = true;
    submit.disabled = true;
    try {
      const redirect = validateRedirect(new URLSearchParams(window.location.search).get('redirect'));
      if (!isSet) {
        if (password !== confirm.value.trim()) return showError(t('login.mismatch'));
        const r = await setup(password);
        if (!r.ok) return showError(r.error || t('login.setupFailed'));
        if (await login(password)) window.location.href = redirect;
        else showError(t('login.invalid'));
        return;
      }
      if (await login(password)) window.location.href = redirect;
      else {
        showError(t('login.invalid'));
        pw.select();
      }
    } finally {
      inFlight = false;
      submit.disabled = false;
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
