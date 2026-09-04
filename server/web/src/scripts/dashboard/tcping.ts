/**
 * TCPing panel for the detail dialog.
 *
 *   title · covered time span                 average · packet loss
 *   [target: now / avg / loss] [target …] [target …]
 *   chart (SVG polylines, one colour per target)
 *
 * The chart is plain SVG: the browser rasterises it at the display's native
 * resolution exactly like the surrounding text, so lines and tick labels stay
 * crisp on any pixel ratio, zoom level or scaled display — none of the canvas
 * backing-store pitfalls, and no chart library to ship. Data comes from
 * /api/tcping/history (last 24 h) and is re-fetched when a new sample lands.
 */
import { esc, attr } from '../core/dom';
import { getJSON } from '../core/api';
import { dateTime, timeHM } from '../core/format';
import { t } from '../core/i18n';
import type { Server } from './state';

export interface TCPingTarget {
  name: string;
  address: string;
}
export interface TCPingConfig {
  targets: TCPingTarget[];
  interval_secs: number;
}

const PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#f97316', '#06b6d4', '#84cc16', '#eab308'];
const LOSS_MS = 1000;
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/* ------------------------------------------------------------------ */
/* Config cache                                                         */
/* ------------------------------------------------------------------ */
let config: TCPingConfig | null = null;
let configPromise: Promise<TCPingConfig | null> | null = null;

export async function getTCPingConfig(force = false): Promise<TCPingConfig | null> {
  if (config && !force) return config;
  if (configPromise && !force) return configPromise;
  const p = getJSON<TCPingConfig>('/api/tcping/config')
    .then((c) => {
      let targets: any[] = Array.isArray(c?.targets) ? c.targets : [];
      if (targets.length && typeof targets[0] === 'string') targets = targets.map((a) => ({ name: a, address: a }));
      config = { targets: targets.filter((x) => x && x.address), interval_secs: Number(c?.interval_secs) || 60 };
      return config;
    })
    .catch(() => null)
    .finally(() => {
      if (configPromise === p) configPromise = null;
    });
  configPromise = p;
  return p;
}

export function tcpingConfigured(): boolean {
  return !!(config && config.targets.length);
}

export function invalidateTCPingConfig(): void {
  config = null;
}

function targetName(address: string): string {
  const tg = config?.targets.find((x) => x.address === address);
  return tg?.name || address;
}

/** "Cloudflare 1.6 ms · GitHub 17 ms" from the server's latest samples. */
export function latestLatencyText(s: Server): string {
  const d = s.raw?.tcping_data;
  if (!d || typeof d !== 'object') return '';
  const order = config?.targets.map((x) => x.address) || Object.keys(d);
  const parts: string[] = [];
  for (const addr of order) {
    const v = d[addr];
    if (!v) continue;
    const lat = Number(v.latency);
    const ok = Number.isFinite(lat) && lat > 0 && lat <= LOSS_MS;
    parts.push(`${targetName(addr)} ${ok ? lat.toFixed(lat < 10 ? 1 : 0) + ' ms' : t('tcping.timeout')}`);
  }
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Panel                                                                */
/* ------------------------------------------------------------------ */
interface Point {
  x: number;
  y: number | null;
}
/** One probe cycle: every target's sample (null = timeout) under a shared x. */
interface Cluster {
  x: number;
  vals: Map<string, number | null>;
}
interface TargetStats {
  latest: number | null;
  hasLatest: boolean;
  avg: number;
  loss: number;
  count: number;
}
/** Pixel geometry of the last render, used to resolve hover positions. */
interface Layout {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  xs: number[]; // pixel x of every cluster
  y: (ms: number) => number;
}

export class TCPingPanel {
  private root: HTMLElement;
  private systemId = '';
  private cfg: TCPingConfig | null = null;
  private active: string | null = null;
  private data = new Map<string, Point[]>();
  private clusters: Cluster[] = [];
  private layout: Layout | null = null;
  private hover = -1;
  private serverStats: { avg: number; loss: number } | null = null;
  private loading = false;
  private token = 0;
  private observer: ResizeObserver | null = null;
  private renderQueued = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** (Re)mount for a system. Safe to call again with the same id. */
  async mount(s: Server): Promise<void> {
    if (this.systemId === s.id && this.cfg) {
      this.resize();
      return;
    }
    this.teardown();
    this.systemId = s.id;
    const cfg = await getTCPingConfig();
    if (this.systemId !== s.id) return;
    if (!cfg || !cfg.targets.length) {
      this.root.innerHTML = `<div class="subcard p-6 text-center text-[13px] t-3">${esc(t('tcping.notConfigured'))}</div>`;
      return;
    }
    this.cfg = cfg;
    this.renderShell(cfg);
    await this.load(false);
  }

  unmount(): void {
    this.token++;
    this.teardown();
    this.systemId = '';
    this.loading = false;
    this.root.innerHTML = '';
  }

  /** The dialog switched to this tab or the box changed: redraw to the new size. */
  resize(): void {
    if (!this.cfg || this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderChart();
    });
  }

  /** Called when the server reports a new tcping sample for this system. */
  async refresh(): Promise<void> {
    if (!this.systemId || this.loading) return;
    await this.load(true);
  }

  private teardown(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.cfg = null;
    this.active = null;
    this.data.clear();
    this.clusters = [];
    this.layout = null;
    this.hover = -1;
    this.serverStats = null;
  }

  /* ---------------- shell ---------------- */

  private renderShell(cfg: TCPingConfig): void {
    const targets = cfg.targets
      .map(
        (tg, i) =>
          `<button type="button" class="tp-target" data-target="${attr(tg.address)}" aria-pressed="false" title="${attr(tg.address)}">
            <span class="tp-name"><span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span><span class="truncate">${esc(tg.name || tg.address)}</span></span>
            <span class="tp-stats"><span>${esc(t('tcping.latest'))} <b data-tp-latest>—</b></span><span>${esc(t('tcping.avg'))} <b data-tp-avg>—</b></span><span>${esc(t('tcping.loss'))} <b data-tp-loss>—</b></span></span>
          </button>`,
      )
      .join('');
    this.root.innerHTML = `
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <div class="section-title mb-0"><span>${esc(t('tcping.titleBase'))}</span><span class="n" data-tp="span"></span></div>
        <div class="flex items-center gap-4 text-[12px] t-3">
          <span>${esc(t('tcping.avg'))} <b class="t-1 tnum" data-tp="avg">—</b></span>
          <span>${esc(t('tcping.loss'))} <b class="t-1 tnum" data-tp="loss">—</b></span>
        </div>
      </div>
      <div class="tp-targets mb-3">${targets}</div>
      <div class="tp-frame" data-tp="frame">
        <div class="tp-status" data-tp="status"><span class="spinner"></span></div>
        <svg class="tp-svg is-hidden" data-tp="svg" role="img" aria-label="${attr(t('tcping.titleBase'))}"></svg>
        <div class="tp-tip" data-tp="tip" hidden></div>
      </div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => this.setActive(btn.dataset.target === this.active ? null : btn.dataset.target || null));
    });
    const frame = this.q('frame');
    frame.addEventListener('pointermove', (e) => this.onPointer(e));
    frame.addEventListener('pointerdown', (e) => this.onPointer(e));
    frame.addEventListener('pointerleave', () => this.setHover(-1));
    frame.addEventListener('pointercancel', () => this.setHover(-1));
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(frame);
    }
  }

  private q(name: string): HTMLElement {
    return this.root.querySelector(`[data-tp="${name}"]`) as HTMLElement;
  }

  private setActive(address: string | null): void {
    this.active = address;
    this.root.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.target === address));
    });
    this.renderChart();
    this.updateStats();
  }

  private status(html: string): void {
    const st = this.q('status');
    const svg = this.q('svg');
    if (st) {
      st.innerHTML = html;
      st.hidden = !html;
    }
    if (svg) svg.classList.toggle('is-hidden', !!html);
    if (html) this.setHover(-1);
  }

  /* ---------------- data ---------------- */

  private async load(incremental: boolean): Promise<void> {
    const id = this.systemId;
    const token = ++this.token;
    this.loading = true;
    try {
      const cfg = this.cfg;
      if (!cfg) return;
      let res: any;
      try {
        res = await getJSON(`/api/tcping/history?client_id=${encodeURIComponent(id)}`);
      } catch {
        if (!incremental && token === this.token) this.status(esc(t('common.noData')));
        return;
      }
      if (token !== this.token || this.systemId !== id) return;
      const results: any[] = Array.isArray(res) ? res : Array.isArray(res?.results) ? res.results : [];
      this.serverStats =
        res && !Array.isArray(res) && res.stats ? { avg: Number(res.stats.avg_latency) || 0, loss: Number(res.stats.packet_loss_rate) || 0 } : null;
      const cutoff = Date.now() - DAY;
      const byTarget = new Map<string, Point[]>();
      cfg.targets.forEach((tg) => byTarget.set(tg.address, []));
      for (const r of results) {
        const arr = byTarget.get(r.target);
        if (!arr) continue;
        const ts = Date.parse(r.timestamp);
        if (!Number.isFinite(ts) || ts < cutoff) continue;
        const lat = r.latency == null ? null : Number(r.latency);
        arr.push({ x: ts, y: lat == null || !Number.isFinite(lat) || lat <= 0 || lat > LOSS_MS ? null : lat });
      }
      byTarget.forEach((arr) => arr.sort((a, b) => a.x - b.x));
      this.data = byTarget;
      this.clusters = clusterSamples(byTarget, cfg.interval_secs);
      this.updateSpan();
      this.updateStats();
      if (!this.clusters.length) {
        if (incremental && this.layout) return;
        this.status(esc(t('tcping.noData')));
        return;
      }
      this.status('');
      this.renderChart();
    } finally {
      if (token === this.token) this.loading = false;
    }
  }

  private statsFor(address: string | null): TargetStats {
    let total = 0;
    let ok = 0;
    let sum = 0;
    let latest: number | null = null;
    let hasLatest = false;
    let latestTs = -1;
    this.data.forEach((points, addr) => {
      if (address && addr !== address) return;
      for (const p of points) {
        total++;
        if (p.y != null) {
          ok++;
          sum += p.y;
        }
      }
      const last = points[points.length - 1];
      if (last && last.x > latestTs) {
        latestTs = last.x;
        latest = last.y;
        hasLatest = true;
      }
    });
    return { latest, hasLatest, avg: ok ? sum / ok : 0, loss: total ? ((total - ok) / total) * 100 : 0, count: total };
  }

  private updateStats(): void {
    this.root.querySelectorAll<HTMLElement>('[data-target]').forEach((btn) => {
      const st = this.statsFor(btn.dataset.target || '');
      const set = (sel: string, v: string) => {
        const e = btn.querySelector<HTMLElement>(sel);
        if (e && e.textContent !== v) e.textContent = v;
      };
      set('[data-tp-latest]', !st.hasLatest ? '—' : st.latest == null ? t('tcping.timeout') : fmtMs(st.latest));
      set('[data-tp-avg]', st.count ? fmtMs(st.avg) : '—');
      set('[data-tp-loss]', st.count ? `${st.loss.toFixed(st.loss > 0 && st.loss < 1 ? 1 : 0)}%` : '—');
    });
    // Header totals: server-side stats for "all targets", client-side for a selection.
    const avgEl = this.q('avg');
    const lossEl = this.q('loss');
    const all = this.statsFor(this.active);
    let avg = all.avg;
    let loss = all.loss;
    if (!this.active && this.serverStats && this.serverStats.avg > 0) {
      avg = this.serverStats.avg;
      loss = this.serverStats.loss;
    }
    if (avgEl) avgEl.textContent = all.count ? fmtMs(avg) : '—';
    if (lossEl) lossEl.textContent = all.count ? `${loss.toFixed(2)}%` : '—';
  }

  private updateSpan(): void {
    const el = this.q('span');
    if (!el) return;
    let min = Infinity;
    let max = -Infinity;
    this.data.forEach((pts) => {
      if (pts.length) {
        min = Math.min(min, pts[0].x);
        max = Math.max(max, pts[pts.length - 1].x);
      }
    });
    if (!Number.isFinite(min)) {
      el.textContent = '';
      return;
    }
    const span = max - min;
    if (span >= 22 * 3600 * 1000) el.textContent = t('tcping.span24h');
    else if (span >= 3600 * 1000) el.textContent = t('tcping.spanHours', { n: Math.round(span / 3600000) });
    else el.textContent = t('tcping.spanMinutes', { n: Math.max(1, Math.round(span / MINUTE)) });
  }

  /* ---------------- chart ---------------- */

  private renderChart(): void {
    const cfg = this.cfg;
    const svg = this.q('svg') as unknown as SVGSVGElement | null;
    if (!cfg || !svg || !this.clusters.length) return;
    const box = svg.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (width < 40 || height < 40) return; // hidden tab; redrawn on resize

    // Scales.
    const clusters = this.clusters;
    let xMin = clusters[0].x;
    let xMax = clusters[clusters.length - 1].x;
    if (xMax - xMin < MINUTE) {
      xMin -= MINUTE / 2;
      xMax += MINUTE / 2;
    }
    let peak = 0;
    for (const c of clusters) c.vals.forEach((v) => (peak = v != null && v > peak ? v : peak));
    const { max: yMax, step } = niceMax(peak);
    const yLabels: number[] = [];
    for (let v = 0; v <= yMax + 1e-9; v += step) yLabels.push(v);
    const labelChars = Math.max(...yLabels.map((v) => `${fmtTick(v)} ms`.length));
    const left = 10 + Math.round(labelChars * 6.4);
    const right = width - 10;
    const top = 10;
    const bottom = height - 24;
    const x = (ts: number) => left + ((ts - xMin) / (xMax - xMin)) * (right - left);
    const y = (ms: number) => bottom - (ms / yMax) * (bottom - top);
    const xs = clusters.map((c) => x(c.x));
    this.layout = { width, height, left, right, top, bottom, xs, y };

    const parts: string[] = [];
    // Grid + y labels.
    parts.push('<g class="tp-grid">');
    for (const v of yLabels) {
      const py = Math.round(y(v)) + 0.5;
      parts.push(`<line x1="${left}" x2="${right}" y1="${py}" y2="${py}"${v === 0 ? ' class="tp-axis"' : ''}></line>`);
    }
    parts.push('</g><g class="tp-ylabels">');
    for (const v of yLabels) {
      parts.push(`<text x="${left - 8}" y="${y(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle">${fmtTick(v)} ms</text>`);
    }
    parts.push('</g><g class="tp-xlabels">');
    // About one label per 110 px, but never fewer than three even on a phone.
    for (const ts of timeTicks(xMin, xMax, Math.max(3, Math.floor((right - left) / 110)))) {
      const px = x(ts);
      const anchor = px < left + 28 ? 'start' : px > right - 28 ? 'end' : 'middle';
      parts.push(`<text x="${px.toFixed(1)}" y="${height - 7}" text-anchor="${anchor}">${esc(timeHM(new Date(ts)))}</text>`);
    }
    parts.push('</g><g class="tp-lines">');
    // One path per target; timeouts and missing cycles break the line.
    cfg.targets.forEach((tg, i) => {
      const color = PALETTE[i % PALETTE.length];
      const cls = !this.active ? 'tp-line' : tg.address === this.active ? 'tp-line is-active' : 'tp-line is-dim';
      let d = '';
      let run = 0;
      let lastPt = '';
      const dots: string[] = [];
      const flush = () => {
        // An isolated sample between two gaps has no segment: mark it with a dot.
        if (run === 1) dots.push(`<circle class="tp-dot" cx="${lastPt.split(',')[0]}" cy="${lastPt.split(',')[1]}" r="1.75" fill="${color}"></circle>`);
        run = 0;
      };
      clusters.forEach((c, k) => {
        const v = c.vals.get(tg.address);
        if (v == null) {
          flush();
          return;
        }
        const pt = `${xs[k].toFixed(1)},${y(v).toFixed(1)}`;
        d += (run === 0 ? 'M' : 'L') + pt;
        lastPt = pt;
        run++;
      });
      flush();
      parts.push(`<g class="${cls}"><path d="${d}" stroke="${color}"></path>${dots.join('')}</g>`);
    });
    parts.push('</g>');
    // Hover layer: crosshair + one marker per target (positioned on hover).
    parts.push(`<g class="tp-hover" data-tp="hover" style="display:none"><line class="tp-cross" x1="0" x2="0" y1="${top}" y2="${bottom}"></line>`);
    cfg.targets.forEach((tg, i) => {
      parts.push(`<circle class="tp-marker" data-marker="${attr(tg.address)}" r="3" stroke="${PALETTE[i % PALETTE.length]}" style="display:none"></circle>`);
    });
    parts.push('</g>');

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.innerHTML = parts.join('');
    if (this.hover >= 0) this.setHover(Math.min(this.hover, clusters.length - 1), true);
  }

  private onPointer(e: PointerEvent): void {
    const lay = this.layout;
    const svg = this.q('svg');
    if (!lay || !svg) return;
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < lay.left - 12 || px > lay.right + 12 || py < 0 || py > lay.height) {
      this.setHover(-1);
      return;
    }
    // Nearest cluster by x (xs is sorted).
    let lo = 0;
    let hi = lay.xs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lay.xs[mid] < px) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(lay.xs[lo - 1] - px) <= Math.abs(lay.xs[lo] - px)) lo--;
    this.setHover(lo, false, py);
  }

  /** Move the crosshair, markers and tooltip to cluster `idx` (-1 hides them). */
  private setHover(idx: number, force = false, pointerY?: number): void {
    const tip = this.q('tip');
    const hoverG = this.root.querySelector<SVGGElement>('[data-tp="hover"]');
    if (idx === this.hover && !force) {
      if (idx >= 0 && pointerY != null && tip) this.placeTip(tip, pointerY);
      return;
    }
    this.hover = idx;
    const lay = this.layout;
    const cfg = this.cfg;
    if (idx < 0 || !lay || !cfg || !hoverG || !tip) {
      if (hoverG) hoverG.style.display = 'none';
      if (tip) tip.hidden = true;
      return;
    }
    const c = this.clusters[idx];
    const px = lay.xs[idx];
    hoverG.style.display = '';
    const cross = hoverG.querySelector<SVGLineElement>('.tp-cross');
    if (cross) {
      const cx = String(Math.round(px) + 0.5);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
    }
    const rows: string[] = [];
    cfg.targets.forEach((tg, i) => {
      const marker = hoverG.querySelector<SVGCircleElement>(`[data-marker="${cssEscape(tg.address)}"]`);
      const v = c.vals.has(tg.address) ? c.vals.get(tg.address) : undefined;
      const shown = v !== undefined && (!this.active || tg.address === this.active);
      if (marker) {
        if (shown && v != null) {
          marker.style.display = '';
          marker.setAttribute('cx', px.toFixed(1));
          marker.setAttribute('cy', lay.y(v).toFixed(1));
        } else {
          marker.style.display = 'none';
        }
      }
      if (!shown) return;
      const value = v == null ? esc(t('tcping.timeout')) : `${v.toFixed(2)} ms`;
      rows.push(
        `<div class="tp-tip-row${v == null ? ' is-timeout' : ''}"><span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span><span>${esc(tg.name || tg.address)}</span><b>${value}</b></div>`,
      );
    });
    tip.innerHTML = `<div class="tp-tip-title">${esc(dateTime(new Date(c.x)))}</div>${rows.join('')}`;
    tip.hidden = false;
    this.placeTip(tip, pointerY ?? (lay.top + lay.bottom) / 2);
  }

  private placeTip(tip: HTMLElement, pointerY: number): void {
    const lay = this.layout;
    if (!lay || this.hover < 0) return;
    const frame = this.q('frame');
    const svg = this.q('svg');
    const fr = frame.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const offX = sr.left - fr.left;
    const offY = sr.top - fr.top;
    const px = lay.xs[this.hover];
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let leftPx = offX + px + 14;
    if (leftPx + w > fr.width - 6) leftPx = offX + px - 14 - w;
    if (leftPx < 6) leftPx = 6;
    let topPx = offY + pointerY - h / 2;
    topPx = Math.max(6, Math.min(fr.height - h - 6, topPx));
    tip.style.left = `${Math.round(leftPx)}px`;
    tip.style.top = `${Math.round(topPx)}px`;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/**
 * Group the per-target samples of one probe cycle under a single x value.
 * Targets are pinged together, so their timestamps differ by milliseconds;
 * anything closer than a third of the interval belongs to the same cycle.
 */
function clusterSamples(byTarget: Map<string, Point[]>, intervalSecs: number): Cluster[] {
  const tol = Math.max(2000, Math.min(10000, ((intervalSecs || 60) * 1000) / 3));
  const all: Array<{ x: number; addr: string; y: number | null }> = [];
  byTarget.forEach((pts, addr) => pts.forEach((p) => all.push({ x: p.x, addr, y: p.y })));
  all.sort((a, b) => a.x - b.x);
  const out: Cluster[] = [];
  let cur: Cluster | null = null;
  for (const s of all) {
    if (!cur || s.x - cur.x > tol || cur.vals.has(s.addr)) {
      cur = { x: s.x, vals: new Map() };
      out.push(cur);
    }
    cur.vals.set(s.addr, s.y);
  }
  return out;
}

/** Y axis: a round step with at most five labels (0 … max). */
function niceMax(peak: number): { max: number; step: number } {
  const v = peak > 0 ? peak : 1;
  for (const step of [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]) {
    if (v <= step * 4) return { max: Math.max(step, Math.ceil(v / step) * step), step };
  }
  return { max: Math.ceil(v / 5000) * 5000, step: 5000 };
}

/**
 * X axis: the finest round step (local-time minutes / hours) whose labels
 * inside the range still fit — so a narrow phone chart gets its three labels
 * instead of one stray hour mark.
 */
function timeTicks(min: number, max: number, maxLabels: number): number[] {
  const steps = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720, 1440].map((m) => m * MINUTE);
  const tz = new Date(min).getTimezoneOffset() * MINUTE;
  const ticksFor = (step: number): number[] => {
    const out: number[] = [];
    for (let ts = Math.ceil((min - tz) / step) * step + tz; ts <= max; ts += step) out.push(ts);
    return out;
  };
  for (const step of steps) {
    const ticks = ticksFor(step);
    if (ticks.length <= maxLabels) return ticks;
  }
  return ticksFor(steps[steps.length - 1]);
}

function fmtTick(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtMs(v: number): string {
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ms`;
}

function cssEscape(v: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');
}
