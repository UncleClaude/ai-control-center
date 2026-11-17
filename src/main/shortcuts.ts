import type { WebContents } from 'electron'
import type { NavAction } from '../shared/protocol'

export interface ShortcutHandlers {
  selectIndex(index: number): void
  nav(action: NavAction, ignoreCache?: boolean): void
  toggleDevTools(): void
  quit(): void
  openSettings(): void
  /** +1 / -1 step, 0 = reset. */
  zoom(step: 1 | -1 | 0): void
  /** Show / hide the built-in terminal. */
  toggleTerminal(): void
}

const isMac = process.platform === 'darwin'

/**
 * App shortcuts, caught before the page sees them, in every view (shell and sites).
 * Physical key codes are used so they work on AZERTY too (Ctrl+1 is "&" there).
 */
export function attachShortcuts(contents: WebContents, h: ShortcutHandlers, terminalFocused?: () => boolean): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = isMac ? input.meta : input.control
    const key = input.key
    const code = input.code

    // Ctrl+` (⌘` on macOS) toggles the terminal from anywhere.
    if (mod && !input.shift && !input.alt && code === 'Backquote') {
      h.toggleTerminal()
      event.preventDefault()
      return
    }
    // The terminal owns the keyboard: Ctrl+R, Ctrl+[ (Esc), Ctrl+Q, Ctrl+=… must reach the shell.
    // Only AI switching (Ctrl+1…9) stays global.
    if (terminalFocused?.()) {
      if (mod && !input.shift && /^Digit[1-9]$/.test(code)) {
        h.selectIndex(Number(code.slice(5)) - 1)
        event.preventDefault()
      }
      return
    }

    let handled = true
    if (mod && !input.shift && /^Digit[1-9]$/.test(code)) h.selectIndex(Number(code.slice(5)) - 1)
    else if (mod && code === 'KeyR') h.nav('reload', input.shift)
    else if (mod && (key === '[' || code === 'BracketLeft')) h.nav('back')
    else if (mod && (key === ']' || code === 'BracketRight')) h.nav('forward')
    else if (!isMac && input.alt && !mod && key === 'ArrowLeft') h.nav('back')
    else if (!isMac && input.alt && !mod && key === 'ArrowRight') h.nav('forward')
    else if (!isMac && input.control && !input.shift && code === 'KeyQ') h.quit()
    else if (mod && !input.shift && (code === 'Comma' || key === ',')) h.openSettings()
    else if (mod && (key === '+' || key === '=' || code === 'NumpadAdd')) h.zoom(1)
    else if (mod && !input.shift && (key === '-' || code === 'NumpadSubtract')) h.zoom(-1)
    else if (mod && !input.shift && (code === 'Digit0' || code === 'Numpad0')) h.zoom(0)
    else if (key === 'F5') h.nav('reload', input.control)
    else if (key === 'F12' || (mod && input.shift && code === 'KeyI') || (isMac && input.meta && input.alt && code === 'KeyI'))
      h.toggleDevTools()
    else handled = false

    if (handled) event.preventDefault()
  })
}
