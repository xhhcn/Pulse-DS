/** Tiny DOM helpers. All dynamic markup goes through esc() / attr(). */

/**
 * Reduce untrusted SVG markup (operator logo, icon CDN responses) to inert
 * drawing: scripts, foreign content, event handlers and links are removed.
 * Returns null when the input is not a usable <svg>.
 */
export function sanitizeSvg(src: string, size?: number): string | null {
  try {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg || doc.querySelector('parsererror')) return null;
    svg.querySelectorAll('script, foreignObject, iframe, object, embed, animate, set').forEach((n) => n.remove());
    svg.querySelectorAll('*').forEach((n) => {
      Array.from(n.attributes).forEach((a) => {
        const name = a.name.toLowerCase();
        const val = a.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'href' || name === 'xlink:href' || val.startsWith('javascript:')) n.removeAttribute(a.name);
        else if (name === 'style' && /url\s*\(|expression|javascript:/i.test(val)) n.removeAttribute(a.name);
      });
    });
    if (size) {
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
    }
    return svg.outerHTML;
  } catch {
    return null;
  }
}

export function esc(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
export const attr = esc;

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as T;
}

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector(sel) as T | null;
}

export function qsa<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll(sel)) as T[];
}

export function setText(node: Element | null, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Flash a "copied" state on a button that contains .i-copy / .i-check icons. */
export function flashCopied(btn: HTMLElement, ok: boolean, okTitle: string, failTitle: string): void {
  const copy = btn.querySelector<HTMLElement>('.i-copy');
  const check = btn.querySelector<HTMLElement>('.i-check');
  const original = btn.getAttribute('title') || '';
  if (ok && copy && check) {
    copy.hidden = true;
    check.hidden = false;
    btn.classList.add('is-copied');
  }
  btn.setAttribute('title', ok ? okTitle : failTitle);
  window.setTimeout(() => {
    if (copy && check) { copy.hidden = false; check.hidden = true; }
    btn.classList.remove('is-copied');
    btn.setAttribute('title', original);
  }, 1400);
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let timer: number | null = null;
  return ((...args: any[]) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = null; fn(...args); }, ms);
  }) as T;
}
