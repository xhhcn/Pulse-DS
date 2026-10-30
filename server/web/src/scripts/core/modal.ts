/**
 * Accessible modal controller for `.modal-root` elements:
 * backdrop click / Escape close, focus trap, scroll lock, stacking.
 * Placement is CSS alone (see .modal-root): centred on what it shows.
 */
const openStack: Modal[] = [];

/**
 * Hiding the page's overflow also removes a classic scrollbar (Windows, most
 * Linux desktops), which would shift the page behind the dialog sideways by
 * the scrollbar's width on every open and close: pad the body by that width
 * while the page is locked. Overlay scrollbars measure 0 and change nothing.
 */
function lockPageScroll(): void {
  const gap = window.innerWidth - document.documentElement.clientWidth;
  if (gap > 0) document.body.style.paddingRight = `${gap}px`;
  document.body.classList.add('modal-open');
}

function unlockPageScroll(): void {
  document.body.classList.remove('modal-open');
  document.body.style.paddingRight = '';
}

// Keys reach the dialog on top wherever focus is: clicking text inside a
// dialog, or a focused button disabling itself, leaves focus on the page,
// and Escape (or Tab) would otherwise stop working.
document.addEventListener('keydown', (e) => topModal()?.key(e));

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
    if (openStack.length === 0) lockPageScroll();
    openStack.push(this);
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
      if (openStack.length === 0) unlockPageScroll();
      this.closing = false;
      this.opts.onClose?.();
      const lf = this.lastFocus;
      this.lastFocus = null;
      if (lf && lf.isConnected) { try { lf.focus({ preventScroll: true }); } catch {} }
    }, 150);
  }

  key(e: KeyboardEvent): void {
    // Escape while an input method is composing (Chinese, Japanese…) cancels
    // the composition, not the dialog with the edit in it.
    if (openStack[openStack.length - 1] !== this || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
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
      else if (!e.shiftKey && (active === last || !this.root.contains(active))) { e.preventDefault(); first.focus(); }
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
