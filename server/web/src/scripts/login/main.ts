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

type Result = { ok: true } | { ok: false; error: string };

function post(path: string, password: string): Promise<Response> {
  return fetch(apiBase() + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

async function setup(password: string): Promise<Result> {
  let res: Response;
  try {
    res = await post('/api/auth/setup', password);
  } catch {
    return { ok: false, error: t('common.networkError') };
  }
  if (res.ok) return { ok: true };
  if (res.status >= 500) return { ok: false, error: t('common.serverError', { status: res.status }) };
  const text = await res.text().catch(() => '');
  if (/already set/i.test(text)) return { ok: false, error: t('login.alreadySet') };
  if (/too long/i.test(text)) return { ok: false, error: t('login.tooLong') };
  if (/at least/i.test(text)) return { ok: false, error: t('login.tooShort') };
  return { ok: false, error: t('login.setupFailed') };
}

/**
 * Says what went wrong in words: a wrong password, a lockout after too many
 * of them (and for how long), an unreachable or failing server.
 */
async function login(password: string): Promise<Result> {
  let res: Response;
  try {
    res = await post('/api/auth/login', password);
  } catch {
    return { ok: false, error: t('common.networkError') };
  }
  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    const secs = Number(body?.retry_after) || Number(res.headers.get('Retry-After')) || 15 * 60;
    return { ok: false, error: t('login.locked', { n: Math.max(1, Math.ceil(secs / 60)) }) };
  }
  // 400 is a password no account can have (longer than any that can be set).
  if (res.status === 401 || res.status === 400) return { ok: false, error: t('login.invalid') };
  if (!res.ok) return { ok: false, error: t('common.serverError', { status: res.status }) };
  const d = await res.json().catch(() => null);
  if (!d || !d.success || !d.token) return { ok: false, error: t('common.serverError', { status: res.status }) };
  try {
    localStorage.setItem(ADMIN_TOKEN_KEY, d.token);
  } catch {
    return { ok: false, error: t('login.storageBlocked') };
  }
  return { ok: true };
}

/**
 * The card is centred by CSS; from here on it keeps that top edge, so a
 * message under the password extends it downwards (see .login-wrap).
 */
function holdCard(): void {
  const wrap = document.querySelector<HTMLElement>('.login-wrap');
  const card = wrap?.querySelector<HTMLElement>('.login-card');
  if (!wrap || !card) return;
  wrap.classList.remove('is-held');
  const top = card.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
  wrap.style.setProperty('--login-top', `${top}px`);
  wrap.classList.add('is-held');
}

function showError(msg: string): void {
  const el = document.getElementById('login-error') as HTMLElement;
  el.textContent = msg;
  el.hidden = !msg;
}

async function boot(): Promise<void> {
  initNav();
  applyI18n(document);
  holdCard();
  window.addEventListener('resize', holdCard);
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
    // A first setup adds the confirm field: centre the taller card, unless
    // a slow answer let typing start already.
    if (!pw.value) holdCard();
  }

  let inFlight = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (inFlight) return;
    showError('');
    const password = pw.value.trim();
    if (password.length < 6) return showError(t('login.tooShort'));
    if (!isSet && new TextEncoder().encode(password).length > 128) return showError(t('login.tooLong'));
    inFlight = true;
    submit.disabled = true;
    try {
      const redirect = validateRedirect(new URLSearchParams(window.location.search).get('redirect'));
      if (!isSet) {
        if (password !== confirm.value.trim()) return showError(t('login.mismatch'));
        const r = await setup(password);
        if (!r.ok) return showError(r.error);
        const l = await login(password);
        if (l.ok) window.location.href = redirect;
        else showError(l.error);
        return;
      }
      const l = await login(password);
      if (l.ok) window.location.href = redirect;
      else {
        showError(l.error);
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
