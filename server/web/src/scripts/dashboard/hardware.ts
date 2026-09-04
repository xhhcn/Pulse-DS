/** Hardware tab + issue list + system summary for the detail dialog. */
import { esc, attr } from '../core/dom';
import { bytes, bytesDecimal, cleanCpuModel, cpuTopology, hours, int, linkSpeed, num, speedMB, temp, timeHMS } from '../core/format';
import { icon } from '../core/icons';
import { getLang, t } from '../core/i18n';
import { fillClass } from './row';
import type { Server } from './state';

function pill(kind: 'ok' | 'warn' | 'crit' | 'unknown' | 'info', text: string): string {
  return `<span class="pill pill-sm pill-${kind}">${esc(text)}</span>`;
}

function section(key: string, iconName: string, count: number, body: string): string {
  return `<section class="mb-5 last:mb-0"><h3 class="section-title">${icon(iconName, 14)}<span>${esc(t(key))}</span>${count ? `<span class="n">${count}</span>` : ''}</h3>${body}</section>`;
}

function table(head: string[], rows: string[][], widths: string[] = []): string {
  const cols = widths.length ? `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : '';
  return `<div class="dtable-wrap"><table class="dtable">${cols}<thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function miniBar(v: number, width = 72): string {
  const p = Math.max(0, Math.min(100, Number(v) || 0));
  return `<span class="inline-flex items-center gap-2"><span class="meter-track" style="width:${width}px;max-width:${width}px"><span class="meter-fill ${fillClass(p, true)}" style="width:${p.toFixed(0)}%"></span></span><span>${p.toFixed(1)}%</span></span>`;
}


function cacheSize(v: string): string {
  const m = v.match(/^([\d.]+)\s*([KMG])?/i);
  if (!m) return v;
  let n = Number(m[1]);
  let u = (m[2] || 'K').toUpperCase();
  if (u === 'K' && n >= 1024) { n = n / 1024; u = 'M'; }
  if (u === 'M' && n >= 1024) { n = n / 1024; u = 'G'; }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${u}iB`;
}

function ghz(mhz: number): string {
  return `${(mhz / 1000).toFixed(mhz >= 10000 ? 0 : 2)} GHz`;
}

/**
 * CPU card: [model line, "4 cores · 8 threads · 3.5 GHz"]. Turbo clock,
 * cache and live frequency live in the hardware tab's summary section.
 */
export function cpuSummary(s: Server): { model: string; topo: string; base: number; max: number } {
  const c = s.hardware?.cpu;
  const raw = String(c?.model || s.cpuModel || '');
  const baseM = raw.match(/@\s*([\d.]+)\s*GHz/i);
  const base = baseM ? Number(baseM[1]) * 1000 : 0;
  const max = Number(c?.max_mhz) || 0;
  if (!c) return { model: cleanCpuModel(raw, false) || '—', topo: '', base, max };
  const parts: string[] = [];
  if (c.sockets > 1) parts.push(t('detail.sockets', { n: c.sockets }));
  if (c.cores) parts.push(t('detail.cores', { n: c.cores }));
  if (c.threads) parts.push(t('detail.threads', { n: c.threads }));
  // Base clock from the model string ("@ 3.50GHz"); the live frequency is
  // skipped on purpose (an idle box reads 0.8 GHz and only confuses).
  if (base) parts.push(ghz(base));
  else if (max) parts.push(ghz(max));
  return { model: cleanCpuModel(raw, true) || '—', topo: parts.join(' · '), base, max };
}

/** Memory card: one line describing the installed modules, '' when unknown. */
export function memorySummary(s: Server): string {
  const m = s.hardware?.memory;
  if (!m) return '';
  const dimms: any[] = Array.isArray(m.dimms) ? m.dimms : [];
  const bits: string[] = [];
  if (dimms.length) {
    // Count × type at the clock the modules actually run at; vendor and
    // rated speed are in the hardware tab.
    const type = dimms[0].type || '';
    const clock = Number(dimms[0].configured_mts) || Number(dimms[0].speed_mts) || 0;
    bits.push(`${dimms.length} × ${type}${clock ? `-${clock}` : ''}`.trim());
  }
  bits.push(m.ecc_supported || dimms.some((d) => d.ecc) ? t('detail.eccYes') : t('detail.eccNo'));
  return bits.join(' · ');
}

/** Disk card: "1 × SSD · 1.9 TB · S.M.A.R.T. OK", '' when unknown. */
export function diskSummary(s: Server): string {
  const disks: any[] = Array.isArray(s.hardware?.disks) ? s.hardware.disks : [];
  if (!disks.length) return '';
  const kinds = new Map<string, number>();
  let total = 0;
  let failed = 0;
  disks.forEach((d) => {
    const k = String(d.type || 'disk').toUpperCase();
    kinds.set(k, (kinds.get(k) || 0) + 1);
    total += Number(d.size_bytes) || 0;
    if (d.smart_status === 'failed') failed++;
  });
  const kind = Array.from(kinds.entries()).map(([k, n]) => `${n} × ${k}`).join(', ');
  const parts = [kind, total ? bytesDecimal(total) : ''];
  parts.push(failed ? t('detail.smartFailed', { n: failed }) : disks.some((d) => d.smart_status === 'passed') ? t('detail.smartOk') : '');
  return parts.filter(Boolean).join(' · ');
}

/** Network card: "eno1 1 Gbps up · eno2 down". */
export function nicSummary(s: Server): string {
  const nics: any[] = Array.isArray(s.hardware?.network) ? s.hardware.network : [];
  return nics
    .map((n) => {
      const up = n.oper_state === 'up';
      const link = up && Number(n.speed_mbps) > 0 ? ` ${linkSpeed(n.speed_mbps)}` : '';
      const state = up ? t('detail.linkUp') : n.admin_state === 'down' ? t('detail.linkDisabled') : n.oper_state === 'unknown' || !n.oper_state ? t('detail.linkUnknown') : t('detail.linkDown');
      return `${n.name}${link} ${state}`;
    })
    .join(' · ');
}

/** Compact per-interface rows for the overview network card. */
export function nicRows(s: Server): string {
  const nics: any[] = Array.isArray(s.hardware?.network) ? s.hardware.network : [];
  if (!nics.length) return '';
  return nics
    .map((n) => {
      const up = n.oper_state === 'up';
      const cls = up ? 'dot-online' : 'dot-offline';
      return `<div class="flex items-center gap-2 text-[12px] py-1"><span class="dot ${cls}" style="width:6px;height:6px"></span><span class="mono t-1 w-14 shrink-0">${esc(n.name)}</span><span class="t-2 w-16 shrink-0">${esc(linkSpeed(n.speed_mbps))}</span><span class="t-3 tnum">↓ ${esc(speedMB(n.rx_mb_s))}&nbsp;&nbsp;↑ ${esc(speedMB(n.tx_mb_s))}</span></div>`;
    })
    .join('');
}

const ISSUES_SHOWN = 3;

/**
 * Issue list for the overview. Long lists collapse to the first three with a
 * "show N more" toggle (only when that hides at least two lines).
 */
export function renderIssues(s: Server, open = false): string {
  if (!s.issues.length) return '';
  // Critical entries come first; a server that does not report the split
  // colours the whole list by the overall level, as before.
  const crit = s.critCount || (s.health === 'critical' ? s.issues.length : 0);
  const collapsible = s.issues.length > ISSUES_SHOWN + 1;
  const items = s.issues
    .map((i, idx) => {
      const kind = idx < crit ? 'crit' : 'warn';
      return `<div class="issue issue-${kind}"${collapsible && idx >= ISSUES_SHOWN ? ' data-issue-more' : ''}>${icon(kind === 'crit' ? 'alert-circle' : 'alert-triangle', 14)}<span>${esc(i)}</span></div>`;
    })
    .join('');
  const toggle = collapsible
    ? `<button type="button" class="issues-toggle" data-issues-toggle aria-expanded="${open}">${esc(open ? t('detail.lessIssues') : t('detail.moreIssues', { n: s.issues.length - ISSUES_SHOWN }))}</button>`
    : '';
  return `<div class="issues${open ? ' is-open' : ''}" data-issues>${items}${toggle}</div>`;
}

/** Key/value rows describing the machine (overview "System" card). Values are HTML. */
function kernelRow(s: Server): [string, string] | null {
  const sy = s.hardware?.system;
  if (!sy?.kernel) return null;
  return [t('detail.kernel'), `<span class="mono text-[12px]">${esc(sy.kernel)}</span>${sy.reboot_required ? ' ' + pill('warn', t('detail.rebootRequired')) : ''}`];
}

/**
 * Overview "system" card. With a hardware report the card holds identity only
 * (OS, location, machine, board) and kernel/agent go to the hardware summary,
 * so it lines up with the four-row network card next to it.
 */
export function systemRows(s: Server): Array<[string, string]> {
  const hw = s.hardware;
  const rows: Array<[string, string]> = [];
  if (s.os) rows.push([t('detail.os'), esc(s.os)]);
  if (s.location) rows.push([t('detail.location'), esc(s.location)]);
  if (hw?.system) {
    const sy = hw.system;
    const machine = [sy.vendor, sy.product].filter(Boolean).join(' ');
    if (machine) rows.push([t('detail.machine'), esc(machine)]);
    if (sy.board && sy.board !== sy.product) rows.push([t('detail.board'), esc(sy.board)]);
  }
  if (!hw?.cpu && s.cpuModel) {
    // No hardware snapshot (an upstream Pulse agent): show the cleaned model
    // plus the topology the agent appended, instead of the raw string.
    const topo = cpuTopology(s.cpuModel);
    const parts = [cleanCpuModel(s.cpuModel, false), topo.cores ? t('detail.cores', { n: topo.cores }) : '', topo.threads ? t('detail.threads', { n: topo.threads }) : ''].filter(Boolean);
    rows.push([t('detail.cpu'), esc(parts.join(' · '))]);
  }
  if (!hw) {
    const k = kernelRow(s);
    if (k) rows.push(k);
    if (s.agentVersion) rows.push([t('detail.agent'), esc(s.agentVersion)]);
  }
  return rows;
}

// ---------------------------------------------------------------- sensors
//
// A dedicated server reports the same temperature several times over: the
// BMC has its own sensors, the kernel exposes the CPU package and every core
// through hwmon, and ACPI adds generic thermal zones on top. An operator
// wants one reading per component with the BMC as the authority, so the
// panel folds the duplicates away (they stay one click behind "more") and
// collapses the voltage rails to a summary unless one is out of range.
const GENERIC_TEMP_CHIPS = new Set(['acpitz', 'thermal', 'acpi']);
const DRIVE_TEMP_CHIPS = new Set(['nvme', 'drivetemp']);

function sensorTone(sn: any): string {
  if (sn.status === 'cr' || sn.status === 'nr') return 'is-crit';
  if (sn.status === 'nc') return 'is-warn';
  if (sn.kind === 'temp') {
    if (sn.crit != null && sn.value >= sn.crit) return 'is-crit';
    if ((sn.max != null && sn.value >= sn.max) || sn.value >= 85) return 'is-warn';
  } else if (sn.kind === 'fan' && sn.value === 0) return 'is-warn';
  else if (sn.kind === 'psu' && /fail|lost/i.test(String(sn.text || ''))) return 'is-crit';
  return '';
}

/** Component name for a reading: the BMC's own label, or a readable name for a kernel driver channel. */
function sensorLabel(sn: any): string {
  const chip = String(sn.chip || '');
  const label = String(sn.label || '');
  switch (chip) {
    case 'ipmi':
    case 'smc':
    case 'acpi':
      return label;
    case 'coretemp': {
      const m = /^Package id (\d+)$/.exec(label);
      return m ? `CPU ${m[1]}` : label;
    }
    case 'k10temp':
    case 'zenpower':
      return label === 'Tctl' || label === 'Tdie' ? `CPU (${label})` : label;
    case 'thermal':
      return label === 'x86_pkg_temp' ? 'CPU package' : label.replace(/[-_]thermal$/i, '').replace(/^cpu$/i, 'CPU').replace(/^soc$/i, 'SoC');
    case 'acpitz':
      return `ACPI ${label.replace(/^temp/, '')}`;
    case 'drivetemp':
      return 'Drive';
  }
  if (chip.startsWith('pch_')) return 'PCH';
  return [chip, label].filter(Boolean).join(' · ');
}

function sensorChip(sn: any, label: string, title = ''): string {
  const val =
    sn.kind === 'temp' ? temp(sn.value) : sn.kind === 'fan' ? `${int(sn.value)} RPM` : sn.kind === 'psu' ? esc(sn.text || '—') : `${num(sn.value, 2)} ${esc(sn.unit || '')}`;
  return `<span class="sensor ${sensorTone(sn)}${sn._dup ? ' is-dup' : ''}" title="${attr(title || label)}"><span class="truncate max-w-[180px]">${esc(label)}</span><b>${val}</b></span>`;
}

function sensorToggle(key: string, open: boolean, text: string): string {
  return `<button type="button" class="sensor-toggle" data-sensor-toggle="${key}" aria-expanded="${open}">${esc(text)}</button>`;
}

function sensorGroup(key: string, head: string, chips: string[]): string {
  return `<div class="sensor-group"><div class="sensor-group-head"><span class="sensor-group-label">${esc(t('hw.sensorGroup.' + key))}</span>${head}</div>${
    chips.length ? `<div class="flex flex-wrap gap-1.5">${chips.join('')}</div>` : ''
  }</div>`;
}

function renderTemps(all: any[], open: Set<string>): string {
  const temps = all.filter((s) => s.kind === 'temp');
  if (!temps.length) return '';
  const bmc = temps.some((s) => s.chip === 'ipmi');
  const specific = temps.some((s) => !GENERIC_TEMP_CHIPS.has(String(s.chip || '')));
  const cores = temps.filter((s) => s.chip === 'coretemp' && /^Core \d+$/.test(String(s.label || '')));
  const nvmeCount = temps.filter((s) => s.chip === 'nvme' && s.label === 'Composite').length;
  let nvmeIdx = 0;
  const shown: string[] = [];
  const hidden: string[] = [];
  for (const s of temps) {
    const chip = String(s.chip || '');
    let label = sensorLabel(s);
    if (chip === 'nvme') label = s.label === 'Composite' ? (nvmeCount > 1 ? `NVMe ${++nvmeIdx}` : 'NVMe') : `NVMe · ${s.label}`;
    const dup =
      chip !== 'ipmi' &&
      (cores.includes(s) || // merged into one entry below
        (chip === 'nvme' && s.label !== 'Composite') || // per-channel readings behind the composite
        (bmc && !DRIVE_TEMP_CHIPS.has(chip)) || // the BMC already reports the component
        (GENERIC_TEMP_CHIPS.has(chip) && specific)); // ACPI zones mirror real chips
    if (dup) hidden.push(sensorChip({ ...s, _dup: true }, label));
    else shown.push(sensorChip(s, label));
    if (!bmc && cores.length && s === cores[0]) {
      const vals = cores.map((c) => Number(c.value));
      const hi = Math.max(...vals);
      const lo = Math.min(...vals);
      shown.push(sensorChip({ kind: 'temp', value: hi, max: cores[0].max, crit: cores[0].crit }, t('hw.sensor.cores', { n: cores.length }), `${temp(lo)} – ${temp(hi)}`));
    }
  }
  const isOpen = open.has('temp');
  const toggle = hidden.length ? sensorToggle('temp', isOpen, isOpen ? t('hw.sensor.less') : t('hw.sensor.more', { n: hidden.length })) : '';
  return sensorGroup('temp', '', isOpen ? [...shown, ...hidden, toggle] : [...shown, toggle]);
}

function renderVolts(all: any[], open: Set<string>): string {
  const volts = all.filter((s) => s.kind === 'volt');
  if (!volts.length) return '';
  const bad = volts.filter((s) => s.status && s.status !== 'ok').length;
  const isOpen = bad > 0 || open.has('volt');
  const summary = bad ? t('hw.sensor.voltBad', { n: volts.length, bad }) : t('hw.sensor.voltOk', { n: volts.length });
  const head = `<span class="sensor-group-sum${bad ? ' is-warn' : ''}">${esc(summary)}</span>${bad ? '' : sensorToggle('volt', isOpen, isOpen ? t('hw.sensor.less') : t('hw.sensor.show'))}`;
  return sensorGroup('volt', head, isOpen ? volts.map((s) => sensorChip(s, sensorLabel(s))) : []);
}

function renderSensors(hw: any, open: Set<string>): string {
  const all: any[] = hw.sensors;
  const plain = (key: string, kinds: string[]) => {
    const list = all.filter((s) => kinds.includes(String(s.kind || '')));
    return list.length ? sensorGroup(key, '', list.map((s) => sensorChip(s, sensorLabel(s)))) : '';
  };
  const known = new Set(['temp', 'fan', 'volt', 'power', 'current', 'psu']);
  const other = all.filter((s) => !known.has(String(s.kind || '')));
  return [
    renderTemps(all, open),
    plain('fan', ['fan']),
    renderVolts(all, open),
    plain('power', ['power', 'current']),
    plain('psu', ['psu']),
    other.length ? `<div class="sensor-group"><div class="flex flex-wrap gap-1.5">${other.map((s) => sensorChip(s, sensorLabel(s))).join('')}</div></div>` : '',
  ].join('');
}

export function renderHardware(s: Server, open: Set<string> = new Set()): string {
  const hw = s.hardware;
  if (!hw) {
    return `<div class="subcard p-6 text-center text-[13px] t-3">${esc(t('detail.noHardware'))}</div>`;
  }
  const zh = getLang() === 'zh';
  const out: string[] = [];
  const kv = (rows: Array<[string, string]>) => `<dl class="kv kv-2">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;

  // Inventory order: processor, memory, storage, network, GPU, sensors, system.

  // Processor
  {
    const c = hw.cpu;
    const cs = cpuSummary(s);
    const rows: Array<[string, string]> = [];
    if (cs.model && cs.model !== '—') rows.push([t('hw.col.model'), esc(cs.model)]);
    const topo: string[] = [];
    if (c?.sockets > 1) topo.push(t('detail.sockets', { n: c.sockets }));
    if (c?.cores) topo.push(t('detail.cores', { n: c.cores }));
    if (c?.threads) topo.push(t('detail.threads', { n: c.threads }));
    if (topo.length) rows.push([t('hw.topology'), esc(topo.join(' · '))]);
    if (cs.base) rows.push([t('hw.baseFreq'), esc(ghz(cs.base))]);
    if (c?.max_mhz) rows.push([t('hw.maxFreq'), esc(ghz(Number(c.max_mhz)))]);
    if (c?.mhz) rows.push([t('hw.currentFreq'), esc(ghz(Number(c.mhz)))]);
    if (c?.l3_cache) rows.push([t('hw.l3'), esc(cacheSize(String(c.l3_cache)))]);
    if (Array.isArray(hw.load) && hw.load.length >= 3) {
      const threads = Number(c?.threads) || 0;
      const l1 = Number(hw.load[0]) || 0;
      const tone = threads && l1 > threads * 2 ? 'text-[var(--warn)] font-semibold' : '';
      rows.push([t('hw.load'), `<span class="${tone} tnum">${hw.load.slice(0, 3).map((v: number) => num(v, 2)).join(' / ')}</span>`]);
    }
    if (rows.length) out.push(section('hw.processor', 'cpu', 0, kv(rows)));
  }

  // Memory: totals, then the modules.
  {
    const m = hw.memory;
    const dimms: any[] = Array.isArray(m?.dimms) ? m.dimms : [];
    const rows: Array<[string, string]> = [];
    const installed = dimms.length ? dimms.reduce((acc: number, d: any) => acc + (Number(d.size_bytes) || 0), 0) : Number(m?.total_bytes) || 0;
    const countNote = dimms.length === 1 ? t('hw.module') : dimms.length ? t('hw.modules', { n: dimms.length }) : '';
    if (installed) rows.push([t('hw.total'), esc(bytes(installed, 0)) + (countNote ? ` <span class="t-3">· ${esc(countNote)}</span>` : '')]);
    if (m) rows.push([t('hw.col.ecc'), esc(m.ecc_supported ? t('hw.eccSupported') : t('hw.eccNot'))]);
    if (m?.ecc_supported) {
      const cls = Number(m.ecc_uncorrectable) > 0 ? 'text-[var(--crit)] font-semibold' : Number(m.ecc_correctable) > 0 ? 'text-[var(--warn)]' : '';
      rows.push([t('hw.eccErrors'), `<span class="${cls}">${esc(t('detail.eccCounts', { ce: int(m.ecc_correctable), ue: int(m.ecc_uncorrectable) }))}</span>`]);
    }
    let modules = '';
    if (dimms.length) {
      // Columns nobody reports (part numbers in the public view, clocks on
      // platforms that do not expose them) are dropped, not dashed out.
      const withPart = dimms.some((d: any) => d.part_number);
      const withSpeed = dimms.some((d: any) => d.speed_mts || d.configured_mts);
      const trs = dimms.map((d: any) => [
        // Apple silicon reports one slot-less "Unified" entry; show it in the same table.
        `<span class="font-semibold mono">${esc(/^unified$/i.test(String(d.locator || '')) ? t('hw.unifiedMemory') : d.locator || '—')}</span>`,
        esc(bytes(d.size_bytes || 0, 0)),
        esc(d.type || '—'),
        ...(withSpeed
          ? [
              `${d.speed_mts ? `${int(d.speed_mts)} MT/s` : '—'}${d.speed_nominal ? ` <span class="t-3">(${esc(t('hw.nominal'))})</span>` : ''}${d.configured_mts && d.configured_mts !== d.speed_mts ? ` <span class="t-3">(${esc(t('hw.configured', { v: `${int(d.configured_mts)} MT/s` }))})</span>` : ''}`,
            ]
          : []),
        esc(d.manufacturer || '—'),
        ...(withPart ? [`<span class="mono">${esc(d.part_number || '—')}</span>`] : []),
        d.ecc ? esc(t('common.yes')) : esc(t('common.no')),
      ]);
      const head = [t('hw.col.slot'), t('hw.col.size'), t('hw.col.type'), ...(withSpeed ? [t('hw.col.speed')] : []), t('hw.col.manufacturer'), ...(withPart ? [t('hw.col.part')] : []), t('hw.col.ecc')];
      let widths: string[] = [];
      if (withSpeed && withPart) widths = ['12%', '9%', '8%', '29%', '12%', '22%', '8%'];
      else if (withSpeed) widths = ['14%', '11%', '10%', '37%', '18%', '10%'];
      else if (withPart) widths = ['16%', '12%', '12%', '20%', '30%', '10%'];
      else widths = ['24%', '20%', '20%', '24%', '12%'];
      modules = `<div class="${rows.length ? 'mt-3' : ''}">${table(head, trs, widths)}</div>`;
    }
    if (rows.length || modules) out.push(section('hw.memory', 'memory', dimms.length, kv(rows) + modules));
  }

  // Storage
  if (Array.isArray(hw.disks) && hw.disks.length) {
    const detail = hw.disks.some((d: any) => d.temp_c != null || d.power_on_hours != null || d.wear_pct != null || d.reallocated != null || d.pending != null || d.media_errors != null);
    const rows = hw.disks.map((d: any) => {
      const smart =
        d.smart_status === 'failed' ? pill('crit', t('hw.smart.failed')) : d.smart_status === 'passed' ? pill('ok', t('hw.smart.passed')) : pill('unknown', t('hw.smart.unknown'));
      // Life: the percentage on its own line; total written and (only when
      // it has dropped) spare capacity underneath, so the column stays narrow.
      let life = '—';
      if (d.wear_pct != null || d.written_bytes || (d.spare_avail_pct != null && d.spare_avail_pct < 100)) {
        const left = d.wear_pct != null ? Math.max(0, 100 - Number(d.wear_pct)) : null;
        const main = left == null ? '—' : `<span class="${left < 10 ? 'text-[var(--crit)] font-semibold' : left < 20 ? 'text-[var(--warn)]' : ''}">${left.toFixed(0)}%</span>`;
        const sub: string[] = [];
        if (d.spare_avail_pct != null && d.spare_avail_pct < 100) sub.push(esc(t('hw.spare', { pct: num(d.spare_avail_pct, 0) })));
        if (d.written_bytes) sub.push(`${esc(bytesDecimal(d.written_bytes))} ${esc(t('hw.written'))}`);
        life = main + (sub.length ? `<div class="t-3 text-[12px]">${sub.join(' · ')}</div>` : '');
      }
      const sectors: string[] = [];
      if (d.media_errors) sectors.push(esc(t('hw.media', { n: int(d.media_errors) })));
      if (d.reallocated != null && d.reallocated > 0) sectors.push(esc(t('hw.realloc', { n: int(d.reallocated) })));
      if (d.pending != null && d.pending > 0) sectors.push(esc(t('hw.pending', { n: int(d.pending) })));
      const tempV = d.temp_c != null ? Number(d.temp_c) : null;
      const tempCls = tempV != null && tempV >= 85 ? 'text-[var(--crit)] font-semibold' : tempV != null && tempV >= 70 ? 'text-[var(--warn)]' : '';
      return [
        `<span class="font-semibold">${esc(d.device)}</span>${d.type ? ` <span class="pill pill-sm pill-neutral uppercase">${esc(d.type)}</span>` : ''}`,
        `<div class="wrap">${esc(d.model || '—')}</div>${d.serial ? `<div class="t-3 mono text-[12px]">SN ${esc(d.serial)}</div>` : ''}`,
        d.size_bytes ? esc(bytesDecimal(d.size_bytes)) : '—',
        smart,
        ...(detail
          ? [
              `<span class="${tempCls}">${temp(d.temp_c)}</span>`,
              d.power_on_hours != null ? esc(hours(d.power_on_hours, zh)) : '—',
              life,
              sectors.length
                ? `<span class="${d.media_errors || (d.pending != null && d.pending > 0) ? 'text-[var(--warn)]' : ''}">${sectors.join(' · ')}</span>`
                : d.reallocated != null || d.pending != null || d.media_errors != null
                  ? '0'
                  : '—',
            ]
          : []),
        `${num(d.read_mb_s)} / ${num(d.write_mb_s)} MB/s<div class="t-3 text-[12px]">${num(d.read_iops, 0)} / ${num(d.write_iops, 0)} IOPS</div>`,
        miniBar(d.util_pct, 56),
      ];
    });
    const head = [t('hw.col.device'), t('hw.col.model'), t('hw.col.size'), t('hw.col.smart'), ...(detail ? [t('hw.col.temp'), t('hw.col.hours'), t('hw.col.life'), t('hw.col.sectors')] : []), t('hw.col.io'), t('hw.col.util')];
    const hint = detail ? '' : `<p class="text-[12px] t-3 mt-2">${esc(t('hw.smartHint'))}</p>`;
    out.push(section('hw.disks', 'hard-drive', hw.disks.length, table(head, rows) + hint));
  }

  if (Array.isArray(hw.filesystems) && hw.filesystems.length) {
    const rows = hw.filesystems.map((f: any) => [
      `<span class="font-semibold mono">${esc(f.mount)}</span>${f.device ? `<div class="t-3 text-[12px] mono">${esc(f.device)}</div>` : ''}`,
      esc(f.fstype || '—'),
      `${esc(bytes(f.used_bytes || 0, 1))} <span class="t-3">/ ${esc(bytes(f.total_bytes || 0, 1))}</span>`,
      miniBar(f.used_pct),
    ]);
    out.push(section('hw.filesystems', 'database', hw.filesystems.length, table([t('hw.col.mount'), t('hw.col.fstype'), t('hw.col.used'), t('hw.col.usage')], rows, ['34%', '12%', '26%', '28%'])));
  }

  const raidRows: string[][] = [];
  (Array.isArray(hw.raid) ? hw.raid : []).forEach((r: any) => {
    const state = r.degraded ? pill('crit', t('hw.degraded')) : pill('ok', t('hw.healthy'));
    const rebuild = r.rebuild_pct != null ? ' ' + pill('warn', t('hw.rebuilding', { pct: num(r.rebuild_pct) })) : '';
    raidRows.push([
      `<span class="font-semibold mono">${esc(r.name)}</span>`,
      esc(r.level || 'md'),
      `${int(r.disks_active)} / ${int(r.disks_total)}`,
      `${state}${rebuild}${r.state ? ` <span class="t-3">${esc(r.state)}</span>` : ''}`,
    ]);
  });
  (Array.isArray(hw.zfs) ? hw.zfs : []).forEach((z: any) => {
    const ok = String(z.state || '').toUpperCase() === 'ONLINE';
    raidRows.push([
      `<span class="font-semibold mono">${esc(z.name)}</span>`,
      'ZFS',
      z.errors ? `<span class="text-[var(--warn)]">${int(z.errors)} err</span>` : '0 err',
      pill(ok ? 'ok' : 'crit', z.state || '—'),
    ]);
  });
  if (raidRows.length) out.push(section('hw.raid', 'layers', raidRows.length, table([t('hw.col.array'), t('hw.col.level'), t('hw.col.members'), t('hw.col.state')], raidRows)));

  // Network
  if (Array.isArray(hw.network) && hw.network.length) {
    const rows = hw.network.map((n: any) => {
      const up = n.oper_state === 'up';
      const idle = n.admin_state === 'down' && !n.rx_bytes && !n.tx_bytes; // unconfigured port: no figures to show
      const errs = (Number(n.rx_errors) || 0) + (Number(n.tx_errors) || 0);
      const drops = (Number(n.rx_dropped) || 0) + (Number(n.tx_dropped) || 0);
      return [
        `<span class="font-semibold mono">${esc(n.name)}</span>`,
        `${esc(linkSpeed(n.speed_mbps))}${n.duplex && n.duplex !== 'unknown' ? ` <span class="t-3">${esc(n.duplex)}</span>` : ''}`,
        up
          ? pill('ok', t('hw.up'))
          : n.admin_state === 'down'
            ? pill('unknown', t('detail.linkDisabled'))
            : n.oper_state === 'unknown' || !n.oper_state
              ? pill('unknown', t('detail.linkUnknown'))
              : pill('crit', t('detail.linkDown')),
        idle ? '—' : `<span class="text-[var(--ok)]">↓</span> ${esc(speedMB(n.rx_mb_s))} <span class="t-3">·</span> <span class="text-[var(--info)]">↑</span> ${esc(speedMB(n.tx_mb_s))}`,
        idle ? '—' : `${esc(bytes(n.rx_bytes || 0, 1))} <span class="t-3">/</span> ${esc(bytes(n.tx_bytes || 0, 1))}`,
        idle ? '—' : `<span class="${errs ? 'text-[var(--warn)] font-semibold' : ''}">${int(errs)}</span> <span class="t-3">/</span> ${int(drops)}`,
      ];
    });
    out.push(
      section(
        'hw.network',
        'network',
        hw.network.length,
        table([t('hw.col.device'), t('hw.col.link'), t('hw.col.state'), t('hw.col.rate'), `${t('detail.totalIn')} / ${t('detail.totalOut')}`, t('hw.col.errors')], rows),
      ),
    );
  }

  // GPU (compute cards with counters)
  if (Array.isArray(hw.gpus) && hw.gpus.length) {
    const rows = hw.gpus.map((g: any) => [
      `<span class="font-semibold">${esc(g.name)}</span>`,
      g.util_pct != null && (g.util_pct > 0 || g.mem_total_mb > 0) ? miniBar(g.util_pct) : '—',
      g.mem_total_mb > 0 ? `${num(g.mem_used_mb, 0)} / ${num(g.mem_total_mb, 0)} MB` : '—',
      g.temp_c > 0 ? `<span class="${Number(g.temp_c) >= 85 ? 'text-[var(--crit)] font-semibold' : ''}">${temp(g.temp_c)}</span>` : '—',
    ]);
    out.push(section('hw.gpu', 'zap', hw.gpus.length, table([t('hw.col.device'), t('hw.col.usage'), t('hw.col.memory'), t('hw.col.temp')], rows)));
  }

  // Sensors
  if (Array.isArray(hw.sensors) && hw.sensors.length) {
    out.push(section('hw.sensors', 'thermometer', hw.sensors.length, renderSensors(hw, open)));
  }

  // System: identity and firmware, the way an inventory sheet lists it.
  {
    const sy = hw.system || {};
    const rows: Array<[string, string]> = [];
    const machine = [sy.vendor, sy.product].filter(Boolean).join(' ');
    if (machine) rows.push([t('detail.machine'), esc(machine)]);
    // Boards that carry the same name as the product (Intel server boards) add nothing.
    if (sy.board && sy.board !== sy.product) rows.push([t('detail.board'), esc(sy.board)]);
    if (sy.bios) rows.push([t('hw.firmware'), esc(sy.bios)]);
    if (Array.isArray(sy.display_adapters) && sy.display_adapters.length) {
      const names = sy.display_adapters.map((n: string) => (/aspeed|matrox/i.test(n) ? `${esc(n)} <span class="t-3">(${esc(t('hw.onboard'))})</span>` : esc(n)));
      rows.push([t('hw.graphics'), names.join(' · ')]);
    }
    const k = kernelRow(s);
    if (k) rows.push(k);
    if (s.agentVersion) rows.push([t('detail.agent'), esc(s.agentVersion)]);
    if (hw.collected_at) {
      const d = new Date(hw.collected_at);
      if (!isNaN(d.getTime())) rows.push([t('detail.hwCollected'), esc(timeHMS(d))]);
    }
    if (rows.length) out.push(section('hw.system', 'info', 0, kv(rows)));
  }

  if (!out.length) out.push(`<div class="subcard p-6 text-center text-[13px] t-3">${esc(t('detail.noHardware'))}</div>`);
  return out.join('');
}
