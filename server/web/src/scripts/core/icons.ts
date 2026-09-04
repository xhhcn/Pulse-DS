/**
 * Inline icon set (Lucide outlines, 24×24) for markup rendered from JS,
 * plus the remote iconify loader used for OS logos and country flags.
 */
import { sanitizeSvg } from './dom';
const P: Record<string, string> = {
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  memory: '<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9"/><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M2 12h20"/>',
  'hard-drive': '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  network: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-up-down': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  'alert-triangle': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'alert-circle': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  fan: '<path d="M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z"/><path d="M12 12v.01"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  linux: '',
  windows: '',
};

// Brand marks (filled) for the install-command buttons.
const FILLED: Record<string, string> = {
  linux: '<path fill="currentColor" stroke="none" d="M8.264 15.29a1 1 0 0 1 .822.522l1.892 3.493a1.809 1.809 0 0 1-1.856 2.65l-3.93-.582a1 1 0 0 1-.672-1.563l.623-.89-.174-.984a1 1 0 0 1 .811-1.159l.985-.173.623-.89a1 1 0 0 1 .876-.425Zm6.347-.024a1 1 0 0 1 .858-.043l.116.057.94.543.966-.259a1 1 0 0 1 1.188.596l.037.111.259.966.94.543a1 1 0 0 1 .154 1.623l-.103.078-3.315 2.188a1.809 1.809 0 0 1-2.805-1.46l.003-.158.238-3.965a1 1 0 0 1 .524-.82M12 2a4 4 0 0 1 4 4v1c0 1.214.502 2.267 1.166 3.354l.736 1.165c.1.16.195.315.28.457.32.541.628 1.14.788 1.781a7 7 0 0 1 .194 1.358 2 2 0 0 0-1.932-.516l-.565.151-.582-.336a2 2 0 0 0-2.996 1.613l-.238 3.965c-.021.345.022.684.121 1.003l-.269.005h-.406q-.114 0-.226-.004c.22-.71.152-1.492-.214-2.167l-1.891-3.493a2 2 0 0 0-3.397-.195l-.385.55-.33.058a5.4 5.4 0 0 1 .024-1.16c.037-.285.086-.567.152-.832.198-.792.535-1.459.857-2.02l.437-.74C7.74 10.28 8 9.722 8 9V6a4 4 0 0 1 4-4m-1.438 5.778-.822.41c.224.597.572 1.156.897 1.6l.204.269.184.225.081.094.25-.141.329-.197c.176-.109.368-.232.566-.367.604-.412 1.225-.91 1.662-1.427l-2.316-.58a1.5 1.5 0 0 0-1.035.114"/>',
  windows: '<path fill="currentColor" stroke="none" d="M21 13v7.434a1.5 1.5 0 0 1-1.553 1.499l-.133-.011L12 21.008V13zm-11 0v7.758l-5.248-.656A2 2 0 0 1 3 18.117V13zm9.314-10.922a1.5 1.5 0 0 1 1.68 1.355l.006.133V11h-9V2.992zM10 3.242V11H3V5.883a2 2 0 0 1 1.752-1.985z"/>',
};

export function icon(name: string, size = 16, cls = ''): string {
  const filled = FILLED[name];
  const body = filled || P[name] || P['box'];
  const c = cls ? ` class="${cls}"` : '';
  if (filled) {
    return `<svg${c} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
  }
  return `<svg${c} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/* ------------------------------------------------------------------ */
/* Remote SVGs (iconify) with an in-memory cache. Cached entries render */
/* synchronously; misses render a placeholder and fill in when fetched. */
/* ------------------------------------------------------------------ */
const svgCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function cachedSvg(name: string): string | null | undefined {
  return svgCache.get(name);
}

/** iconify names look like "logos:debian" or "flag:us-4x3"; anything else never becomes a URL. */
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function fetchSvg(name: string): Promise<string | null> {
  if (!ICON_NAME.test(name)) return Promise.resolve(null);
  if (svgCache.has(name)) return Promise.resolve(svgCache.get(name) ?? null);
  const pending = inflight.get(name);
  if (pending) return pending;
  const p = (async () => {
    try {
      // Networks that cannot reach the icon CDN must not leave blank boxes
      // around forever: give up after a few seconds and use the fallback.
      const ac = new AbortController();
      const timer = window.setTimeout(() => ac.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(`https://api.iconify.design/${encodeURI(name)}.svg?height=32`, { signal: ac.signal });
      } finally {
        window.clearTimeout(timer);
      }
      if (!res.ok) { svgCache.set(name, null); return null; }
      let text = await res.text();
      // Wordmarks (very wide viewBox) do not fit a square slot: prefer the
      // set's "-icon" variant when one exists, otherwise let the caller
      // fall back to its generic glyph.
      const vb = text.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/);
      if (vb && Number(vb[2]) > 0 && Number(vb[1]) / Number(vb[2]) > 1.6 && !name.endsWith('-icon')) {
        const alt = await fetchSvg(name + '-icon');
        svgCache.set(name, alt);
        return alt;
      }
      // Normalise: let CSS size the glyph. The CDN response is third-party
      // markup, so it is reduced to inert drawing before it can touch the DOM.
      text = text.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '');
      const clean = sanitizeSvg(text);
      svgCache.set(name, clean);
      return clean;
    } catch {
      svgCache.set(name, null);
      return null;
    } finally {
      inflight.delete(name);
    }
  })();
  inflight.set(name, p);
  return p;
}

/** Fill every `[data-remote-icon]` under root whose SVG is not yet loaded. */
export function hydrateRemoteIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-remote-icon]').forEach((el) => {
    const name = el.getAttribute('data-remote-icon') || '';
    if (!name || el.getAttribute('data-loaded') === name) return;
    const cached = svgCache.get(name);
    if (cached) { el.innerHTML = cached; el.setAttribute('data-loaded', name); el.hidden = false; return; }
    if (cached === null) {
      applyFallback(el, name);
      return;
    }
    fetchSvg(name).then((svg) => {
      if (!el.isConnected || el.getAttribute('data-remote-icon') !== name) return;
      if (svg) {
        el.innerHTML = svg;
        el.setAttribute('data-loaded', name);
        el.hidden = false;
      } else {
        applyFallback(el, name);
      }
    });
  });
}

function applyFallback(el: HTMLElement, name: string): void {
  if (el.getAttribute('data-loaded') === name) return;
  el.setAttribute('data-loaded', name);
  const fb = el.getAttribute('data-fallback');
  if (fb === 'text') {
    // Replace the icon box with its title text (e.g. an unknown country code).
    el.className = 'text-[12px] t-2';
    el.textContent = el.getAttribute('title') || '';
    el.hidden = false;
    return;
  }
  if (fb) {
    el.innerHTML = icon(fb, 18, 't-3');
    el.hidden = false;
  } else {
    el.hidden = true; // nothing sensible to show: collapse instead of leaving a gap
  }
}

/**
 * Remote icon placeholder. `fallback` is an inline icon name used when the
 * remote SVG cannot be fetched, or 'text' to fall back to the title text.
 */
export function remoteIconHtml(name: string, cls: string, title = '', fallback = ''): string {
  const cached = svgCache.get(name);
  const safeName = name.replace(/"/g, '');
  const t = title ? ` title="${title.replace(/"/g, '&quot;')}"` : '';
  const fb = fallback ? ` data-fallback="${fallback.replace(/"/g, '')}"` : '';
  if (cached === null) {
    if (fallback === 'text') return `<span class="text-[12px] t-2"${t}>${title.replace(/</g, '&lt;')}</span>`;
    return `<span class="${cls}"${t}>${fallback ? icon(fallback, 18, 't-3') : ''}</span>`;
  }
  // Not loaded yet: keep the box collapsed so text around it does not gap.
  return `<span class="${cls}" data-remote-icon="${safeName}"${cached ? ` data-loaded="${safeName}"` : ' hidden'}${t}${fb}>${cached || ''}</span>`;
}

/* ------------------------------------------------------------------ */
/* Country flags (emojione-v1 set on iconify)                          */
/* ------------------------------------------------------------------ */
const CODE_TO_NAME: Record<string, string> = {
  AD: 'andorra', AE: 'united-arab-emirates', AF: 'afghanistan', AG: 'antigua-and-barbuda', AI: 'anguilla', AL: 'albania', AM: 'armenia', AO: 'angola', AQ: 'antarctica', AR: 'argentina', AS: 'american-samoa', AT: 'austria', AU: 'australia', AW: 'aruba', AX: 'aland-islands', AZ: 'azerbaijan', BA: 'bosnia-and-herzegovina', BB: 'barbados', BD: 'bangladesh', BE: 'belgium', BF: 'burkina-faso', BG: 'bulgaria', BH: 'bahrain', BI: 'burundi', BJ: 'benin', BL: 'saint-barthelemy', BM: 'bermuda', BN: 'brunei', BO: 'bolivia', BQ: 'caribbean-netherlands', BR: 'brazil', BS: 'bahamas', BT: 'bhutan', BV: 'bouvet-island', BW: 'botswana', BY: 'belarus', BZ: 'belize', CA: 'canada', CC: 'cocos-islands', CD: 'congo-kinshasa', CF: 'central-african-republic', CG: 'congo-brazzaville', CH: 'switzerland', CI: 'cote-divoire', CK: 'cook-islands', CL: 'chile', CM: 'cameroon', CN: 'china', CO: 'colombia', CR: 'costa-rica', CU: 'cuba', CV: 'cape-verde', CW: 'curacao', CX: 'christmas-island', CY: 'cyprus', CZ: 'czech-republic', DE: 'germany', DJ: 'djibouti', DK: 'denmark', DM: 'dominica', DO: 'dominican-republic', DZ: 'algeria', EC: 'ecuador', EE: 'estonia', EG: 'egypt', EH: 'western-sahara', ER: 'eritrea', ES: 'spain', ET: 'ethiopia', FI: 'finland', FJ: 'fiji', FK: 'falkland-islands', FM: 'micronesia', FO: 'faroe-islands', FR: 'france', GA: 'gabon', GB: 'united-kingdom', GD: 'grenada', GE: 'georgia', GF: 'french-guiana', GG: 'guernsey', GH: 'ghana', GI: 'gibraltar', GL: 'greenland', GM: 'gambia', GN: 'guinea', GP: 'guadeloupe', GQ: 'equatorial-guinea', GR: 'greece', GS: 'south-georgia', GT: 'guatemala', GU: 'guam', GW: 'guinea-bissau', GY: 'guyana', HK: 'hong-kong-sar-china', HM: 'heard-island', HN: 'honduras', HR: 'croatia', HT: 'haiti', HU: 'hungary', ID: 'indonesia', IE: 'ireland', IL: 'israel', IM: 'isle-of-man', IN: 'india', IO: 'british-indian-ocean-territory', IQ: 'iraq', IR: 'iran', IS: 'iceland', IT: 'italy', JE: 'jersey', JM: 'jamaica', JO: 'jordan', JP: 'japan', KE: 'kenya', KG: 'kyrgyzstan', KH: 'cambodia', KI: 'kiribati', KM: 'comoros', KN: 'saint-kitts-and-nevis', KP: 'north-korea', KR: 'south-korea', KW: 'kuwait', KY: 'cayman-islands', KZ: 'kazakhstan', LA: 'laos', LB: 'lebanon', LC: 'saint-lucia', LI: 'liechtenstein', LK: 'sri-lanka', LR: 'liberia', LS: 'lesotho', LT: 'lithuania', LU: 'luxembourg', LV: 'latvia', LY: 'libya', MA: 'morocco', MC: 'monaco', MD: 'moldova', ME: 'montenegro', MF: 'saint-martin', MG: 'madagascar', MH: 'marshall-islands', MK: 'north-macedonia', ML: 'mali', MM: 'myanmar', MN: 'mongolia', MO: 'macau-sar-china', MP: 'northern-mariana-islands', MQ: 'martinique', MR: 'mauritania', MS: 'montserrat', MT: 'malta', MU: 'mauritius', MV: 'maldives', MW: 'malawi', MX: 'mexico', MY: 'malaysia', MZ: 'mozambique', NA: 'namibia', NC: 'new-caledonia', NE: 'niger', NF: 'norfolk-island', NG: 'nigeria', NI: 'nicaragua', NL: 'netherlands', NO: 'norway', NP: 'nepal', NR: 'nauru', NU: 'niue', NZ: 'new-zealand', OM: 'oman', PA: 'panama', PE: 'peru', PF: 'french-polynesia', PG: 'papua-new-guinea', PH: 'philippines', PK: 'pakistan', PL: 'poland', PM: 'saint-pierre-and-miquelon', PN: 'pitcairn', PR: 'puerto-rico', PS: 'palestine', PT: 'portugal', PW: 'palau', PY: 'paraguay', QA: 'qatar', RE: 'reunion', RO: 'romania', RS: 'serbia', RU: 'russia', RW: 'rwanda', SA: 'saudi-arabia', SB: 'solomon-islands', SC: 'seychelles', SD: 'sudan', SE: 'sweden', SG: 'singapore', SH: 'saint-helena', SI: 'slovenia', SJ: 'svalbard-and-jan-mayen', SK: 'slovakia', SL: 'sierra-leone', SM: 'san-marino', SN: 'senegal', SO: 'somalia', SR: 'suriname', SS: 'south-sudan', ST: 'sao-tome-and-principe', SV: 'el-salvador', SX: 'sint-maarten', SY: 'syria', SZ: 'eswatini', TC: 'turks-and-caicos', TD: 'chad', TF: 'french-southern-territories', TG: 'togo', TH: 'thailand', TJ: 'tajikistan', TK: 'tokelau', TL: 'timor-leste', TM: 'turkmenistan', TN: 'tunisia', TO: 'tonga', TR: 'turkey', TT: 'trinidad-and-tobago', TV: 'tuvalu', TW: 'taiwan', TZ: 'tanzania', UA: 'ukraine', UG: 'uganda', UM: 'us-outlying-islands', US: 'united-states', UY: 'uruguay', UZ: 'uzbekistan', VA: 'vatican-city', VC: 'saint-vincent-and-the-grenadines', VE: 'venezuela', VG: 'british-virgin-islands', VI: 'us-virgin-islands', VN: 'vietnam', VU: 'vanuatu', WF: 'wallis-and-futuna', WS: 'samoa', XK: 'kosovo', YE: 'yemen', YT: 'mayotte', ZA: 'south-africa', ZM: 'zambia', ZW: 'zimbabwe',
};
const SPECIAL: Record<string, string> = {
  'hong kong': 'hong-kong-sar-china', hongkong: 'hong-kong-sar-china', macau: 'macau-sar-china', macao: 'macau-sar-china',
  usa: 'united-states', us: 'united-states', 'united states': 'united-states', uk: 'united-kingdom', 'united kingdom': 'united-kingdom',
  uae: 'united-arab-emirates', korea: 'south-korea', 'south korea': 'south-korea', 'north korea': 'north-korea',
  'czech republic': 'czech-republic', 'russian federation': 'russia', burma: 'myanmar', bosnia: 'bosnia-and-herzegovina',
};

export function flagIcon(location: unknown): string | null {
  const raw = String(location || '').trim();
  if (!raw) return null;
  if (/^[A-Z]{2}$/.test(raw)) {
    const n = CODE_TO_NAME[raw];
    return n ? `emojione-v1:flag-for-${n}` : null;
  }
  let lower = raw.toLowerCase();
  for (const p of ['the ', 'republic of ', 'kingdom of ', 'state of ', 'federation of ', 'union of ', 'commonwealth of ', 'democratic republic of the ', 'democratic republic of ', "people's republic of ", 'republic of the ', 'united states of ', 'united kingdom of ']) {
    if (lower.startsWith(p)) { lower = lower.slice(p.length); break; }
  }
  if (SPECIAL[lower]) return `emojione-v1:flag-for-${SPECIAL[lower]}`;
  const slug = lower.replace(/\s+/g, '-').replace(/,/g, '').replace(/--+/g, '-').replace(/^-|-$/g, '');
  return slug ? `emojione-v1:flag-for-${slug}` : null;
}

export function cpuBrandIcon(model: unknown): string | null {
  const m = String(model || '').toLowerCase();
  if (!m) return null;
  if (m.includes('apple')) return 'logos:apple';
  if (m.includes('intel')) return 'logos:intel';
  if (m.includes('amd') || m.includes('epyc') || m.includes('ryzen')) return 'logos:amd';
  if (/arm|aarch64|cortex|neoverse|ampere|graviton|snapdragon|kirin|exynos|mediatek|dimensity|rockchip|allwinner|broadcom bcm/.test(m)) return 'logos:arm';
  return null;
}
