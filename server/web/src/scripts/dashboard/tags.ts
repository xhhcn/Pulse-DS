/** User tags: plain chips, gradient chips (spr:/spy:/spb:) and live traffic chips. */
import { esc } from '../core/dom';
import { bytes, speedMiB } from '../core/format';
import { icon } from '../core/icons';
import type { Server } from './state';

const GRADIENTS: Record<string, string> = {
  r: 'linear-gradient(90deg,#dc2626 0%,#ea580c 50%,#db2777 100%)',
  y: 'linear-gradient(90deg,#ca8a04 0%,#16a34a 50%,#0d9488 100%)',
  b: 'linear-gradient(90deg,#2563eb 0%,#9333ea 50%,#c026d3 100%)',
};

const LIVE_ICON: Record<string, string> = {
  'traffic:in': 'download',
  'traffic:out': 'arrow-up',
  'speed:in': 'arrow-down',
  'speed:out': 'arrow-up',
};

export function liveTagValue(kind: string, s: Server): string {
  switch (kind) {
    case 'traffic:in':
      return bytes(s.totalIn);
    case 'traffic:out':
      return bytes(s.totalOut);
    case 'speed:in':
      return speedMiB(s.netIn);
    case 'speed:out':
      return speedMiB(s.netOut);
    default:
      return '';
  }
}

export function renderTag(tag: string, s: Server): string {
  if (LIVE_ICON[tag]) {
    return `<span class="tag tag-live" data-live-tag="${tag}">${icon(LIVE_ICON[tag], 11)}<span data-live-val>${esc(liveTagValue(tag, s))}</span></span>`;
  }
  if (tag.length > 4 && tag[3] === ':' && /^sp[ryb]$/i.test(tag.slice(0, 3)) && tag.slice(4).trim()) {
    const g = GRADIENTS[tag[2].toLowerCase()];
    const label = tag.slice(4).trim();
    return `<span class="tag tag-gradient" style="background-image:${g}" title="${esc(label)}">${esc(label)}</span>`;
  }
  return `<span class="tag" title="${esc(tag)}">${esc(tag)}</span>`;
}

export function renderTags(s: Server): string {
  return s.tags.map((t) => renderTag(t, s)).join('');
}

export function patchLiveTags(root: ParentNode, s: Server): void {
  root.querySelectorAll<HTMLElement>('[data-live-tag]').forEach((el) => {
    const kind = el.getAttribute('data-live-tag') || '';
    const val = el.querySelector('[data-live-val]');
    if (val) {
      const v = liveTagValue(kind, s);
      if (val.textContent !== v) val.textContent = v;
    }
  });
}
