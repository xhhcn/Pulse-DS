/** Number / unit formatting shared by the dashboard and admin pages. */

export function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function pct(v: unknown, digits = 1): string {
  return clampPct(v).toFixed(digits) + '%';
}

/** Binary-prefixed bytes (KiB…), two decimals for width stability. */
export function bytes(v: unknown, digits = 2): string {
  const n = Number(v) || 0;
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = -1;
  let x = n;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(digits)} ${units[i]}`;
}

/** Decimal-prefixed bytes (GB / TB) used for disk capacities. */
export function bytesDecimal(v: unknown, digits = 1): string {
  const n = Number(v) || 0;
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let i = -1;
  let x = n;
  while (x >= 1000 && i < units.length - 1) { x /= 1000; i++; }
  return `${x.toFixed(x >= 100 ? 0 : digits)} ${units[i]}`;
}

/** Rate from MiB/s (agent unit) to a readable string. */
export function speedMiB(mib: unknown): string {
  const n = (Number(mib) || 0) * 1024 * 1024;
  return speedBytes(n);
}

/** Rate from decimal MB/s (hardware collector unit). */
export function speedMB(mb: unknown): string {
  return speedBytes((Number(mb) || 0) * 1e6);
}

export function speedBytes(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
  return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

export function linkSpeed(mbps: unknown): string {
  const n = Number(mbps);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} Gbps`;
  return `${n} Mbps`;
}

export function num(v: unknown, digits = 1): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

export function int(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '—';
}

export function temp(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n)}°C` : '—';
}

export function hours(v: unknown, zh = false): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n < 48) return `${Math.round(n)} ${zh ? '小时' : 'h'}`;
  const d = n / 24;
  if (d < 365) return `${d.toFixed(0)} ${zh ? '天' : 'd'}`;
  return `${(d / 365).toFixed(1)} ${zh ? '年' : 'y'}`;
}

/** Server-formatted uptime ("12h" / "45d") → numeric hours for sorting. */
export function uptimeHours(s: unknown): number {
  const str = String(s || '').trim();
  let m = str.match(/^(\d+)\s*d/i);
  if (m) return parseInt(m[1], 10) * 24;
  m = str.match(/^(\d+)\s*h/i);
  if (m) return parseInt(m[1], 10);
  m = str.match(/(\d+):(\d+):(\d+)/);
  if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  return -1;
}

/** Server uptime string → compact localized form for table cells ("45d" → "45 天" / "45d"). */
export function uptimeShort(s: unknown, zh: boolean): string {
  const str = String(s || '').trim();
  if (!str) return '—';
  let m = str.match(/^(\d+)\s*d$/i);
  if (m) return zh ? `${m[1]} 天` : `${m[1]}d`;
  m = str.match(/^(\d+)\s*h$/i);
  if (m) return zh ? `${m[1]} 小时` : `${m[1]}h`;
  return str;
}

/** Server uptime string → localized long form ("45d" → "45 days"). */
export function uptimeLong(s: unknown, zh: boolean): string {
  const str = String(s || '').trim();
  if (!str) return '—';
  let m = str.match(/^(\d+)\s*d$/i);
  if (m) return zh ? `${m[1]} 天` : `${m[1]} day${m[1] === '1' ? '' : 's'}`;
  m = str.match(/^(\d+)\s*h$/i);
  if (m) return zh ? `${m[1]} 小时` : `${m[1]} hour${m[1] === '1' ? '' : 's'}`;
  return str;
}

// Times are always 24-hour and dates ISO-ordered: the unambiguous forms
// operations dashboards use, whatever the browser locale says.
const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
export function timeHM(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function timeHMS(d: Date): string {
  return `${timeHM(d)}:${pad2(d.getSeconds())}`;
}
export function dateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${timeHMS(d)}`;
}

export function relativeAgo(iso: unknown, zh: boolean): string {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t) || t <= 0) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return zh ? '刚刚' : 'just now';
  if (s < 60) return zh ? `${s} 秒前` : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return zh ? `${m} 分钟前` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return zh ? `${h} 小时前` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return zh ? `${d} 天前` : `${d}d ago`;
}
