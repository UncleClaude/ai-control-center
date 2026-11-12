import type { WebContents } from 'electron'
import type { NavAction } from '../shared/protocol'

export interface ShortcutHandlers {
  selectIndex(index: number): void
  nav(action: NavAction, ignoreCache?: boolean): void
  toggleDevTools(): void
  quit(): void
}

const isMac = process.platform === 'darwin'

/**
 * App shortcuts, caught before the page sees them, in every view (shell and sites).
 * Physical key codes are used so they work on AZERTY too (Ctrl+1 is "&" there).
 */
export function attachShortcuts(contents: WebContents, h: ShortcutHandlers): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = isMac ? input.meta : input.control
    const key = input.key
    const code = input.code

    let handled = true
    if (mod && !input.shift && /^Digit[1-9]$/.test(code)) h.selectIndex(Number(code.slice(5)) - 1)
    else if (mod && code === 'KeyR') h.nav('reload', input.shift)
    else if (mod && (key === '[' || code === 'BracketLeft')) h.nav('back')
    else if (mod && (key === ']' || code === 'BracketRight')) h.nav('forward')
    else if (!isMac && input.alt && !mod && key === 'ArrowLeft') h.nav('back')
    else if (!isMac && input.alt && !mod && key === 'ArrowRight') h.nav('forward')
    else if (!isMac && input.control && !input.shift && code === 'KeyQ') h.quit()
    else if (key === 'F5') h.nav('reload', input.control)
    else if (key === 'F12' || (mod && input.shift && code === 'KeyI') || (isMac && input.meta && input.alt && code === 'KeyI'))
      h.toggleDevTools()
    else handled = false

    if (handled) event.preventDefault()
  })
}
