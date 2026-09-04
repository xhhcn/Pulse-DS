/**
 * Admin console controller: auth gate, server list (SSE + drag reorder),
 * add / edit / delete, settings dialog (general, display, privacy, tcping),
 * password change, backup download.
 */
import { applyI18n, getLang, t } from '../core/i18n';
import { attr, copyText, esc, flashCopied } from '../core/dom';
import { HttpError, SSEClient, adminToken, apiBase, clearAdminToken, getJSON, redirectToLogin, sendJSON } from '../core/api';
import { hydrateRemoteIcons, icon } from '../core/icons';
import { bytes, dateTime } from '../core/format';
import { Modal } from '../core/modal';
import { toast } from '../core/toast';

interface Row {
  el: HTMLElement;
  sig: string;
  raw: any;
}

const rows = new Map<string, Row>();
let list: HTMLElement;
let systems: any[] = [];
let rendered = false;
let orderSaving = false;
let heldSnapshot: any[] | null = null;
let sse: SSEClient | null = null;

const modals: Record<string, Modal> = {};

function fail(err: unknown, key: string): void {
  if (err instanceof HttpError && err.status === 401) {
    redirectToLogin('/admin');
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  toast(t(key, { msg }), 'err', 5000);
}

/* ------------------------------------------------------------------ */
/* Gate                                                                 */
/* ------------------------------------------------------------------ */
async function gate(): Promise<boolean> {
  const base = apiBase();
  try {
    const st = await fetch(`${base}/api/auth/status`, { cache: 'no-store' });
    if (st.ok) {
      const d = await st.json();
      if (!d.set) {
        window.location.href = '/login?redirect=' + encodeURIComponent('/admin');
        return false;
      }
    }
  } catch {}
  const token = adminToken();
  if (!token) {
    window.location.href = '/login?redirect=' + encodeURIComponent('/admin');
    return false;
  }
  try {
    const res = await fetch(`${base}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = res.ok ? await res.json().catch(() => null) : null;
    const valid = res.status !== 401 && !(data && data.valid === false);
    if (!valid) {
      redirectToLogin('/admin');
      return false;
    }
    return true;
  } catch {
    redirectToLogin('/admin');
    return false;
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
/* List                                                                 */
/* ------------------------------------------------------------------ */
function shellQuote(v: unknown): string {
  return `'${String(v ?? '').replace(/'/g, `'\\''`)}'`;
}
function psQuote(v: unknown): string {
  return `'${String(v ?? '').replace(/'/g, `''`)}'`;
}

function linuxCommand(s: any): string {
  let cmd = `curl -sSL https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/client/install.sh | sudo bash -s -- --id ${shellQuote(s.id)} --server ${shellQuote(window.location.origin)}`;
  if (s.secret) cmd += ` --secret ${shellQuote(s.secret)}`;
  return cmd;
}
function windowsCommand(s: any): string {
  let cmd = `powershell -ExecutionPolicy Bypass -Command "& { \`$env:AgentId=${psQuote(s.id)}; \`$env:ServerBase=${psQuote(window.location.origin)}`;
  if (s.secret) cmd += `; \`$env:Secret=${psQuote(s.secret)}`;
  cmd += `; irm https://raw.githubusercontent.com/xhhcn/Pulse-DS/main/client/install.ps1 | iex }"`;
  return cmd;
}

function sigOf(s: any): string {
  return JSON.stringify([
    s.id, s.name, s.virtualization_type, s.os, s.ipv4, s.ipv6, s.total_net_in_bytes, s.total_net_out_bytes, s.cpu_model,
    Array.isArray(s.tags) ? s.tags : [], s.hide_on_home === true, s.hide_tcping === true, s.secret, s.alert === true, s.health, s.agent_version,
  ]);
}

function ipRow(label: string, ip: string): string {
  if (!ip) return `<div class="flex items-center gap-1.5 text-[12px]"><span class="t-3 w-9">${label}</span><span class="t-3">—</span></div>`;
  return `<div class="flex items-center gap-1.5 text-[12px] min-w-0"><span class="t-3 w-9 shrink-0">${label}</span><span class="mono truncate t-1" title="${attr(ip)}">${esc(ip)}</span><button type="button" class="icon-btn icon-btn-sm shrink-0" data-copy="${attr(ip)}" title="${attr(t('admin.copyIp', { v: label }))}"><span class="i-copy">${icon('copy', 12)}</span><span class="i-check text-[var(--ok)]" hidden>${icon('check', 12)}</span></button></div>`;
}

function renderRowHtml(s: any): string {
  const hasAgent = !!(s.os || s.ipv4 || s.cpu_model || s.time);
  const online = s.alert !== true && hasAgent;
  const badges: string[] = [];
  if (s.virtualization_type) badges.push(`<span class="pill pill-sm pill-neutral">${esc(s.virtualization_type)}</span>`);
  if (s.hide_on_home === true) badges.push(`<span class="pill pill-sm pill-neutral" title="${attr(t('admin.hiddenHome'))}">${icon('eye-off', 11)}<span>${esc(t('admin.hiddenHome'))}</span></span>`);
  if (s.hide_tcping === true) badges.push(`<span class="pill pill-sm pill-neutral" title="${attr(t('admin.tcpingOff'))}">${icon('radio', 11)}<span>${esc(t('admin.tcpingOff'))}</span></span>`);
  if (!hasAgent) badges.push(`<span class="pill pill-sm pill-warn">${esc(t('admin.noAgent'))}</span>`);
  const tags = Array.isArray(s.tags) && s.tags.length ? `<div class="flex flex-wrap gap-1 mt-1.5">${s.tags.map((x: string) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : '';
  const sub = [s.os ? esc(s.os) : '', s.cpu_model ? esc(s.cpu_model) : ''].filter(Boolean).join(' · ');
  return `
<div class="admin-row" draggable="true" data-id="${attr(s.id)}" title="${attr(t('admin.dragHint'))}">
  <div class="a-grip drag-handle">${icon('grip', 16)}</div>
  <div class="a-main min-w-0">
    <div class="flex items-center gap-2 min-w-0 flex-wrap">
      <span class="dot ${online ? 'dot-online' : 'dot-offline'}" style="box-shadow:none"></span>
      <span class="font-medium text-[14px] truncate max-w-[280px]">${esc(s.name || '')}</span>
      <span class="t-3 mono">#${esc(s.id)}</span>
      ${badges.join('')}
    </div>
    <div class="flex items-center gap-1.5 text-[12px] t-3 mt-1 min-w-0"><span class="truncate">${sub || '&nbsp;'}</span></div>
    ${tags}
  </div>
  <div class="a-net flex flex-col gap-1 min-w-0">${ipRow('IPv4', s.ipv4 || '')}${ipRow('IPv6', s.ipv6 || '')}</div>
  <div class="a-traffic text-[12px] tnum flex flex-col gap-1">
    <div class="flex items-center gap-1.5"><span class="text-[var(--ok)]">${icon('arrow-down', 11)}</span><span class="t-2">${esc(bytes(s.total_net_in_bytes || 0))}</span></div>
    <div class="flex items-center gap-1.5"><span class="text-[var(--info)]">${icon('arrow-up', 11)}</span><span class="t-2">${esc(bytes(s.total_net_out_bytes || 0))}</span></div>
  </div>
  <div class="a-actions flex items-center gap-0.5">
    <button type="button" class="icon-btn info" data-act="edit" title="${attr(t('admin.edit'))}">${icon('pencil', 15)}</button>
    <button type="button" class="icon-btn warn" data-act="linux" title="${attr(t('admin.copyLinux'))}"><span class="i-copy">${icon('linux', 15)}</span><span class="i-check text-[var(--ok)]" hidden>${icon('check', 15)}</span></button>
    <button type="button" class="icon-btn info" data-act="windows" title="${attr(t('admin.copyWindows'))}"><span class="i-copy">${icon('windows', 15)}</span><span class="i-check text-[var(--ok)]" hidden>${icon('check', 15)}</span></button>
    <button type="button" class="icon-btn danger" data-act="delete" title="${attr(t('common.delete'))}">${icon('trash', 15)}</button>
  </div>
</div>`;
}

function paint(): void {
  rendered = true;
  const sub = document.getElementById('admin-subtitle');
  if (sub) sub.textContent = t(window.matchMedia('(pointer: coarse)').matches ? 'admin.subtitleTouch' : 'admin.subtitle', { n: systems.length });
  if (!systems.length) {
    rows.clear();
    list.innerHTML = `<div class="py-16 text-center"><div class="inline-flex w-11 h-11 items-center justify-center rounded-xl subcard mb-3 t-3">${icon('server', 20)}</div><div class="text-[14px] font-semibold">${esc(t('admin.empty.title'))}</div><div class="text-[12px] t-3 mt-1">${esc(t('admin.empty.desc'))}</div></div>`;
    return;
  }
  if (rows.size === 0) list.innerHTML = '';
  const keep = new Set<string>();
  systems.forEach((s) => {
    const id = String(s.id);
    keep.add(id);
    const sig = sigOf(s);
    const entry = rows.get(id);
    if (entry && entry.sig === sig) {
      entry.raw = s;
      return;
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = renderRowHtml(s);
    const el = tpl.content.firstElementChild as HTMLElement;
    wireDrag(el);
    if (entry) entry.el.replaceWith(el);
    rows.set(id, { el, sig, raw: s });
  });
  rows.forEach((entry, id) => {
    if (!keep.has(id)) {
      entry.el.remove();
      rows.delete(id);
    }
  });
  const desired = systems.map((s) => rows.get(String(s.id))!.el);
  const current = Array.from(list.children);
  let same = current.length === desired.length;
  if (same) for (let i = 0; i < desired.length; i++) if (current[i] !== desired[i]) { same = false; break; }
  if (!same) {
    const frag = document.createDocumentFragment();
    desired.forEach((el) => frag.appendChild(el));
    list.replaceChildren(frag);
  }
  hydrateRemoteIcons(list);
}

function ingest(data: any[]): void {
  if (!Array.isArray(data)) return;
  if (orderSaving) {
    heldSnapshot = data;
    return;
  }
  systems = data;
  paint();
}

async function loadOnce(): Promise<void> {
  try {
    const data = await getJSON<any[]>(`/api/metrics?t=${Date.now()}`);
    ingest(data);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      redirectToLogin('/admin');
      return;
    }
    if (!rendered) list.innerHTML = `<div class="py-12 text-center text-[13px] text-[var(--crit)]">${esc(t('admin.loadFailed'))}<div class="t-3 text-[12px] mt-1">${esc(err instanceof Error ? err.message : String(err))}</div></div>`;
  }
}

/* ------------------------------------------------------------------ */
/* Drag & drop reorder                                                  */
/* ------------------------------------------------------------------ */
let dragging: HTMLElement | null = null;
let dropTarget: { el: HTMLElement; before: boolean } | null = null;

function clearDropMarks(): void {
  list.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
}

function wireDrag(el: HTMLElement): void {
  el.querySelectorAll('button, input, a').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
  });
  el.addEventListener('dragstart', (e) => {
    if ((e.target as HTMLElement).closest('button, input, a')) {
      e.preventDefault();
      return;
    }
    dragging = el;
    el.classList.add('dragging');
    e.dataTransfer?.setData('text/plain', el.dataset.id || '');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragging = null;
    dropTarget = null;
    clearDropMarks();
  });
  el.addEventListener('dragover', (e) => {
    if (!dragging || dragging === el) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const r = el.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    clearDropMarks();
    el.classList.add(before ? 'drop-before' : 'drop-after');
    dropTarget = { el, before };
    autoScroll(e.clientY);
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragging || !dropTarget || dragging === el) return;
    const target = dropTarget;
    clearDropMarks();
    list.insertBefore(dragging, target.before ? target.el : target.el.nextSibling);
    const order = Array.from(list.children).map((c) => (c as HTMLElement).dataset.id || '').filter(Boolean);
    saveOrder(order);
  });
}

function autoScroll(y: number): void {
  const margin = 80;
  const speed = 14;
  if (y < margin) window.scrollBy({ top: -speed });
  else if (y > window.innerHeight - margin) window.scrollBy({ top: speed });
}

async function saveOrder(order: string[]): Promise<void> {
  orderSaving = true;
  try {
    await sendJSON('PUT', '/api/metrics/order', { order });
    toast(t('admin.orderSaved'), 'ok', 1800);
  } catch (err) {
    fail(err, 'admin.orderSaveFailed');
  } finally {
    orderSaving = false;
    heldSnapshot = null;
    await loadOnce();
  }
}

/* ------------------------------------------------------------------ */
/* Row actions                                                          */
/* ------------------------------------------------------------------ */
function rowRaw(target: HTMLElement): any | null {
  const row = target.closest<HTMLElement>('.admin-row');
  if (!row || !row.dataset.id) return null;
  return rows.get(row.dataset.id)?.raw || null;
}

function wireList(): void {
  list.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const copyBtn = target.closest<HTMLElement>('[data-copy]');
    if (copyBtn) {
      const ok = await copyText(copyBtn.getAttribute('data-copy') || '');
      flashCopied(copyBtn, ok, t('common.copied'), t('common.copyFailed'));
      return;
    }
    const act = target.closest<HTMLElement>('[data-act]');
    if (!act) return;
    const s = rowRaw(act);
    if (!s) return;
    switch (act.dataset.act) {
      case 'edit':
        openEdit(s);
        break;
      case 'delete':
        openDelete(s);
        break;
      case 'linux': {
        const ok = await copyText(linuxCommand(s));
        flashCopied(act, ok, t('common.copied'), t('common.copyFailed'));
        break;
      }
      case 'windows': {
        const ok = await copyText(windowsCommand(s));
        flashCopied(act, ok, t('common.copied'), t('common.copyFailed'));
        break;
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Add / edit / delete                                                  */
/* ------------------------------------------------------------------ */
function showError(id: string, msg: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function busy(form: HTMLFormElement, on: boolean): void {
  form.querySelectorAll<HTMLButtonElement>('button[type=submit]').forEach((b) => (b.disabled = on));
}

function setupAdd(): void {
  const form = document.getElementById('add-form') as HTMLFormElement;
  const m = modals.add;
  document.getElementById('add-btn')?.addEventListener('click', () => {
    form.reset();
    showError('add-error', '');
    m.open();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
    if (!name) {
      showError('add-error', t('admin.form.nameRequired'));
      return;
    }
    busy(form, true);
    try {
      let existing: any[] = systems;
      try {
        existing = await getJSON<any[]>('/api/metrics');
      } catch {}
      let max = 0;
      (Array.isArray(existing) ? existing : []).forEach((s) => {
        const m2 = String(s.id || '').match(/\d+/);
        if (m2) max = Math.max(max, parseInt(m2[0], 10));
      });
      await sendJSON('POST', '/api/metrics', {
        id: String(max + 1),
        name,
        cpu: 0,
        memory: 0,
        disk: 0,
        net_in_mb_s: 0,
        net_out_mb_s: 0,
        agent_version: '1.0.0',
        alert: false,
      });
      m.close();
      toast(t('admin.added'), 'ok');
      await loadOnce();
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return redirectToLogin('/admin');
      showError('add-error', t('admin.form.addFailed', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      busy(form, false);
    }
  });
}

function openEdit(s: any): void {
  const form = document.getElementById('edit-form') as HTMLFormElement;
  (form.elements.namedItem('id') as HTMLInputElement).value = String(s.id);
  (form.elements.namedItem('name') as HTMLInputElement).value = s.name || '';
  (form.elements.namedItem('tags') as HTMLInputElement).value = Array.isArray(s.tags) ? s.tags.join(', ') : '';
  (form.elements.namedItem('show_on_home') as HTMLInputElement).checked = s.hide_on_home !== true;
  (form.elements.namedItem('show_tcping') as HTMLInputElement).checked = s.hide_tcping !== true;
  const idLabel = document.getElementById('edit-id-label');
  if (idLabel) idLabel.textContent = `ID ${s.id}`;
  showError('edit-error', '');
  modals.edit.open();
}

function setupEdit(): void {
  const form = document.getElementById('edit-form') as HTMLFormElement;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = (form.elements.namedItem('id') as HTMLInputElement).value.trim();
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
    const tagsRaw = (form.elements.namedItem('tags') as HTMLInputElement).value;
    if (!id || !name) {
      showError('edit-error', t('admin.form.nameRequired'));
      return;
    }
    const tags = tagsRaw.split(',').map((x) => x.trim()).filter(Boolean);
    busy(form, true);
    try {
      await sendJSON('POST', '/api/metrics', {
        id,
        name,
        cpu: 0,
        memory: 0,
        disk: 0,
        net_in_mb_s: 0,
        net_out_mb_s: 0,
        agent_version: '1.0.0',
        alert: false,
        tags,
        hide_on_home: !(form.elements.namedItem('show_on_home') as HTMLInputElement).checked,
        hide_tcping: !(form.elements.namedItem('show_tcping') as HTMLInputElement).checked,
      });
      modals.edit.close();
      toast(t('admin.updated'), 'ok');
      await loadOnce();
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return redirectToLogin('/admin');
      showError('edit-error', t('admin.form.updateFailed', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      busy(form, false);
    }
  });
}

let pendingDelete: any = null;
function openDelete(s: any): void {
  pendingDelete = s;
  const txt = document.getElementById('delete-text');
  if (txt) txt.textContent = t('admin.deleteModal.desc', { name: s.name || s.id });
  modals.delete.open();
}

function setupDelete(): void {
  const btn = document.getElementById('delete-confirm') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    if (!pendingDelete) return;
    const id = String(pendingDelete.id);
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = t('common.deleting');
    try {
      await sendJSON('DELETE', `/api/metrics/${encodeURIComponent(id)}`);
      modals.delete.close();
      toast(t('admin.deleted'), 'ok');
      pendingDelete = null;
      await loadOnce();
    } catch (err) {
      fail(err, 'admin.deleteFailed');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */
type STab = 'general' | 'display' | 'privacy' | 'tcping';
let stab: STab = 'general';
let navbarCfg: any = {};
let privacyCfg: any = {};
let pendingShareToken = '';
let pendingShareSeconds = 0;
let secretPending = false;

function $(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function showSTab(tab: STab): void {
  stab = tab;
  document.querySelectorAll<HTMLElement>('[data-stab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.stab === tab)));
  document.querySelectorAll<HTMLElement>('[data-spanel]').forEach((p) => (p.hidden = p.dataset.spanel !== tab));
  showError('settings-error', '');
}

function randomToken(len: number, chars: string): string {
  const bytesArr = new Uint8Array(len);
  crypto.getRandomValues(bytesArr);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytesArr[i] % chars.length];
  return out;
}

function targetRow(target: { name: string; address: string } = { name: '', address: '' }): HTMLElement {
  const div = document.createElement('div');
  div.className = 'target-row grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2';
  div.innerHTML = `
    <input class="input input-sm t-name" data-i18n-placeholder="tcping.targetName" value="${attr(target.name)}" />
    <input class="input input-sm t-addr mono" placeholder="8.8.8.8:53" value="${attr(target.address)}" />
    <button type="button" class="btn btn-sm t-remove" title="${attr(t('tcping.remove'))}">${icon('x', 13)}<span class="sm:hidden" data-i18n="tcping.remove"></span></button>`;
  div.querySelector('.t-remove')?.addEventListener('click', () => div.remove());
  applyI18n(div);
  return div;
}

function renderShareState(cfg: any): void {
  const wrap = document.getElementById('s-share-current') as HTMLElement;
  const link = $('s-share-link');
  const exp = document.getElementById('s-share-expires') as HTMLElement;
  const token = cfg.share_token || '';
  if (!token) {
    wrap.hidden = true;
    link.value = '';
    exp.textContent = '';
    return;
  }
  wrap.hidden = false;
  link.value = `${window.location.origin}/?token=${token}`;
  if (cfg.token_expires) {
    const expires = new Date(cfg.token_expires);
    const serverNow = cfg.server_time ? new Date(cfg.server_time) : new Date();
    const expired = cfg.token_expired === true || expires.getTime() - serverNow.getTime() <= 1000;
    exp.textContent = expired ? t('privacy.expired') : t('privacy.expires', { when: dateTime(expires) });
    exp.className = `field-hint ${expired ? 'text-[var(--crit)]' : ''}`;
  } else {
    exp.textContent = '';
  }
}

async function loadSettings(): Promise<void> {
  const [nav, priv, tcp] = await Promise.all([
    getJSON('/api/navbar/config').catch(() => ({})),
    getJSON('/api/privacy/config').catch(() => ({})),
    getJSON('/api/tcping/config').catch(() => ({})),
  ]);
  navbarCfg = nav || {};
  privacyCfg = priv || {};
  secretPending = false;
  pendingShareToken = privacyCfg.share_token || '';
  pendingShareSeconds = 0;

  $('s-text').value = navbarCfg.text || 'Pulse';
  $('s-logo').value = navbarCfg.logo || '';
  $('s-secret').value = navbarCfg.shared_secret || '';
  $('s-secret').classList.remove('border-[var(--warn)]');
  (document.getElementById('s-secret-note') as HTMLElement).hidden = true;
  $('s-show-cards').checked = navbarCfg.hide_cards !== true;
  $('s-show-tags').checked = navbarCfg.hide_tags !== true;
  $('s-show-traffic').checked = navbarCfg.show_traffic === true;
  $('s-glass').checked = navbarCfg.show_glass === true;
  let code = '';
  if (navbarCfg.custom_css && String(navbarCfg.custom_css).trim()) code += '<' + 'style>\n' + navbarCfg.custom_css + '\n</' + 'style>';
  if (navbarCfg.custom_js && String(navbarCfg.custom_js).trim()) {
    if (code) code += '\n\n';
    code += String(navbarCfg.custom_js).includes('<' + 'script') ? navbarCfg.custom_js : '<' + 'script>\n' + navbarCfg.custom_js + '\n</' + 'script>';
  }
  $('s-code').value = code;

  $('s-privacy').checked = privacyCfg.enabled === true;
  (document.getElementById('s-share') as HTMLElement).style.opacity = privacyCfg.enabled ? '1' : '0.55';
  $('s-share-hours').value = String(Math.max(1, Math.round((Number(privacyCfg.expires_in_seconds) || 3600) / 3600)));
  renderShareState(privacyCfg);

  $('s-tcp-interval').value = String(Number(tcp?.interval_secs) || 60);
  const container = document.getElementById('s-tcp-targets') as HTMLElement;
  container.innerHTML = '';
  let targets: any[] = Array.isArray(tcp?.targets) ? tcp.targets : [];
  if (targets.length && typeof targets[0] === 'string') targets = targets.map((a) => ({ name: a, address: a }));
  if (!targets.length) container.appendChild(targetRow());
  targets.forEach((x) => container.appendChild(targetRow(x)));
}

function collectNavbar(): any {
  const code = $('s-code').value || '';
  let css = '';
  let js = '';
  for (const m of code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += m[1] + '\n';
  const tag = 'script';
  const re = new RegExp('<' + tag + '([^>]*)>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  for (const m of code.matchAll(re)) {
    if (m[1].includes('src=')) js += m[0] + '\n';
    else js += '<' + tag + '>\n' + m[2].trim() + '\n</' + tag + '>\n';
  }
  if (!css && !js && code.trim()) {
    // Untagged input: best-effort split (CSS-looking lines vs JS-looking lines).
    let isCss = false;
    for (const line of code.split('\n')) {
      const tr = line.trim();
      if (tr.startsWith('/*') || tr.startsWith('.') || tr.startsWith('#') || tr.includes('{')) isCss = true;
      else if (/^(\/\/|function|var |let |const |console\.)/.test(tr)) isCss = false;
      if (isCss) css += line + '\n';
      else if (tr) js += line + '\n';
    }
  }
  return {
    text: $('s-text').value.trim() || 'Pulse',
    logo: $('s-logo').value.trim(),
    shared_secret: $('s-secret').value,
    custom_css: css.trim(),
    custom_js: js.trim(),
    show_traffic: $('s-show-traffic').checked,
    show_glass: $('s-glass').checked,
    hide_tags: !$('s-show-tags').checked,
    hide_cards: !$('s-show-cards').checked,
  };
}

async function saveSettings(): Promise<void> {
  const btn = document.getElementById('settings-save') as HTMLButtonElement;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = t('common.saving');
  showError('settings-error', '');
  try {
    if (stab === 'general' || stab === 'display') {
      await sendJSON('POST', '/api/navbar/config', collectNavbar());
      toast(t('settings.saved'), 'ok');
      modals.settings.close();
      window.setTimeout(() => window.location.reload(), 300);
      return;
    }
    if (stab === 'privacy') {
      const payload: any = {
        enabled: $('s-privacy').checked,
        share_token: pendingShareToken,
        expires_in_seconds: pendingShareSeconds,
      };
      if (!(pendingShareSeconds > 0) && privacyCfg.token_expires) payload.token_expires = privacyCfg.token_expires;
      const res = await sendJSON('POST', '/api/privacy/config', payload);
      if (res && res.config) {
        privacyCfg = res.config;
        pendingShareSeconds = 0;
        renderShareState(privacyCfg);
      }
      toast(t('settings.saved'), 'ok');
      modals.settings.close();
      return;
    }
    if (stab === 'tcping') {
      const interval = parseInt($('s-tcp-interval').value || '60', 10);
      const targets: Array<{ name: string; address: string }> = [];
      document.querySelectorAll<HTMLElement>('#s-tcp-targets .target-row').forEach((r) => {
        const name = (r.querySelector('.t-name') as HTMLInputElement).value.trim();
        const address = (r.querySelector('.t-addr') as HTMLInputElement).value.trim();
        if (address) targets.push({ name: name || address, address });
      });
      await sendJSON('POST', '/api/tcping/config', { targets, interval_secs: interval });
      toast(t('settings.saved'), 'ok');
      modals.settings.close();
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return redirectToLogin('/admin');
    showError('settings-error', t('settings.saveFailed', { msg: err instanceof Error ? err.message : String(err) }));
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function setupSettings(): void {
  document.getElementById('settings-btn')?.addEventListener('click', async () => {
    showSTab('general');
    modals.settings.open();
    try {
      await loadSettings();
    } catch (err) {
      fail(err, 'settings.saveFailed');
    }
  });
  document.querySelectorAll<HTMLElement>('[data-stab]').forEach((b) => b.addEventListener('click', () => showSTab(b.dataset.stab as STab)));
  document.getElementById('settings-save')?.addEventListener('click', saveSettings);

  document.getElementById('s-secret-copy')?.addEventListener('click', async (e) => {
    const ok = await copyText($('s-secret').value);
    flashCopied(e.currentTarget as HTMLElement, ok, t('common.copied'), t('common.copyFailed'));
  });
  document.getElementById('s-secret-regen')?.addEventListener('click', () => modals.regen.open());
  document.getElementById('regen-confirm')?.addEventListener('click', () => {
    modals.regen.close();
    $('s-secret').value = randomToken(12, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
    $('s-secret').classList.add('border-[var(--warn)]');
    secretPending = true;
    const note = document.getElementById('s-secret-note') as HTMLElement;
    note.textContent = t('settings.regenerated');
    note.hidden = false;
  });

  $('s-privacy').addEventListener('change', () => {
    (document.getElementById('s-share') as HTMLElement).style.opacity = $('s-privacy').checked ? '1' : '0.55';
  });
  document.getElementById('s-share-generate')?.addEventListener('click', () => {
    const hours = parseInt($('s-share-hours').value || '1', 10);
    if (!(hours >= 1 && hours <= 720)) {
      showError('settings-error', t('privacy.invalidHours'));
      return;
    }
    pendingShareToken = randomToken(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    pendingShareSeconds = hours * 3600;
    const est = new Date(Date.now() + pendingShareSeconds * 1000);
    renderShareState({ share_token: pendingShareToken, token_expires: est.toISOString(), server_time: new Date().toISOString() });
    const exp = document.getElementById('s-share-expires') as HTMLElement;
    exp.textContent = `${t('privacy.expires', { when: dateTime(est) })} ${t('privacy.estimated')}`;
  });
  document.getElementById('s-share-revoke')?.addEventListener('click', () => {
    pendingShareToken = '';
    pendingShareSeconds = 0;
    renderShareState({});
  });
  document.getElementById('s-share-copy')?.addEventListener('click', async (e) => {
    const ok = await copyText($('s-share-link').value);
    flashCopied(e.currentTarget as HTMLElement, ok, t('common.copied'), t('common.copyFailed'));
  });
  document.getElementById('s-tcp-add')?.addEventListener('click', () => {
    const c = document.getElementById('s-tcp-targets') as HTMLElement;
    const row = targetRow();
    c.appendChild(row);
    (row.querySelector('.t-name') as HTMLInputElement)?.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Password / backup / logout / refresh                                 */
/* ------------------------------------------------------------------ */
function setupPassword(): void {
  const form = document.getElementById('password-form') as HTMLFormElement;
  document.getElementById('password-btn')?.addEventListener('click', () => {
    form.reset();
    showError('password-error', '');
    modals.password.open();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = (form.elements.namedItem('current') as HTMLInputElement).value.trim();
    const nw = (form.elements.namedItem('new') as HTMLInputElement).value.trim();
    const cf = (form.elements.namedItem('confirm') as HTMLInputElement).value.trim();
    if (!cur || !nw || !cf) return showError('password-error', t('password.fill'));
    if (nw.length < 6) return showError('password-error', t('password.minLength'));
    if (nw !== cf) return showError('password-error', t('password.mismatch'));
    busy(form, true);
    try {
      const res = await sendJSON('POST', '/api/auth/change-password', { currentPassword: cur, newPassword: nw });
      if (!res || res.success !== true) throw new Error(t('common.error'));
      modals.password.close();
      toast(t('password.changed'), 'ok');
    } catch (err) {
      if (err instanceof HttpError && err.status === 401 && !/change-password/.test(String(err.body))) {
        // Wrong current password also yields 401 from this endpoint; show inline.
        showError('password-error', t('password.failed', { msg: err.body || err.message }));
      } else {
        showError('password-error', t('password.failed', { msg: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      busy(form, false);
    }
  });
}

function setupBackup(): void {
  const btn = document.getElementById('backup-btn') as HTMLButtonElement;
  btn?.addEventListener('click', async () => {
    const token = adminToken();
    if (!token) return redirectToLogin('/admin');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('animate-pulse');
    try {
      const res = await fetch(apiBase() + '/api/admin/backup', { headers: { Authorization: 'Bearer ' + token } });
      if (res.status === 401) return redirectToLogin('/admin');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const disp = res.headers.get('Content-Disposition') || '';
      const m = disp.match(/filename=([^;]+)/);
      const pad = (n: number) => (n < 10 ? '0' + n : String(n));
      const d = new Date();
      let filename = `pulse-backup-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z.db`;
      if (m && m[1]) filename = m[1].replace(/^"|"$/g, '').trim();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      toast(t('admin.backupFailed', { msg: err instanceof Error ? err.message : String(err) }), 'err', 5000);
    } finally {
      btn.disabled = false;
      btn.classList.remove('animate-pulse');
    }
  });
}

function setupMisc(): void {
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    clearAdminToken();
    window.location.href = '/login?redirect=' + encodeURIComponent('/admin');
  });
  const refresh = document.getElementById('refresh-btn') as HTMLButtonElement;
  refresh?.addEventListener('click', async () => {
    if (refresh.disabled) return;
    refresh.disabled = true;
    refresh.querySelector('svg')?.classList.add('animate-spin-smooth');
    try {
      await loadOnce();
    } finally {
      window.setTimeout(() => {
        refresh.disabled = false;
        refresh.querySelector('svg')?.classList.remove('animate-spin-smooth');
      }, 500);
    }
  });
}

/* ------------------------------------------------------------------ */
/* SSE                                                                  */
/* ------------------------------------------------------------------ */
let sessionLostHandled = false;
async function sessionLost(): Promise<void> {
  if (sessionLostHandled) return;
  sessionLostHandled = true;
  try {
    const token = adminToken() || '';
    const res = await fetch(apiBase() + '/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const d = res.ok ? await res.json() : { valid: false };
    if (d && d.valid) {
      sessionLostHandled = false;
      sse?.connect();
      return;
    }
  } catch {}
  redirectToLogin('/admin');
}

function startStream(): void {
  let pending: any[] | null = null;
  let timer: number | null = null;
  sse = new SSEClient({
    onUpdate: (u) => {
      if (!u || typeof u !== 'object') return;
      if (u.type === 'metric_updated') {
        if (u.view === 'public') {
          sessionLost();
          return;
        }
        if (Array.isArray(u.systems)) {
          pending = u.systems;
          if (timer) return;
          timer = window.setTimeout(() => {
            timer = null;
            const l = pending;
            pending = null;
            if (l) ingest(l);
          }, 80);
        } else loadOnce();
      } else if (u.type === 'metric_deleted') {
        loadOnce();
      }
    },
  });
  sse.connect();
  window.setTimeout(() => {
    if (!rendered) loadOnce();
  }, 2500);
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */
async function boot(): Promise<void> {
  list = document.getElementById('admin-list') as HTMLElement;
  applyI18n(document);
  const ok = await gate();
  if (!ok) return;
  revealPage();

  ['add', 'edit', 'delete', 'settings', 'regen', 'password'].forEach((k) => {
    modals[k] = new Modal(document.getElementById(`${k}-modal`) as HTMLElement);
  });
  wireList();
  setupAdd();
  setupEdit();
  setupDelete();
  setupSettings();
  setupPassword();
  setupBackup();
  setupMisc();
  startStream();

  window.addEventListener('pulse:lang', () => {
    rows.clear();
    list.innerHTML = '';
    paint();
    applyI18n(document);
  });
  window.addEventListener('beforeunload', () => sse?.close());
  document.documentElement.setAttribute('data-lang', getLang());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
