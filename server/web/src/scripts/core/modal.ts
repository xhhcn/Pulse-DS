/**
 * Accessible modal controller for `.modal-root` elements:
 * backdrop click / Escape close, focus trap, scroll lock, stacking.
 */
const openStack: Modal[] = [];

export interface ModalOptions {
  onClose?: () => void;
  /** Return false to veto closing (e.g. while saving). */
  beforeClose?: () => boolean;
}

export class Modal {
  readonly root: HTMLElement;
  private panel: HTMLElement;
  private lastFocus: HTMLElement | null = null;
  private closing = false;
  private opts: ModalOptions;

  constructor(root: HTMLElement, opts: ModalOptions = {}) {
    this.root = root;
    this.opts = opts;
    this.panel = root.querySelector('.modal-panel') as HTMLElement;
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    root.querySelector('.modal-backdrop')?.addEventListener('click', () => this.close());
    root.querySelectorAll<HTMLElement>('[data-modal-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    root.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.root.classList.remove('is-closing');
    this.root.setAttribute('aria-hidden', 'false');
    if (this.root.parentElement !== document.body) document.body.appendChild(this.root);
    openStack.push(this);
    document.body.classList.add('modal-open');
    // Resolve the focus target *after* the opener has finished filling the
    // dialog (buttons may get disabled meanwhile); a disabled target would
    // leave focus on the page and Escape would no longer reach the dialog.
    window.setTimeout(() => {
      if (!this.isOpen) return;
      let target = this.root.querySelector<HTMLElement>('[data-autofocus]');
      if (!target || (target as HTMLButtonElement).disabled) target = this.firstFocusable();
      if (!target) {
        target = this.panel;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      }
      target.focus({ preventScroll: true });
    }, 30);
  }

  close(): void {
    if (!this.isOpen || this.closing) return;
    if (this.opts.beforeClose && this.opts.beforeClose() === false) return;
    this.closing = true;
    this.root.classList.add('is-closing');
    window.setTimeout(() => {
      this.root.hidden = true;
      this.root.classList.remove('is-closing');
      this.root.setAttribute('aria-hidden', 'true');
      const i = openStack.indexOf(this);
      if (i >= 0) openStack.splice(i, 1);
      if (openStack.length === 0) document.body.classList.remove('modal-open');
      this.closing = false;
      this.opts.onClose?.();
      const lf = this.lastFocus;
      this.lastFocus = null;
      if (lf && lf.isConnected) { try { lf.focus({ preventScroll: true }); } catch {} }
    }, 150);
  }

  private onKey(e: KeyboardEvent): void {
    if (openStack[openStack.length - 1] !== this) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key === 'Tab') {
      const items = this.focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement;
      if (e.shiftKey && (active === first || !this.root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(
      this.root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === this.panel);
  }

  private firstFocusable(): HTMLElement | null {
    return this.focusables()[0] || null;
  }
}

export function topModal(): Modal | null {
  return openStack[openStack.length - 1] || null;
}
