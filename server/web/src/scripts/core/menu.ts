/**
 * A button that opens a menu of choices (the sort and theme menus). One menu
 * is open at a time. Opening one moves focus to its ticked choice; ↑/↓, Home
 * and End move between the choices, which are left out of the Tab order. A
 * choice, a click elsewhere, Escape or Tab closes the menu; a choice and
 * Escape put focus back on the button.
 */
const closers: Array<() => void> = [];

export function menuButton(btn: HTMLElement, menu: HTMLElement, onPick: (item: HTMLElement) => void): void {
  const items = () => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  const isOpen = () => !menu.hidden;
  const close = () => {
    if (!isOpen()) return;
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const focusItem = (which: 'checked' | 'first' | 'last') => {
    const list = items();
    const item = which === 'last' ? list[list.length - 1] : (which === 'checked' && list.find((i) => i.getAttribute('aria-checked') === 'true')) || list[0];
    item?.focus();
  };
  const open = (which: 'checked' | 'first' | 'last') => {
    closers.forEach((c) => c !== close && c());
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    focusItem(which);
  };
  closers.push(close);
  items().forEach((i) => i.setAttribute('tabindex', '-1'));

  btn.addEventListener('click', () => (isOpen() ? close() : open('checked')));
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    open(e.key === 'ArrowUp' ? 'last' : 'checked');
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % list.length;
    else if (e.key === 'ArrowUp') next = at <= 0 ? list.length - 1 : at - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    // Once Tab has moved focus on (out of the page too, where focusout names
    // no element).
    else if (e.key === 'Tab') window.setTimeout(close);
    if (next < 0) return;
    e.preventDefault();
    list[next].focus();
  });
  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[role^="menuitem"]');
    if (!item) return;
    close();
    btn.focus();
    onPick(item);
  });
  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (isOpen() && !menu.contains(target) && !btn.contains(target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    const inside = menu.contains(document.activeElement) || btn === document.activeElement;
    close();
    if (inside) btn.focus();
  });
  // Focus that moves on from the button or a choice to anything else closes
  // the menu (a click that focuses nothing is the click handler's).
  const leave = (e: FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && to !== btn && !menu.contains(to)) close();
  };
  btn.addEventListener('focusout', leave);
  menu.addEventListener('focusout', leave);
}
