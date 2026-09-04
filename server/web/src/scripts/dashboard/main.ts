/**
 * Public dashboard controller: auth gate, SSE stream, list reconciliation,
 * filters / sort / search, stat tiles and the detail dialog.
 */
import { applyI18n, getLang, t } from '../core/i18n';
import { copyText, debounce, esc, flashCopied } from '../core/dom';
import { HttpError, SSEClient, adminToken, apiBase, getJSON, navbarConfig, redirectToLogin, shareToken } from '../core/api';
import { hydrateRemoteIcons, icon } from '../core/icons';
import { DetailDialog, idFromHash } from './detail';
import { renderRow, patchRow } from './row';
import { matchesFilter, matchesQuery, normalize, sortServers, type FilterKey, type Server, type SortField } from './state';
import { getTCPingConfig, invalidateTCPingConfig } from './tcping';

const SORT_KEY = 'pulse.sort';

interface RowEntry {
  el: HTMLElement;
  s: Server;
}

const state = {
  all: [] as Server[],
  byId: new Map<string, Server>(),
  view: [] as Server[],
  filter: 'all' as FilterKey,
  query: '',
  sort: 'default' as SortField,
  dir: 'asc' as 'asc' | 'desc',
  showTags: true,
  showCards: true,
  showTraffic: false,
  rendered: false,
  paintedFreshness: 0,
  paintedIds: '',
};

const rows = new Map<string, RowEntry>();
let body: HTMLElement;
let detail: DetailDialog;
let sse: SSEClient;
let pendingHashId: string | null = null;

/* ------------------------------------------------------------------ */
/* Auth gate (privacy mode)                                             */
/* ------------------------------------------------------------------ */
async function gate(): Promise<boolean> {
  const base = apiBase();
  try {
    const res = await fetch(`${base}/api/privacy/config`, { cache: 'no-store' });
    if (!res.ok) return true; // fail open, like before
    const cfg = await res.json();
    if (!cfg.enabled) return true;
    const st = shareToken();
    if (st) {
      const v = await fetch(`${base}/api/privacy/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: st }),
      });
      if (!v.ok && v.status !== 401) return true;
      if (v.ok) {
        const d = await v.json().catch(() => null);
        if (d && d.valid) return true;
      }
    }
    const at = adminToken();
    if (at) {
      try {
        const v = await fetch(`${base}/api/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: at }),
        });
        if (!v.ok && v.status !== 401) return true;
        if (v.ok) {
          const d = await v.json().catch(() => null);
          if (d && d.valid) return true;
        }
      } catch {
        /* fall through */
      }
    }
    window.location.href = '/login?redirect=' + encodeURIComponent('/');
    return false;
  } catch {
    return true;
  }
}

function revealPage(): void {
  const gateEl = document.getElementById('gate');
  const page = document.getElementById('page');
  if (page) page.hidden = false;
  if (gateEl) {
    gateEl.style.pointerEvents = 'none';
    gateEl.style.opacity = '0';
    window.setTimeout(() => (gateEl.hidden = true), 220);
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */
function computeView(): void {
  const q = state.query.trim().toLowerCase();
  const filtered = state.all.filter((s) => matchesFilter(s, state.filter) && matchesQuery(s, q));
  state.view = sortServers(filtered, state.sort, state.dir);
}

function renderStats(): void {
  const total = state.all.length;
  const online = state.all.filter((s) => s.online).length;
  const offline = total - online;
  const crit = state.all.filter((s) => s.health === 'critical').length;
  const warn = state.all.filter((s) => s.health === 'warn').length;
  const withHw = state.all.filter((s) => s.hardware).length;
  const ds = state.all.filter((s) => s.type === 'DS').length;
  const vps = state.all.filter((s) => s.type === 'VPS').length;
  const set = (k: string, v: string) => {
    const e = document.querySelector<HTMLElement>(`[data-stat="${k}"]`);
    if (e && e.textContent !== v) e.textContent = v;
  };
  set('total', String(total));
  set('total-sub', [ds ? t('dash.stat.dsCount', { n: ds }) : '', vps ? t('dash.stat.vpsCount', { n: vps }) : ''].filter(Boolean).join(' · '));
  set('online', String(online));
  set('online-sub', total ? `${Math.round((online / Math.max(1, total)) * 100)}%` : '');
  set('offline', String(offline));
  const offNames = state.all.filter((s) => !s.online).map((s) => s.name);
  const sep = getLang() === 'zh' ? '、' : ', ';
  set('offline-sub', offNames.length ? (offNames.length <= 2 ? offNames.join(sep) : `${offNames[0]} +${offNames.length - 1}`) : '');
  set('attention', String(crit + warn));
  set('attention-sub', crit + warn ? t('dash.stat.attentionSub', { crit, warn }) : withHw ? t('dash.stat.allGood') : t('dash.stat.noHardware'));
  document.querySelector<HTMLElement>('[data-stat="offline"]')?.classList.toggle('is-nonzero', offline > 0);
  const attVal = document.querySelector<HTMLElement>('[data-stat="attention"]');
  if (attVal) attVal.classList.toggle('is-nonzero', crit + warn > 0);
  const att = document.querySelector<HTMLElement>('[data-filter="attention"]');
  if (att) {
    att.classList.toggle('tone-crit', crit > 0);
    att.classList.toggle('tone-warn', crit === 0);
  }
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)));
  const stats = document.getElementById('stats');
  if (stats) stats.hidden = !state.showCards;
}

function emptyHtml(kind: 'none' | 'filtered' | 'error', msg = ''): string {
  if (kind === 'error') {
    return `<div class="py-16 text-center"><div class="inline-flex w-11 h-11 items-center justify-center rounded-xl subcard mb-3 text-[var(--crit)]">${icon('alert-circle', 20)}</div><div class="text-[14px] font-semibold">${esc(t('dash.error.title'))}</div><div class="text-[12px] t-3 mt-1">${esc(msg)}</div><button type="button" class="btn btn-sm mt-4" data-retry>${icon('refresh', 13)}${esc(t('dash.error.retry'))}</button></div>`;
  }
  if (kind === 'filtered') {
    return `<div class="py-16 text-center"><div class="inline-flex w-11 h-11 items-center justify-center rounded-xl subcard mb-3 t-3">${icon('filter', 20)}</div><div class="text-[14px] font-semibold">${esc(t('dash.empty.filtered'))}</div><button type="button" class="btn btn-sm mt-4" data-clear-filters>${esc(t('dash.empty.clear'))}</button></div>`;
  }
  return `<div class="py-16 text-center"><div class="inline-flex w-11 h-11 items-center justify-center rounded-xl subcard mb-3 t-3">${icon('server', 20)}</div><div class="text-[14px] font-semibold">${esc(t('dash.empty.title'))}</div><div class="text-[12px] t-3 mt-1">${esc(t('dash.empty.desc'))}</div></div>`;
}

function clearRows(): void {
  rows.clear();
  body.innerHTML = '';
}

function paint(): void {
  computeView();
  renderStats();
  const opts = { showTags: state.showTags };

  if (state.all.length === 0) {
    clearRows();
    body.innerHTML = emptyHtml('none');
    return;
  }
  if (state.view.length === 0) {
    clearRows();
    body.innerHTML = emptyHtml('filtered');
    return;
  }
  if (rows.size === 0) body.innerHTML = '';

  const keep = new Set<string>();
  const first = rows.size === 0;
  state.view.forEach((s, i) => {
    keep.add(s.id);
    const entry = rows.get(s.id);
    if (entry) {
      patchRow(entry.el, s, entry.s, opts);
      entry.s = s;
    } else {
      const tpl = document.createElement('template');
      tpl.innerHTML = renderRow(s, opts);
      const el = tpl.content.firstElementChild as HTMLElement;
      if (first) {
        el.classList.add('rise-in');
        el.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
      }
      rows.set(s.id, { el, s });
    }
  });
  rows.forEach((entry, id) => {
    if (!keep.has(id)) {
      entry.el.remove();
      rows.delete(id);
    }
  });
  // Reorder only if needed.
  const desired = state.view.map((s) => rows.get(s.id)!.el);
  const current = Array.from(body.children);
  let same = current.length === desired.length;
  if (same) for (let i = 0; i < desired.length; i++) if (current[i] !== desired[i]) { same = false; break; }
  if (!same) {
    const frag = document.createDocumentFragment();
    desired.forEach((el) => frag.appendChild(el));
    body.replaceChildren(frag);
  }
  hydrateRemoteIcons(body);
}

function rerenderAll(): void {
  clearRows();
  paint();
  updateSortLabel();
  applyI18n(document);
}

/* ------------------------------------------------------------------ */
/* Data intake                                                          */
/* ------------------------------------------------------------------ */
function isStale(list: any[]): boolean {
  let max = 0;
  for (const s of list) {
    const ts = s && s.updated_at ? Date.parse(s.updated_at) : 0;
    if (ts > max) max = ts;
  }
  const ids = list
    .map((s) => (s && s.id) || '')
    .sort()
    .join('\n');
  if (ids === state.paintedIds && max && state.paintedFreshness && max < state.paintedFreshness) return true;
  state.paintedIds = ids;
  state.paintedFreshness = max || state.paintedFreshness;
  return false;
}

function ingest(list: any[]): void {
  if (!Array.isArray(list)) return;
  if (isStale(list)) return;
  const items = list.filter((x) => x && x.hide_on_home !== true).map(normalize);
  state.all = items;
  state.byId = new Map(items.map((s) => [s.id, s]));
  state.rendered = true;
  paint();
  const openId = detail.openId;
  if (openId) detail.update(state.byId.get(openId) || null);
  if (pendingHashId) {
    const id = pendingHashId;
    pendingHashId = null;
    if (state.byId.has(id)) detail.open(id, false);
  }
}

async function loadOnce(): Promise<void> {
  try {
    const data = await getJSON<any[]>('/api/metrics');
    ingest(Array.isArray(data) ? data : []);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      redirectToLogin('/');
      return;
    }
    if (!state.rendered) {
      body.innerHTML = emptyHtml('error', err instanceof Error ? err.message : String(err));
    }
  }
}

function setLive(stateName: string): void {
  const el = document.getElementById('live-indicator');
  const txt = document.getElementById('live-text');
  if (!el) return;
  el.setAttribute('data-state', stateName === 'connecting' ? 'reconnecting' : stateName);
  if (txt) txt.textContent = stateName === 'live' ? t('live.live') : stateName === 'offline' ? t('live.offline') : t('live.reconnecting');
}

let debouncedIngest: ((list: any[]) => void) | null = null;

function startStream(): void {
  sse = new SSEClient({
    onState: setLive,
    onUpdate: (u) => {
      if (!u || typeof u !== 'object') return;
      if (u.type === 'metric_updated') {
        if (Array.isArray(u.systems)) debouncedIngest!(u.systems);
        else loadOnce();
      } else if (u.type === 'order_updated' || u.type === 'metric_deleted') {
        loadOnce();
      } else if (u.type === 'tcping_config_updated') {
        invalidateTCPingConfig();
        getTCPingConfig(true).then(() => detail.tcpingConfigChanged());
      }
    },
  });
  sse.connect();
  window.setTimeout(() => {
    if (!state.rendered) loadOnce();
  }, 2500);
}

/* ------------------------------------------------------------------ */
/* Controls                                                             */
/* ------------------------------------------------------------------ */
function updateSortLabel(): void {
  const label = document.getElementById('sort-label');
  if (label) label.textContent = state.sort === 'default' ? t('dash.sort') : t('dash.sort.' + state.sort);
  const dirIcon = document.getElementById('sort-dir');
  if (dirIcon) {
    dirIcon.hidden = state.sort === 'default';
    dirIcon.innerHTML = icon(state.dir === 'asc' ? 'arrow-up' : 'arrow-down', 12);
  }
  document.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) => {
    const on = b.dataset.sort === state.sort;
    b.setAttribute('aria-checked', String(on));
    const mark = b.querySelector<HTMLElement>('.mark');
    if (mark) mark.innerHTML = on ? icon(state.dir === 'asc' ? 'arrow-up' : 'arrow-down', 13) : '';
  });
}

function setupControls(): void {
  const input = document.getElementById('system-filter-input') as HTMLInputElement | null;
  if (input) {
    const apply = debounce(() => {
      state.query = input.value;
      paint();
    }, 120);
    input.addEventListener('input', apply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        state.query = '';
        paint();
      }
    });
  }
  document.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      const f = b.dataset.filter as FilterKey;
      state.filter = state.filter === f && f !== 'all' ? 'all' : f;
      paint();
    });
  });

  const sortBtn = document.getElementById('sort-btn');
  const menu = document.getElementById('sort-menu');
  if (sortBtn && menu) {
    sortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      sortBtn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !menu.contains(e.target as Node)) {
        menu.hidden = true;
        sortBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        menu.hidden = true;
        sortBtn.setAttribute('aria-expanded', 'false');
      }
    });
    menu.querySelectorAll<HTMLElement>('[data-sort]').forEach((b) => {
      b.addEventListener('click', () => {
        const f = b.dataset.sort as SortField;
        if (f === state.sort && f !== 'default') state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else {
          state.sort = f;
          state.dir = f === 'cpu' || f === 'memory' || f === 'disk' || f === 'uptime' ? 'desc' : 'asc';
        }
        try {
          localStorage.setItem(SORT_KEY, JSON.stringify({ sort: state.sort, dir: state.dir }));
        } catch {}
        updateSortLabel();
        paint();
        menu.hidden = true;
      });
    });
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
    if (saved && typeof saved.sort === 'string') {
      state.sort = saved.sort;
      state.dir = saved.dir === 'desc' ? 'desc' : 'asc';
    }
  } catch {}
  updateSortLabel();

  body.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLElement>('[data-copy-name]');
    if (copy) {
      e.stopPropagation();
      const ok = await copyText(copy.getAttribute('data-copy-name') || '');
      flashCopied(copy, ok, t('common.copied'), t('common.copyFailed'));
      return;
    }
    if (target.closest('[data-retry]')) {
      body.innerHTML = '';
      loadOnce();
      return;
    }
    if (target.closest('[data-clear-filters]')) {
      state.filter = 'all';
      state.query = '';
      if (input) input.value = '';
      paint();
      return;
    }
    const row = target.closest<HTMLElement>('.srv-row');
    if (row && row.dataset.id) detail.open(row.dataset.id);
  });
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.srv-row');
    if (row && row === e.target && row.dataset.id) {
      e.preventDefault();
      detail.open(row.dataset.id);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */
async function boot(): Promise<void> {
  body = document.getElementById('systems-body') as HTMLElement;
  applyI18n(document);
  const allowed = await gate();
  if (!allowed) return;
  revealPage();

  const cfg = navbarConfig() || {};
  state.showTraffic = cfg.show_traffic === true;
  state.showTags = cfg.hide_tags !== true;
  state.showCards = cfg.hide_cards !== true;
  const stats = document.getElementById('stats');
  if (stats) stats.hidden = !state.showCards;

  detail = new DetailDialog({
    get: (id) => state.byId.get(id) || null,
    neighbors: (id) => {
      const i = state.view.findIndex((s) => s.id === id);
      return { prev: i > 0 ? state.view[i - 1].id : null, next: i >= 0 && i < state.view.length - 1 ? state.view[i + 1].id : null };
    },
    showTraffic: () => state.showTraffic,
    showTags: () => state.showTags,
  });
  pendingHashId = idFromHash();

  let pending: any[] | null = null;
  let timer: number | null = null;
  debouncedIngest = (list) => {
    pending = list;
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      const l = pending;
      pending = null;
      if (l) ingest(l);
    }, 80);
  };

  setupControls();
  getTCPingConfig();
  startStream();

  window.addEventListener('pulse:lang', () => {
    // Issue text is language-dependent: rebuild the view models from raw.
    state.all = state.all.map((s) => normalize(s.raw));
    state.byId = new Map(state.all.map((s) => [s.id, s]));
    rerenderAll();
    const openId = detail.openId;
    if (openId) detail.update(state.byId.get(openId) || null);
    setLive(document.getElementById('live-indicator')?.getAttribute('data-state') || 'live');
  });
  window.addEventListener('beforeunload', () => sse?.close());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.rendered) loadOnce();
  });
  document.documentElement.setAttribute('data-lang', getLang());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
