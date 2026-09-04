/**
 * Backend access: base URL, auth (admin bearer token or share token),
 * JSON helpers and a resilient SSE client.
 */
export const ADMIN_TOKEN_KEY = 'admin_auth_token';

export function apiBase(): string {
  const v = document.documentElement.getAttribute('data-api-base');
  return v && v.trim() ? v.trim().replace(/\/$/, '') : window.location.origin;
}

export function shareToken(): string | null {
  try { return new URLSearchParams(window.location.search).get('token'); } catch { return null; }
}

export function adminToken(): string | null {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch { return null; }
}

export function clearAdminToken(): void {
  try { localStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}
}

/** Build a URL + headers carrying whatever credential this page has. */
export function authed(path: string, init: RequestInit = {}): { url: string; init: RequestInit } {
  let url = path.startsWith('http') ? path : apiBase() + path;
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  const st = shareToken();
  const at = adminToken();
  if (st) {
    url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(st);
  } else if (at) {
    headers['Authorization'] = 'Bearer ' + at;
  }
  return { url, init: { ...init, headers } };
}

export class HttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(body || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function getJSON<T = any>(path: string): Promise<T> {
  const { url, init } = authed(path, { cache: 'no-store' });
  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''));
  return res.json();
}

export async function sendJSON<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, init } = authed(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(res.status, await res.text().catch(() => ''));
  const text = await res.text();
  try { return text ? JSON.parse(text) : (null as T); } catch { return null as T; }
}

export function redirectToLogin(target: string): void {
  clearAdminToken();
  window.location.href = '/login?redirect=' + encodeURIComponent(target);
}

/* ------------------------------------------------------------------ */
/* SSE                                                                 */
/* ------------------------------------------------------------------ */
export type SSEState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface SSEOptions {
  onUpdate: (payload: any) => void;
  onState?: (state: SSEState) => void;
}

/**
 * EventSource wrapper with exponential backoff + a 45 s liveness watchdog
 * (the server emits either a state frame every ~3 s or a keepalive every
 * 15 s, so 45 s of silence means the socket is half-open).
 */
export class SSEClient {
  private es: EventSource | null = null;
  private attempt = 0;
  private watchdog: number | null = null;
  private reconnectTimer: number | null = null;
  private closed = false;
  constructor(private opts: SSEOptions) {}

  connect(): void {
    this.closed = false;
    this.teardown();
    let url = apiBase() + '/api/events';
    const st = shareToken();
    const at = adminToken();
    if (st) url += '?token=' + encodeURIComponent(st);
    else if (at) url += '?admin_token=' + encodeURIComponent(at);

    this.opts.onState?.(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const es = new EventSource(url);
    this.es = es;
    this.alive();
    es.addEventListener('connected', () => {
      this.attempt = 0;
      this.alive();
      this.opts.onState?.('live');
    });
    es.onmessage = () => this.alive();
    es.addEventListener('update', (e: MessageEvent) => {
      this.alive();
      this.opts.onState?.('live');
      try { this.opts.onUpdate(JSON.parse(e.data)); } catch {}
    });
    es.onerror = () => {
      this.teardown();
      this.scheduleReconnect();
    };
  }

  close(): void {
    this.closed = true;
    this.teardown();
    if (this.reconnectTimer) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private teardown(): void {
    if (this.es) { try { this.es.close(); } catch {} this.es = null; }
    if (this.watchdog) { window.clearTimeout(this.watchdog); this.watchdog = null; }
  }

  private alive(): void {
    if (this.watchdog) window.clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(() => {
      this.teardown();
      this.scheduleReconnect();
    }, 45_000);
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    this.opts.onState?.(this.attempt >= 3 ? 'offline' : 'reconnecting');
    const base = Math.min(30_000, 1000 * Math.pow(2, this.attempt));
    const delay = base + Math.floor(Math.random() * 1000);
    this.attempt++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

/* Navbar config preloaded by the inline bootstrap (Base.astro). */
export function navbarConfig(): any {
  return (window as any).__navbarConfig || null;
}
