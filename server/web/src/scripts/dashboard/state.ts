/** View-model helpers for the public dashboard. */
import { clampPct, uptimeHours } from '../core/format';
import { getLang } from '../core/i18n';

export type HealthKey = 'ok' | 'warn' | 'critical' | 'unknown' | '';
export type FilterKey = 'all' | 'online' | 'offline' | 'attention';
export type SortField = 'default' | 'name' | 'uptime' | 'os' | 'cpu' | 'memory' | 'disk' | 'health';

export interface Server {
  id: string;
  name: string;
  raw: any;
  online: boolean;
  health: HealthKey;
  issues: string[];
  /** How many leading entries of `issues` are critical (0 on old servers). */
  critCount: number;
  tags: string[];
  cpu: number;
  memory: number;
  disk: number;
  netIn: number;
  netOut: number;
  totalIn: number;
  totalOut: number;
  uptime: string;
  uptimeH: number;
  location: string;
  os: string;
  osIcon: string;
  type: string;
  cpuModel: string;
  memoryInfo: string;
  swapInfo: string;
  diskInfo: string;
  agentVersion: string;
  updatedAt: string;
  hideTcping: boolean;
  hardware: any | null;
  hwSig: string;
  tcpingSig: string;
}

export function healthKeyOf(raw: any): HealthKey {
  const h = String(raw?.health || '');
  const hasHw = !!(raw?.hardware && typeof raw.hardware === 'object');
  if (h === 'ok' || h === 'warn' || h === 'critical') return h;
  // "unknown" without any hardware snapshot means the agent simply does not
  // report hardware (VPS / old agent): show nothing rather than "Unknown".
  return hasHw ? 'unknown' : '';
}

export function tcpingSignature(raw: any): string {
  const d = raw?.tcping_data;
  if (!d || typeof d !== 'object') return '';
  return Object.keys(d)
    .sort()
    .map((k) => `${k}@${d[k]?.timestamp || ''}`)
    .join('|');
}

export function normalize(raw: any): Server {
  // The server sends the issue list in both languages (index-aligned);
  // older servers only send the Chinese one.
  const zhIssues: string[] = Array.isArray(raw?.health_issues) ? raw.health_issues.map(String) : [];
  const enIssues: string[] = Array.isArray(raw?.health_issues_en) ? raw.health_issues_en.map(String) : [];
  const issues = getLang() !== 'zh' && enIssues.length === zhIssues.length ? enIssues : zhIssues;
  const tags = Array.isArray(raw?.tags) ? raw.tags.filter((t: unknown) => typeof t === 'string') : [];
  const hw = raw?.hardware && typeof raw.hardware === 'object' ? raw.hardware : null;
  const health = healthKeyOf(raw);
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name || 'unknown'),
    raw,
    online: !(raw?.alert === true),
    health,
    issues,
    critCount: Math.max(0, Math.min(issues.length, Number(raw?.health_critical) || 0)),
    tags,
    cpu: clampPct(raw?.cpu),
    memory: clampPct(raw?.memory),
    disk: clampPct(raw?.disk),
    netIn: Number(raw?.net_in_mb_s) || 0,
    netOut: Number(raw?.net_out_mb_s) || 0,
    totalIn: Number(raw?.total_net_in_bytes) || 0,
    totalOut: Number(raw?.total_net_out_bytes) || 0,
    uptime: String(raw?.time || ''),
    uptimeH: uptimeHours(raw?.time),
    location: String(raw?.location || ''),
    os: String(raw?.os || ''),
    osIcon: String(raw?.os_icon || ''),
    type: String(raw?.virtualization_type || ''),
    cpuModel: String(raw?.cpu_model || ''),
    memoryInfo: String(raw?.memory_info || ''),
    swapInfo: String(raw?.swap_info || ''),
    diskInfo: String(raw?.disk_info || ''),
    agentVersion: String(raw?.agent_version || ''),
    updatedAt: String(raw?.updated_at || ''),
    hideTcping: raw?.hide_tcping === true,
    hardware: hw,
    hwSig: hw ? `${health}|${hw.collected_at || ''}|${issues.join(';')}` : '',
    tcpingSig: tcpingSignature(raw),
  };
}

const HEALTH_RANK: Record<string, number> = { critical: 0, warn: 1, unknown: 2, ok: 3, '': 4 };

export function matchesQuery(s: Server, q: string): boolean {
  if (!q) return true;
  const hay = [s.name, s.location, s.os, s.cpuModel, s.raw?.ipv4, s.raw?.ipv6, s.type, ...s.tags].join(' | ').toLowerCase();
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part));
}

export function matchesFilter(s: Server, f: FilterKey): boolean {
  switch (f) {
    case 'online':
      return s.online;
    case 'offline':
      return !s.online;
    case 'attention':
      return s.health === 'warn' || s.health === 'critical';
    default:
      return true;
  }
}

export function sortServers(list: Server[], field: SortField, dir: 'asc' | 'desc'): Server[] {
  if (field === 'default') return list;
  const m = dir === 'asc' ? 1 : -1;
  const cmpStr = (a: string, b: string) => {
    if (!a && !b) return 0;
    if (!a) return 1; // empty values always last
    if (!b) return -1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * m;
  };
  const cmpNum = (a: number, b: number) => (a - b) * m;
  return [...list].sort((a, b) => {
    switch (field) {
      case 'name':
        return cmpStr(a.name.toLowerCase(), b.name.toLowerCase());
      case 'os':
        return cmpStr(a.os.toLowerCase(), b.os.toLowerCase());
      case 'uptime':
        return cmpNum(a.uptimeH, b.uptimeH);
      case 'cpu':
        return cmpNum(a.cpu, b.cpu);
      case 'memory':
        return cmpNum(a.memory, b.memory);
      case 'disk':
        return cmpNum(a.disk, b.disk);
      case 'health':
        return cmpNum(HEALTH_RANK[a.health] ?? 4, HEALTH_RANK[b.health] ?? 4);
      default:
        return 0;
    }
  });
}
