/** One server row: initial render + in-place patching for live updates. */
import { esc, attr } from '../core/dom';
import { dateTime, sinceShort, speedMiB, uptimeLong, uptimeShort } from '../core/format';
import { flagIcon, icon, osGlyph, remoteIconHtml } from '../core/icons';
import { getLang, t } from '../core/i18n';
import type { HealthKey, Server } from './state';

export function fillClass(v: number, online: boolean): string {
  if (!online) return 'fill-off';
  if (v >= 90) return 'fill-crit';
  if (v >= 80) return 'fill-high';
  if (v >= 70) return 'fill-mid';
  return 'fill-ok';
}

export function healthPill(s: Server, _size: 'sm' | 'md' = 'sm'): string {
  const k: HealthKey = s.health;
  if (!k) return `<span class="health-text health-unknown" title="${attr(t('dash.stat.noHardware'))}">—</span>`;
  const cls = k === 'ok' ? 'health-ok' : k === 'warn' ? 'health-warn' : k === 'critical' ? 'health-crit' : 'health-unknown';
  const n = s.issues.length;
  const label = k === 'ok' ? t('health.ok') : k === 'unknown' ? t('health.unknown') : n === 1 ? t('health.issue') : t('health.issues', { n });
  const title = [k === 'warn' ? t('health.warn') : k === 'critical' ? t('health.critical') : '', ...s.issues].filter(Boolean).join('\n');
  return `<span class="health-text ${cls}" title="${attr(title)}">${esc(label)}</span>`;
}

// A host that has never reported has no readings, only zero-filled defaults:
// show a dash and an empty track rather than "0.0%" that looks measured.
function meter(field: string, label: string, v: number, s: Server): string {
  const shown = s.reported ? `${v.toFixed(1)}%` : '—';
  const width = s.reported ? v.toFixed(1) : '0';
  return `<span class="m-label">${esc(label)}</span><div class="meter"><span class="meter-val" data-f="${field}-val">${shown}</span><div class="meter-track"><div class="meter-fill ${fillClass(v, s.online)}" data-f="${field}-fill" style="width:${width}%"></div></div></div>`;
}

function netHtml(s: Server): string {
  if (!s.reported) return '<span class="t-3">—</span>';
  return `<span class="net-dir"><span class="t-3">↓</span><span data-f="net-in">${esc(speedMiB(s.netIn))}</span></span><span class="net-dir"><span class="t-3">↑</span><span data-f="net-out">${esc(speedMiB(s.netOut))}</span></span>`;
}

// What the uptime slot says: the uptime while online; for a host that went
// offline, how long ago it last reported ("离线 3 小时") — its last uptime no
// longer describes anything running; nothing for a host that never reported.
function uptimeState(s: Server, zh: boolean): { text: string; title: string } {
  if (!s.reported) return { text: '', title: '' };
  if (s.online) return { text: uptimeShort(s.uptime, zh), title: uptimeLong(s.uptime, zh) };
  const since = sinceShort(s.updatedAt, zh);
  const at = Date.parse(s.updatedAt);
  return {
    text: since ? t('dash.offlineFor', { t: since }) : t('common.offline'),
    title: Number.isFinite(at) && at > 0 ? t('dash.lastReport', { t: dateTime(new Date(at)) }) : '',
  };
}

export function locationHtml(s: Server, withText = false): string {
  if (!s.location) return `<span class="t-3 text-[12px]">—</span>`;
  const f = flagIcon(s.location);
  const flag = f ? remoteIconHtml(f, 'flag-icon', s.location, withText ? '' : 'text') : '';
  const text = withText || !f ? `<span class="text-[12px] t-2">${esc(s.location)}</span>` : '';
  return `<span class="inline-flex items-center gap-1.5" title="${attr(s.location)}">${flag}${text}</span>`;
}

export function osHtml(s: Server, withText = false): string {
  if (!s.osIcon && !s.os) return `<span class="t-3 text-[12px]">—</span>`;
  // Every host gets a mark in the narrow OS column: its distribution's glyph,
  // or a neutral monitor when neither the name nor the agent's icon is known.
  const glyph = osGlyph(s.os, s.osIcon);
  const ic = glyph ? remoteIconHtml(glyph, 'os-icon', s.os, 'monitor') : `<span class="os-icon">${icon('monitor', 16, 't-3')}</span>`;
  const text = withText ? `<span class="text-[12px] t-2 truncate">${esc(s.os || '—')}</span>` : '';
  return `<span class="inline-flex items-center gap-1.5 min-w-0" title="${attr(s.os)}">${ic}${text}</span>`;
}

// Everything the narrow-screen meta line depends on, so a patch rewrites it
// only when something it shows has changed (the offline duration included).
function metaKey(s: Server): string {
  const zh = getLang() === 'zh';
  return [s.os, s.osIcon, s.location, s.reported, s.online, s.online ? s.uptime : uptimeState(s, zh).text].join('|');
}

function metaHtml(s: Server): string {
  // Narrow-screen meta line: only the facts the host has reported, so a
  // system that never connected does not show a row of dashes.
  const zh = getLang() === 'zh';
  const when = !s.reported ? '' : s.online ? uptimeLong(s.uptime, zh) : uptimeState(s, zh).text;
  const parts = [s.os || s.osIcon ? osHtml(s, true) : '', s.location ? locationHtml(s, true) : '', when ? `<span>${esc(when)}</span>` : ''];
  return parts.filter(Boolean).join('');
}

export function renderRow(s: Server, _opts: { showTags: boolean }): string {
  const zh = getLang() === 'zh';
  const statusLabel = s.online ? t('common.online') : t('common.offline');
  const up = uptimeState(s, zh);
  return `
<div class="srv-row ${s.online ? '' : 'is-offline'}" role="button" tabindex="0" data-id="${attr(s.id)}" aria-label="${attr(s.name)} · ${attr(statusLabel)}">
  <div class="c-name flex items-center gap-2.5 min-w-0">
    <span class="dot ${s.online ? 'dot-online' : 'dot-offline'}" data-f="dot" title="${attr(statusLabel)}"></span>
    <span class="srv-name" data-f="name" title="${attr(s.name)}">${esc(s.name)}</span>
    <button type="button" class="copy-btn icon-btn icon-btn-sm shrink-0" data-copy-name="${attr(s.name)}" title="${attr(t('dash.copyName'))}" aria-label="${attr(t('dash.copyName'))}">
      <span class="i-copy">${icon('copy', 12)}</span><span class="i-check" hidden>${icon('check', 12)}</span>
    </button>
  </div>
  <div class="c-health" data-f="health">${healthPill(s)}</div>
  <div class="c-uptime cell-num" data-f="uptime"${up.title ? ` title="${attr(up.title)}"` : ''}>${up.text ? esc(up.text) : '<span class="t-3">—</span>'}</div>
  <div class="c-loc" data-f="loc">${locationHtml(s)}</div>
  <div class="c-cpu">${meter('cpu', t('dash.col.cpu'), s.cpu, s)}</div>
  <div class="c-mem">${meter('mem', t('dash.col.memory'), s.memory, s)}</div>
  <div class="c-disk">${meter('disk', t('dash.col.disk'), s.disk, s)}</div>
  <div class="c-net"><span class="m-label">${esc(t('dash.col.net'))}</span><div class="net cell-num" data-f="net">${netHtml(s)}</div></div>
  <div class="c-os flex justify-center" data-f="os">${osHtml(s)}</div>
  <div class="c-meta" data-f="meta" data-k="${attr(metaKey(s))}">${metaHtml(s)}</div>
</div>`;
}

/**
 * Patch a rendered row in place. `prev` is the previously rendered model (or
 * null). A change of `reported` is not patched here: the caller re-renders
 * the row, since a never-reported row has no readings to update.
 */
export function patchRow(el: HTMLElement, s: Server, prev: Server | null, _opts: { showTags: boolean }): void {
  const q = (f: string) => el.querySelector<HTMLElement>(`[data-f="${f}"]`);
  const changed = (k: keyof Server) => !prev || prev[k] !== s[k];

  if (changed('online')) {
    el.classList.toggle('is-offline', !s.online);
    const dot = q('dot');
    if (dot) {
      dot.className = `dot ${s.online ? 'dot-online' : 'dot-offline'}`;
      dot.title = s.online ? t('common.online') : t('common.offline');
    }
    el.setAttribute('aria-label', `${s.name} · ${s.online ? t('common.online') : t('common.offline')}`);
  }
  if (changed('name')) {
    const n = q('name');
    if (n) {
      n.textContent = s.name;
      n.title = s.name;
    }
    const c = el.querySelector<HTMLElement>('[data-copy-name]');
    if (c) c.setAttribute('data-copy-name', s.name);
  }
  const healthChanged = !prev || prev.health !== s.health || prev.issues.join('|') !== s.issues.join('|');
  if (healthChanged) {
    const h = q('health');
    if (h) h.innerHTML = healthPill(s);
  }
  const meta = q('meta');
  if (meta) {
    const k = metaKey(s);
    if (meta.getAttribute('data-k') !== k) {
      meta.innerHTML = metaHtml(s);
      meta.setAttribute('data-k', k);
    }
  }
  // Checked on every snapshot: an offline host's "离线 3 分钟" keeps counting.
  const u = q('uptime');
  if (u && s.reported) {
    const up = uptimeState(s, getLang() === 'zh');
    if (u.textContent !== up.text) u.textContent = up.text;
    if (up.title) u.title = up.title;
    else u.removeAttribute('title');
  }
  if (changed('location')) {
    const l = q('loc');
    if (l) l.innerHTML = locationHtml(s);
  }
  const bar = (field: 'cpu' | 'mem' | 'disk', v: number) => {
    const val = q(`${field}-val`);
    const fill = q(`${field}-fill`);
    const txt = v.toFixed(1) + '%';
    if (val && val.textContent !== txt) val.textContent = txt;
    if (fill) {
      fill.style.width = v.toFixed(1) + '%';
      const cls = `meter-fill ${fillClass(v, s.online)}`;
      if (fill.className !== cls) fill.className = cls;
    }
  };
  if (s.reported) {
    if (changed('cpu') || changed('online')) bar('cpu', s.cpu);
    if (changed('memory') || changed('online')) bar('mem', s.memory);
    if (changed('disk') || changed('online')) bar('disk', s.disk);
  }
  if (s.reported && (changed('netIn') || changed('netOut'))) {
    const i = q('net-in');
    const o = q('net-out');
    if (i) i.textContent = speedMiB(s.netIn);
    if (o) o.textContent = speedMiB(s.netOut);
  }
  if (changed('os') || changed('osIcon')) {
    const o = q('os');
    if (o) o.innerHTML = osHtml(s);
  }
}
