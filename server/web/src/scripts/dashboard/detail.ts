/**
 * Server detail dialog: header, tabs (overview / hardware / tcping),
 * live patching while open, keyboard navigation and hash deep-links.
 */
import { esc, attr, copyText, flashCopied, sepsHtml, sepsText } from '../core/dom';
import { bytes, capacityPair, dateTime, relativeAgo, speedMiB, uptimeLong } from '../core/format';
import { icon, hydrateRemoteIcons } from '../core/icons';
import { applyI18n, getLang, t } from '../core/i18n';
import { Modal, topModal } from '../core/modal';
import { fillClass, healthPill, locationHtml, osHtml } from './row';
import { renderTags, patchLiveTags } from './tags';
import { cpuSummary, diskSummary, memorySummary, nicSummary, renderHardware, renderIssues, syncScrollHints, systemRows, updateScrollHint } from './hardware';
import { TCPingPanel, latestLatencyHtml, prefetchTCPingHistory, tcpingConfigured } from './tcping';
import type { Server } from './state';

type Tab = 'overview' | 'hardware' | 'tcping';

export interface DetailHost {
  get(id: string): Server | null;
  neighbors(id: string): { prev: string | null; next: string | null };
  showTraffic(): boolean;
  showTags(): boolean;
  /** Fetch the host's hardware inventory if it is missing or stale. */
  loadHardware(id: string): void;
  hardwareStatus(id: string): 'loading' | 'failed' | 'idle';
  /** Resolves when the host's inventory is here (or cannot come within `ms`). */
  hardwareReady(id: string, ms: number): Promise<void>;
}

export function idFromHash(): string | null {
  const m = window.location.hash.match(/^#server\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * "Updated 5s ago" changes width as time passes. Every form it can take sits
 * invisibly in the same place (see .meta-steady), so the part keeps one width
 * and the info line, which wraps on a phone, never rewraps under the reader.
 */
function updatedHtml(iso: string, zh: boolean): string {
  const now = Date.now();
  const forms = [0, 59e3, 3599e3, 86399e3, 999 * 86400e3].map((ms) => relativeAgo(new Date(now - ms).toISOString(), zh));
  const text = (ago: string) => esc(t('detail.updated', { t: ago }));
  const at = new Date(iso);
  return `<span class="meta-steady"${isNaN(at.getTime()) ? '' : ` title="${attr(dateTime(at))}"`}><span>${text(relativeAgo(iso, zh))}</span>${forms
    .map((f) => `<span aria-hidden="true">${text(f)}</span>`)
    .join('')}</span>`;
}

/**
 * The markup each live part of the overview was last drawn from. A part is
 * redrawn only when that changes: the browser writes markup back its own way
 * (U+00A0 as &nbsp;), so comparing with innerHTML would redraw it on every
 * update and drop a selection in progress, such as an IP being copied.
 */
const drawnFrom = new WeakMap<Element, string>();

function draw(e: Element | null, html: string): void {
  if (!e || drawnFrom.get(e) === html) return;
  e.innerHTML = html;
  drawnFrom.set(e, html);
}

/**
 * Key/value rows: while the same keys are listed, only the values that
 * changed are redrawn, so the live rates do not take the IP rows (and a
 * selection in them) along every few seconds.
 */
function drawRows(dl: Element | null, rows: Array<[string, string]>): void {
  if (!dl) return;
  const dts = dl.querySelectorAll(':scope > dt');
  const dds = dl.querySelectorAll(':scope > dd');
  if (dts.length === rows.length && dds.length === rows.length && rows.every(([k], i) => dts[i].textContent === k)) {
    rows.forEach(([, v], i) => draw(dds[i], v));
    return;
  }
  draw(dl, rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join(''));
  dl.querySelectorAll(':scope > dd').forEach((dd, i) => drawnFrom.set(dd, rows[i][1]));
}

/** The system card; one that has nothing to list says why. */
function kvHtml(rows: Array<[string, string]>, s: Server): string {
  if (!rows.length) return `<dt class="t-3" style="grid-column:1/-1">${esc(t(s.reported ? 'detail.noHardware' : 'detail.noReport'))}</dt>`;
  return rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('');
}

export class DetailDialog {
  private modal: Modal;
  private root: HTMLElement;
  private host: DetailHost;
  private id: string | null = null;
  private current: Server | null = null;
  private issuesOpen = false; // long issue lists start collapsed
  private sensorOpen = new Set<string>(); // sensor groups expanded by the user (temp duplicates, voltage rails)
  private tab: Tab = 'overview';
  private hwSig = '';
  private hwRenderedFor = '';
  /** Bumped by every open(), so only the latest of overlapping opens shows. */
  private openSeq = 0;
  private tcpSig = '';
  private tcping: TCPingPanel;
  private tcpingMounted = false;
  private hashOwned = false;
  private suppressPop = false;

  constructor(host: DetailHost) {
    this.host = host;
    this.root = document.getElementById('server-dialog') as HTMLElement;
    this.root.innerHTML = this.shell();
    applyI18n(this.root);
    this.modal = new Modal(this.root, { onClose: () => this.onClosed() });
    this.tcping = new TCPingPanel(this.q('panel-tcping'));
    this.q('tabs').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (b) this.showTab(b.dataset.tab as Tab);
    });
    // Heading for the TCPing tab: start fetching its chart now.
    const tpTab = this.root.querySelector<HTMLElement>('[data-tab="tcping"]');
    for (const ev of ['pointerenter', 'pointerdown', 'focus']) {
      tpTab?.addEventListener(ev, () => {
        if (this.current && !this.tcpingMounted) prefetchTCPingHistory(this.current);
      });
    }
    this.q('prev').addEventListener('click', () => this.step(-1));
    this.q('next').addEventListener('click', () => this.step(1));
    this.q('copy').addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLElement;
      const ok = await copyText(this.current?.name || '');
      flashCopied(btn, ok, t('common.copied'), t('common.copyFailed'));
    });
    // On the document, like Escape (see modal.ts): focus may have fallen out.
    document.addEventListener('keydown', (e) => {
      if (topModal() !== this.modal || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
    });
    this.root.addEventListener('click', (e) => {
      const sb = (e.target as HTMLElement).closest<HTMLElement>('[data-sensor-toggle]');
      if (sb && this.current) {
        const key = sb.dataset.sensorToggle || '';
        if (this.sensorOpen.has(key)) this.sensorOpen.delete(key);
        else this.sensorOpen.add(key);
        this.q('panel-hardware').innerHTML = renderHardware(this.current, this.sensorOpen);
        syncScrollHints(this.q('panel-hardware'));
        return;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-issues-toggle]');
      if (!btn || !this.current) return;
      this.issuesOpen = !this.issuesOpen;
      const box = this.q('panel-overview').querySelector<HTMLElement>('[data-o="issues"]');
      if (box) box.innerHTML = renderIssues(this.current, this.issuesOpen);
    });
    // Wide hardware tables: keep the edge fade in step with the scroll position.
    this.root.addEventListener(
      'scroll',
      (e) => {
        const el = e.target as HTMLElement;
        if (el.classList && el.classList.contains('dtable-scroll')) updateScrollHint(el);
      },
      true,
    );
    window.addEventListener('resize', () => {
      if (this.modal.isOpen && this.tab === 'hardware') syncScrollHints(this.q('panel-hardware'));
    });
    window.addEventListener('pulse:lang', () => {
      applyI18n(this.root);
      if (this.modal.isOpen && this.current) this.rerender();
    });
    window.addEventListener('popstate', () => {
      if (this.suppressPop) {
        this.suppressPop = false;
        return;
      }
      const id = idFromHash();
      if (!id && this.modal.isOpen) {
        this.hashOwned = false;
        this.modal.close();
      } else if (id && id !== this.id) {
        this.open(id, false);
      }
    });
  }

  private q(f: string): HTMLElement {
    return this.root.querySelector(`[data-d="${f}"]`) as HTMLElement;
  }

  get openId(): string | null {
    return this.modal.isOpen ? this.id : null;
  }

  open(id: string, pushHash = true, waitMs = 600): boolean {
    const s = this.host.get(id);
    if (!s) return false;
    const seq = ++this.openSeq;
    if (s.hasHw && !s.hardware) {
      // The inventory is not here yet (the page has only just loaded, or the
      // host has only now started reporting one): give it a moment, so the
      // dialog opens complete instead of growing rows when it lands.
      this.host.loadHardware(id);
      this.host.hardwareReady(id, waitMs).then(() => {
        if (seq === this.openSeq) this.show(id, pushHash);
      });
      return true;
    }
    this.show(id, pushHash);
    return true;
  }

  private show(id: string, pushHash: boolean): void {
    const s = this.host.get(id);
    if (!s) return;
    if (id !== this.id) {
      this.issuesOpen = false;
      this.sensorOpen.clear();
    }
    const switching = this.modal.isOpen && this.id !== id;
    this.id = id;
    this.current = s;
    this.hwSig = '';
    this.hwRenderedFor = '';
    this.host.loadHardware(id);
    this.tcpSig = '';
    if (this.tcpingMounted) {
      this.tcping.unmount();
      this.tcpingMounted = false;
    }
    this.renderHeader(s);
    this.renderOverview(s);
    this.renderHardware(s);
    this.syncTabs(s);
    if (!this.modal.isOpen) {
      this.tab = 'overview';
      this.modal.open();
    }
    this.showTab(this.availableTab(this.tab, s));
    if (switching) this.q('body').scrollTop = 0;
    if (pushHash) {
      if (this.hashOwned) history.replaceState({ server: id }, '', '#server/' + encodeURIComponent(id));
      else history.pushState({ server: id }, '', '#server/' + encodeURIComponent(id));
      this.hashOwned = true;
    }
    this.syncNav(id);
  }

  close(): void {
    this.modal.close();
  }

  /** Live update from the SSE stream. `s` is null when the server was removed. */
  update(s: Server | null): void {
    if (!this.modal.isOpen) return;
    if (!s) {
      this.modal.close();
      return;
    }
    this.host.loadHardware(s.id);
    this.current = s;
    this.renderHeader(s);
    this.patchOverview(s);
    if (this.hwKey(s) !== this.hwSig) this.renderHardware(s);
    this.syncTabs(s);
    if (this.tab === 'tcping' && this.tcpingMounted && s.tcpingSig !== this.tcpSig) {
      this.tcpSig = s.tcpingSig;
      this.tcping.refresh(s.tcpingSig);
    }
    this.syncNav(s.id);
  }

  /** TCPing config changed server-side: remount the chart if visible. */
  tcpingConfigChanged(): void {
    if (!this.current) return;
    if (this.tcpingMounted) {
      this.tcping.unmount();
      this.tcpingMounted = false;
    }
    this.syncTabs(this.current);
    if (this.tab === 'tcping') this.showTab('tcping');
  }

  private syncNav(id: string): void {
    const nb = this.host.neighbors(id);
    this.q('prev').toggleAttribute('disabled', !nb.prev);
    this.q('next').toggleAttribute('disabled', !nb.next);
  }

  private step(dir: -1 | 1): void {
    if (!this.id) return;
    const nb = this.host.neighbors(this.id);
    const target = dir < 0 ? nb.prev : nb.next;
    if (target) this.open(target, true);
  }

  private onClosed(): void {
    if (this.tcpingMounted) {
      this.tcping.unmount();
      this.tcpingMounted = false;
    }
    this.id = null;
    this.current = null;
    if (idFromHash()) {
      if (this.hashOwned) {
        this.suppressPop = true;
        history.back();
      } else {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    this.hashOwned = false;
  }

  private rerender(): void {
    if (!this.current) return;
    this.renderHeader(this.current);
    this.renderOverview(this.current);
    this.renderHardware(this.current);
    this.syncTabs(this.current);
    if (this.tcpingMounted) {
      this.tcping.unmount();
      this.tcpingMounted = false;
      this.showTab(this.tab);
    }
  }

  private availableTab(tab: Tab, s: Server): Tab {
    if (tab === 'hardware' && !s.hasHw) return 'overview';
    if (tab === 'tcping' && (s.hideTcping || !tcpingConfigured())) return 'overview';
    return tab;
  }

  private syncTabs(s: Server): void {
    const hwBtn = this.root.querySelector<HTMLElement>('[data-tab="hardware"]');
    const tpBtn = this.root.querySelector<HTMLElement>('[data-tab="tcping"]');
    if (hwBtn) {
      hwBtn.hidden = !s.hasHw;
      const badge = hwBtn.querySelector<HTMLElement>('.count');
      if (badge) {
        badge.textContent = String(s.issues.length);
        badge.hidden = !s.issues.length;
        badge.classList.toggle('is-crit', s.health === 'critical');
      }
    }
    if (tpBtn) tpBtn.hidden = s.hideTcping || !tcpingConfigured();
    if (this.availableTab(this.tab, s) !== this.tab) this.showTab('overview');
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    (['overview', 'hardware', 'tcping'] as Tab[]).forEach((k) => {
      this.q('panel-' + k).hidden = k !== tab;
    });
    // A hidden panel has no width to measure: settle the table edge fades now.
    if (tab === 'hardware') syncScrollHints(this.q('panel-hardware'));
    if (tab === 'tcping' && this.current) {
      if (!this.tcpingMounted) {
        this.tcpingMounted = true;
        this.tcpSig = this.current.tcpingSig || '';
        this.tcping.mount(this.current);
      } else {
        this.tcping.resize();
      }
    }
  }

  /* ---------------- rendering ---------------- */

  private renderHeader(s: Server): void {
    const zh = getLang() === 'zh';
    this.q('dot').className = `dot ${s.online ? 'dot-online' : 'dot-offline'}`;
    this.q('name').textContent = s.name;
    this.q('name').title = s.name;
    // No hardware health (a VPS, or a host that never reported): leave the
    // title alone instead of trailing it with a lone dash.
    this.q('health').innerHTML = s.health ? healthPill(s, 'md') : '';
    this.q('health').hidden = !s.health;
    this.q('type').hidden = true;
    const status = s.online ? `<span class="text-[var(--ok)]">${esc(t('common.online'))}</span>` : `<span class="text-[var(--crit)]">${esc(t('common.offline'))}</span>`;
    const typeText = s.type === 'DS' ? t('detail.type.DS') : s.type === 'VPS' ? t('detail.type.VPS') : s.type;
    const uptime = s.reported && s.online && s.uptime ? uptimeLong(s.uptime, zh) : '';
    // Only what the host has actually told us: a system added in the admin
    // page but never reached by its agent would otherwise read
    // "offline — — 0 h updated —", which says nothing.
    this.q('meta').innerHTML = [
      status,
      typeText ? `<span>${esc(typeText)}</span>` : '',
      s.os || s.osIcon ? osHtml(s, true) : '',
      s.location ? locationHtml(s, true) : '',
      // An offline host's last uptime describes nothing running; "updated … ago" below says when it was last seen.
      uptime ? `<span>${esc(t('detail.upFor', { t: uptime }))}</span>` : '',
      s.reported ? updatedHtml(s.updatedAt, zh) : `<span class="t-3">${esc(t('admin.noAgent'))}</span>`,
    ].filter(Boolean).join('');
    const tags = this.q('tags');
    const shown = this.host.showTags() ? s.tags : [];
    const sig = shown.join('\n');
    if (tags.getAttribute('data-sig') !== sig) {
      tags.innerHTML = shown.length ? renderTags(s) : '';
      tags.setAttribute('data-sig', sig);
      tags.hidden = !shown.length;
    } else {
      patchLiveTags(tags, s);
    }
    hydrateRemoteIcons(this.q('head'));
  }

  /**
   * The two lines under a card's figure, each a list of parts that wraps
   * between parts only (the first line of the CPU card is the model name,
   * which may wrap anywhere). An empty second line keeps its height.
   */
  private lines(a: string[], b: string[]): string {
    const line = (parts: string[]) => sepsText(parts) || '&nbsp;';
    return `<div class="mc-line">${a.length ? line(a) : '—'}</div><div class="mc-line">${line(b)}</div>`;
  }

  private memSub(s: Server): string {
    const l1 = s.memoryInfo ? [capacityPair(s.memoryInfo)] : [];
    if (l1.length && s.swapInfo && !/^0 B \/ 0 B$/.test(s.swapInfo)) l1.push(`${t('detail.swap')} ${capacityPair(s.swapInfo)}`);
    return this.lines(l1, memorySummary(s));
  }

  private cpuSub(s: Server): string {
    const c = cpuSummary(s);
    return `<div class="mc-line">${esc(c.model || '—')}</div><div class="mc-line">${sepsText(c.topo) || '&nbsp;'}</div>`;
  }

  private diskSub(s: Server): string {
    return this.lines(s.diskInfo ? [capacityPair(s.diskInfo)] : [], diskSummary(s));
  }

  private netRows(s: Server): Array<[string, string]> {
    const rows: Array<[string, string]> = [];
    // A host that never reported has no rates, only zero-filled defaults.
    const rate = (v: number) => (s.reported ? `<span class="tnum live-val">${esc(speedMiB(v))}</span>` : '<span class="t-3">—</span>');
    rows.push([t('detail.download'), rate(s.netIn)]);
    rows.push([t('detail.upload'), rate(s.netOut)]);
    const lat = latestLatencyHtml(s);
    if (lat) rows.push([t('detail.latency'), `<div class="live-val">${lat}</div>`]);
    const nics = nicSummary(s);
    if (nics.length) rows.push([t('detail.interfaces'), sepsText(nics)]);
    if (this.host.showTraffic()) {
      rows.push([
        t('detail.traffic'),
        s.reported ? sepsHtml([`↓ ${esc(bytes(s.totalIn))}`, `↑ ${esc(bytes(s.totalOut))}`].map((x) => x.replace(/ /g, '\u00a0'))) : '<span class="t-3">—</span>',
      ]);
    }
    if (s.raw?.ipv4) rows.push(['IPv4', `<span class="mono">${esc(s.raw.ipv4)}</span>`]);
    if (s.raw?.ipv6) rows.push(['IPv6', `<span class="mono">${esc(s.raw.ipv6)}</span>`]);
    return rows;
  }

  private renderOverview(s: Server): void {
    // A host that never reported has only zero-filled defaults: a dash and an
    // empty track, as in its list row, rather than "0.0%" that looks measured.
    const metric = (key: string, ic: string, field: string, v: number) => `
      <div class="metric-card">
        <div class="mc-head"><span class="inline-flex items-center gap-1.5">${icon(ic, 14)}${esc(t(key))}</span></div>
        <div class="mc-val live-val" data-o="${field}-val">${s.reported ? `${v.toFixed(1)}%` : '—'}</div>
        <div class="bigmeter-track"><div class="meter-fill ${fillClass(v, s.online)}" data-o="${field}-fill" style="width:${s.reported ? v.toFixed(1) : '0'}%"></div></div>
        <div class="mc-sub" data-o="${field}-sub"></div>
      </div>`;
    const sysCard = `
      <div class="subcard p-4">
        <div class="section-title">${icon('server', 14)}${esc(t('detail.system'))}</div>
        <dl class="kv" data-o="system"></dl>
      </div>`;
    const net = `
      <div class="subcard p-4">
        <div class="section-title">${icon('network', 14)}${esc(t('detail.network'))}</div>
        <dl class="kv" data-o="netkv"></dl>
      </div>`;
    // An offline host's figures are its last report: shown, but greyed.
    this.q('panel-overview').classList.toggle('is-stale', s.reported && !s.online);
    this.q('panel-overview').innerHTML = `
      <div data-o="issues" class="${s.issues.length ? 'issues-box mb-4' : ''}">${renderIssues(s, this.issuesOpen)}</div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        ${metric('detail.cpu', 'cpu', 'cpu', s.cpu)}
        ${metric('detail.memory', 'memory', 'mem', s.memory)}
        ${metric('detail.disk', 'hard-drive', 'disk', s.disk)}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">${net}${sysCard}</div>`;
    this.drawLive(s, true);
  }

  /** The overview's text parts that follow the live updates (see draw()). */
  private drawLive(s: Server, system: boolean): void {
    const p = this.q('panel-overview');
    const q = (f: string) => p.querySelector(`[data-o="${f}"]`);
    draw(q('cpu-sub'), this.cpuSub(s));
    draw(q('mem-sub'), this.memSub(s));
    draw(q('disk-sub'), this.diskSub(s));
    drawRows(q('netkv'), this.netRows(s));
    if (system) draw(q('system'), kvHtml(systemRows(s), s));
  }

  private patchOverview(s: Server): void {
    const p = this.q('panel-overview');
    p.classList.toggle('is-stale', s.reported && !s.online);
    const q = (f: string) => p.querySelector<HTMLElement>(`[data-o="${f}"]`);
    const bar = (field: string, v: number) => {
      const val = q(`${field}-val`);
      const fill = q(`${field}-fill`);
      const text = s.reported ? v.toFixed(1) + '%' : '—';
      if (val && val.textContent !== text) val.textContent = text;
      if (fill) {
        fill.style.width = (s.reported ? v.toFixed(1) : '0') + '%';
        fill.className = `meter-fill ${fillClass(v, s.online)}`;
      }
    };
    bar('cpu', s.cpu);
    bar('mem', s.memory);
    bar('disk', s.disk);
    this.drawLive(s, this.hwKey(s) !== this.hwSig || !s.hardware);
  }

  /** Changes whenever the hardware panel must be redrawn, loading state included. */
  private hwKey(s: Server): string {
    return s.hardware ? s.hwSig : `${s.hasHw ? this.host.hardwareStatus(s.id) : 'none'}|${s.health}|${s.issues.join(';')}`;
  }

  private renderHardware(s: Server): void {
    const panel = this.q('panel-hardware');
    // Every new collection redraws the tables (about once a minute): keep each
    // wide table where the reader had scrolled it, for the same host only.
    const scrolled = this.hwRenderedFor === s.id ? [...panel.querySelectorAll<HTMLElement>('.dtable-scroll')].map((e) => e.scrollLeft) : [];
    this.hwRenderedFor = s.id;
    // Until the inventory has arrived the panel says so; "idle" without one
    // means the host no longer has an inventory and gets the usual note.
    const status = s.hasHw && !s.hardware ? this.host.hardwareStatus(s.id) : 'idle';
    panel.innerHTML =
      status === 'loading'
        ? `<div class="subcard p-6 flex items-center justify-center gap-2 text-[13px] t-3"><span class="spinner"></span>${esc(t('detail.hwLoading'))}</div>`
        : status === 'failed'
          ? `<div class="subcard p-6 text-center text-[13px] t-3">${esc(t('detail.hwFailed'))}</div>`
          : renderHardware(s, this.sensorOpen);
    panel.querySelectorAll<HTMLElement>('.dtable-scroll').forEach((e, i) => {
      if (scrolled[i]) e.scrollLeft = scrolled[i];
    });
    if (this.tab === 'hardware') syncScrollHints(panel);
    this.hwSig = this.hwKey(s);
    const issues = this.q('panel-overview').querySelector<HTMLElement>('[data-o="issues"]');
    if (issues) {
      issues.innerHTML = renderIssues(s, this.issuesOpen);
      issues.className = s.issues.length ? 'issues-box mb-4' : '';
    }
    draw(this.q('panel-overview').querySelector('[data-o="system"]'), kvHtml(systemRows(s), s));
  }

  private shell(): string {
    return `
<div class="modal-backdrop"></div>
<div class="modal-panel is-xl" role="dialog" aria-modal="true" aria-labelledby="server-dialog-title">
  <div class="modal-head" data-d="head">
    <div class="min-w-0 flex-1">
      <div class="title-line">
        <span class="dot" data-d="dot"></span>
        <h2 class="modal-title truncate min-w-0 max-w-full" id="server-dialog-title" data-d="name"></h2>
        <span data-d="health" hidden></span>
        <span data-d="type" hidden></span>
      </div>
      <div class="meta-line mt-1.5" data-d="meta"></div>
      <div class="flex flex-wrap gap-1 mt-2.5" data-d="tags" hidden></div>
    </div>
    <div class="flex items-center gap-0.5 shrink-0 -mr-1.5 -mt-0.5">
      <button type="button" class="icon-btn" data-d="prev" data-i18n-title="common.previous">${icon('chevron-left', 17)}</button>
      <button type="button" class="icon-btn" data-d="next" data-i18n-title="common.next">${icon('chevron-right', 17)}</button>
      <button type="button" class="icon-btn" data-d="copy" data-i18n-title="dash.copyName"><span class="i-copy">${icon('copy', 15)}</span><span class="i-check text-[var(--ok)]" hidden>${icon('check', 15)}</span></button>
      <button type="button" class="icon-btn" data-modal-close data-i18n-title="common.close">${icon('x', 18)}</button>
    </div>
  </div>
  <div class="px-4 sm:px-5 pt-3 shrink-0">
    <div class="tabs" role="tablist" data-d="tabs">
      <button type="button" class="tab" role="tab" data-tab="overview" aria-selected="true">${icon('gauge', 13)}<span data-i18n="detail.tab.overview"></span></button>
      <button type="button" class="tab" role="tab" data-tab="hardware" aria-selected="false">${icon('cpu', 13)}<span data-i18n="detail.tab.hardware"></span><span class="count" hidden></span></button>
      <button type="button" class="tab" role="tab" data-tab="tcping" aria-selected="false">${icon('radio', 13)}<span data-i18n="detail.tab.tcping"></span></button>
    </div>
  </div>
  <div class="modal-body" data-d="body">
    <div data-d="panel-overview"></div>
    <div data-d="panel-hardware" hidden></div>
    <div data-d="panel-tcping" hidden></div>
  </div>
</div>`;
  }
}
