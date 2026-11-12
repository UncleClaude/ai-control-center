// Inline stroke icons (24×24, currentColor) so the CSP can stay strict.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  forward: svg('<path d="m9 18 6-6-6-6"/>'),
  reload: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  minimize: svg('<path d="M6 12h12"/>'),
  maximize: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  restore: svg('<rect x="5" y="9" width="10" height="10" rx="2"/><path d="M9 5h8a2 2 0 0 1 2 2v8"/>'),
  close: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
  expand: svg('<path d="m9 18 6-6-6-6"/>'),
  collapse: svg('<path d="m15 18-6-6 6-6"/>'),
}
