/**
 * Track input modality: focus rings are drawn only after keyboard navigation
 * (html.kb). Pointer use and programmatic focus never show an outline.
 */
let installed = false;
export function installFocusMode(): void {
  if (installed) return;
  installed = true;
  const html = document.documentElement;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === ' ') html.classList.add('kb');
  }, true);
  window.addEventListener('pointerdown', () => html.classList.remove('kb'), true);
}
