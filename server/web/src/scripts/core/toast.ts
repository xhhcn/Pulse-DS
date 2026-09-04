let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (!host || !host.isConnected) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message: string, kind: 'ok' | 'err' | 'info' = 'info', ms = 3200): void {
  const h = ensureHost();
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  const dot = document.createElement('span');
  dot.className = 'ti';
  const text = document.createElement('span');
  text.textContent = message;
  node.append(dot, text);
  h.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('is-leaving');
    window.setTimeout(() => node.remove(), 180);
  }, ms);
}
