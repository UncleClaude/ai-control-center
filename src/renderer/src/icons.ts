// Inline stroke icons (24×24, currentColor) so the CSP can stay strict.
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

export const icons = {
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  forward: svg('<path d="m9 18 6-6-6-6"/>'),
  reload: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  // Traffic-light glyphs (shown on hover, macOS style)
  close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.6 3.6l4.8 4.8M8.4 3.6 3.6 8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  minimize: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  maximize: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 8.6V4.9l3.7 3.7zM8.6 3.4v3.7L4.9 3.4z" fill="currentColor"/></svg>',
  restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 6V2.6L2.6 6zM6 6v3.4L9.4 6z" fill="currentColor"/></svg>',
  expand: svg('<path d="m9 18 6-6-6-6"/>'),
  collapse: svg('<path d="m15 18-6-6 6-6"/>'),
}
