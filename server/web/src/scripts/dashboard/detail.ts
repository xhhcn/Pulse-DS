/**
 * Server detail dialog: header, tabs (overview / hardware / tcping),
 * live patching while open, keyboard navigation and hash deep-links.
 */
import { esc, attr, copyText, flashCopied } from '../core/dom';
import { bytes, relativeAgo, speedMiB, uptimeLong } from '../core/format';
import { icon, hydrateRemoteIcons } from '../core/icons';
import { applyI18n, getLang, t } from '../core/i18n';
import { Modal } from '../core/modal';
import { fillClass, healthPill, locationHtml, osHtml } from './row';
import { renderTags, patchLiveTags } from './tags';
import { cpuSummary, diskSummary, memorySummary, nicSummary, renderHardware, renderIssues, systemRows } from './hardware';
import { TCPingPanel, latestLatencyText, tcpingConfigured } from './tcping';
import type { Server } from './state';

type Tab = 'overview' | 'hardware' | 'tcping';

export interface DetailHost {
  get(id: string): Server | null;
  neighbors(id: string): { prev: string | null; next: string | null };
  showTraffic(): boolean;
  showTags(): boolean;
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

function kvHtml(rows: Array<[string, string]>): string {
  if (!rows.length) return `<dt class="t-3" style="grid-column:1/-1">${esc(t('detail.noHardware'))}</dt>`;
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
    this.q('prev').addEventListener('click', () => this.step(-1));
    this.q('next').addEventListener('click', () => this.step(1));
    this.q('copy').addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLElement;
      const ok = await copyText(this.current?.name || '');
      flashCopied(btn, ok, t('common.copied'), t('common.copyFailed'));
    });
    this.root.addEventListener('keydown', (e) => {
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
        return;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-issues-toggle]');
      if (!btn || !this.current) return;
      this.issuesOpen = !this.issuesOpen;
      const box = this.q('panel-overview').querySelector<HTMLElement>('[data-o="issues"]');
      if (box) box.innerHTML = renderIssues(this.current, this.issuesOpen);
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

  open(id: string, pushHash = true): boolean {
    if (id !== this.id) {
      this.issuesOpen = false;
      this.sensorOpen.clear();
    }
    const s = this.host.get(id);
    if (!s) return false;
    const switching = this.modal.isOpen && this.id !== id;
    this.id = id;
    this.current = s;
    this.hwSig = '';
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
    return true;
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
    this.current = s;
    this.renderHeader(s);
    this.patchOverview(s);
    if (s.hwSig !== this.hwSig) this.renderHardware(s);
    this.syncTabs(s);
    if (this.tab === 'tcping' && this.tcpingMounted && s.tcpingSig !== this.tcpSig) {
      this.tcpSig = s.tcpingSig;
      this.tcping.refresh();
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
    if (tab === 'hardware' && !s.hardware) return 'overview';
    if (tab === 'tcping' && (s.hideTcping || !tcpingConfigured())) return 'overview';
    return tab;
  }

  private syncTabs(s: Server): void {
    const hwBtn = this.root.querySelector<HTMLElement>('[data-tab="hardware"]');
    const tpBtn = this.root.querySelector<HTMLElement>('[data-tab="tcping"]');
    if (hwBtn) {
      hwBtn.hidden = !s.hardware;
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
    this.q('health').innerHTML = healthPill(s, 'md');
    this.q('type').hidden = true;
    const status = s.online ? `<span class="text-[var(--ok)]">${esc(t('common.online'))}</span>` : `<span class="text-[var(--crit)]">${esc(t('common.offline'))}</span>`;
    const typeText = s.type === 'DS' ? t('detail.type.DS') : s.type === 'VPS' ? t('detail.type.VPS') : s.type;
    this.q('meta').innerHTML = [
      status,
      typeText ? `<span>${esc(typeText)}</span>` : '',
      osHtml(s, true),
      locationHtml(s, true),
      `<span title="${attr(t('detail.uptime'))}">${esc(uptimeLong(s.uptime, zh))}</span>`,
      `<span title="${attr(s.updatedAt)}">${esc(t('detail.updated'))} ${esc(relativeAgo(s.updatedAt, zh))}</span>`,
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

  private lines(a: string, b: string): string {
    return `<div class="mc-line">${esc(a || '—')}</div><div class="mc-line">${b ? esc(b) : '&nbsp;'}</div>`;
  }

  private memSub(s: Server): string {
    let l1 = s.memoryInfo || '—';
    if (s.swapInfo && !/^0 B \/ 0 B$/.test(s.swapInfo)) l1 += ` · ${t('detail.swap')} ${s.swapInfo}`;
    return this.lines(l1, memorySummary(s));
  }

  private cpuSub(s: Server): string {
    const c = cpuSummary(s);
    return this.lines(c.model, c.topo);
  }

  private diskSub(s: Server): string {
    return this.lines(s.diskInfo || '—', diskSummary(s));
  }

  private netRows(s: Server): Array<[string, string]> {
    const rows: Array<[string, string]> = [];
    rows.push([t('detail.download'), `<span class="tnum">${esc(speedMiB(s.netIn))}</span>`]);
    rows.push([t('detail.upload'), `<span class="tnum">${esc(speedMiB(s.netOut))}</span>`]);
    const lat = latestLatencyText(s);
    if (lat) rows.push([t('detail.latency'), esc(lat)]);
    const nics = nicSummary(s);
    if (nics) rows.push([t('detail.interfaces'), esc(nics)]);
    if (this.host.showTraffic()) rows.push([t('detail.traffic'), `↓ ${esc(bytes(s.totalIn))} <span class="t-3">·</span> ↑ ${esc(bytes(s.totalOut))}`]);
    if (s.raw?.ipv4) rows.push(['IPv4', `<span class="mono">${esc(s.raw.ipv4)}</span>`]);
    if (s.raw?.ipv6) rows.push(['IPv6', `<span class="mono">${esc(s.raw.ipv6)}</span>`]);
    return rows;
  }

  private renderOverview(s: Server): void {
    const metric = (key: string, ic: string, field: string, v: number, sub: string) => `
      <div class="metric-card">
        <div class="mc-head"><span class="inline-flex items-center gap-1.5">${icon(ic, 14)}${esc(t(key))}</span></div>
        <div class="mc-val" data-o="${field}-val">${v.toFixed(1)}%</div>
        <div class="bigmeter-track"><div class="meter-fill ${fillClass(v, s.online)}" data-o="${field}-fill" style="width:${v.toFixed(1)}%"></div></div>
        <div class="mc-sub" data-o="${field}-sub">${sub}</div>
      </div>`;
    const sysCard = `
      <div class="subcard p-4">
        <div class="section-title">${icon('server', 14)}${esc(t('detail.system'))}</div>
        <dl class="kv" data-o="system">${kvHtml(systemRows(s))}</dl>
      </div>`;
    const net = `
      <div class="subcard p-4">
        <div class="section-title">${icon('network', 14)}${esc(t('detail.network'))}</div>
        <dl class="kv" data-o="netkv">${this.netRows(s).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      </div>`;
    this.q('panel-overview').innerHTML = `
      <div data-o="issues" class="${s.issues.length ? 'issues-box mb-4' : ''}">${renderIssues(s, this.issuesOpen)}</div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        ${metric('detail.cpu', 'cpu', 'cpu', s.cpu, this.cpuSub(s))}
        ${metric('detail.memory', 'memory', 'mem', s.memory, this.memSub(s))}
        ${metric('detail.disk', 'hard-drive', 'disk', s.disk, this.diskSub(s))}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">${net}${sysCard}</div>`;
  }

  private patchOverview(s: Server): void {
    const p = this.q('panel-overview');
    const q = (f: string) => p.querySelector<HTMLElement>(`[data-o="${f}"]`);
    const bar = (field: string, v: number) => {
      const val = q(`${field}-val`);
      const fill = q(`${field}-fill`);
      if (val) val.textContent = v.toFixed(1) + '%';
      if (fill) {
        fill.style.width = v.toFixed(1) + '%';
        fill.className = `meter-fill ${fillClass(v, s.online)}`;
      }
    };
    bar('cpu', s.cpu);
    bar('mem', s.memory);
    bar('disk', s.disk);
    const set = (f: string, v: string) => {
      const e = q(f);
      if (e && e.textContent !== v) e.textContent = v;
    };
    const setHtml = (f: string, html: string) => {
      const e = q(f);
      if (e && e.innerHTML !== html) e.innerHTML = html;
    };
    setHtml('cpu-sub', this.cpuSub(s));
    setHtml('mem-sub', this.memSub(s));
    setHtml('disk-sub', this.diskSub(s));
    setHtml('netkv', this.netRows(s).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join(''));
    if (s.hwSig !== this.hwSig || !s.hardware) {
      const sys = q('system');
      if (sys) sys.innerHTML = kvHtml(systemRows(s));
    }
  }

  private renderHardware(s: Server): void {
    this.q('panel-hardware').innerHTML = renderHardware(s, this.sensorOpen);
    this.hwSig = s.hwSig;
    const issues = this.q('panel-overview').querySelector<HTMLElement>('[data-o="issues"]');
    if (issues) {
      issues.innerHTML = renderIssues(s, this.issuesOpen);
      issues.className = s.issues.length ? 'issues-box mb-4' : '';
    }
    const sys = this.q('panel-overview').querySelector<HTMLElement>('[data-o="system"]');
    if (sys) sys.innerHTML = kvHtml(systemRows(s));
  }

  private shell(): string {
    return `
<div class="modal-backdrop"></div>
<div class="modal-panel is-xl" role="dialog" aria-modal="true" aria-labelledby="server-dialog-title">
  <div class="modal-head" data-d="head">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2.5 flex-wrap min-w-0">
        <span class="dot" data-d="dot"></span>
        <h2 class="modal-title truncate max-w-full" id="server-dialog-title" data-d="name"></h2>
        <span data-d="health"></span>
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
  <div class="px-5 pt-3 shrink-0">
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
