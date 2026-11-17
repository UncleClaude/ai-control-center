import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { Platform, TerminalConfig } from '../../shared/protocol'
import { icons } from './icons'

const api = window.aicc

/** "#2e3440" + 0.8 → "rgba(46, 52, 64, 0.8)". */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m || alpha >= 1) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`
}

/**
 * The built-in terminal: xterm.js over a real shell (node-pty in main). Its look follows the user's
 * alacritty.toml (re-read each time the panel opens). The shell keeps running while the panel is
 * hidden; it restarts on a key press after it exits.
 */
export class TerminalPanel {
  private open = false
  private term: Terminal | null = null
  private fit: FitAddon | null = null
  private config: TerminalConfig | null = null
  private fontSize = 16
  private running = false
  private exited = false
  private fitQueued = false
  private readonly host: HTMLDivElement
  private readonly title: HTMLSpanElement

  constructor(
    private readonly root: HTMLElement,
    private readonly platform: () => Platform,
    private readonly onVisibility: (open: boolean) => void,
  ) {
    const header = document.createElement('header')
    header.className = 'term-header'
    this.title = document.createElement('span')
    this.title.className = 'term-title'
    this.title.textContent = 'Terminal'
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'icon-btn'
    close.innerHTML = icons.close
    close.title = 'Fermer (Ctrl+`)'
    close.setAttribute('aria-label', 'Fermer le terminal')
    close.addEventListener('click', () => this.hide())
    header.append(this.title, close)
    this.host = document.createElement('div')
    this.host.className = 'term-host'
    root.append(header, this.host)

    api.onTermData((d) => this.term?.write(d))
    api.onTermExit((code) => {
      this.running = false
      this.exited = true
      this.term?.write(`\r\n\x1b[2m[processus terminé (${code}) — appuie sur une touche pour relancer]\x1b[0m\r\n`)
    })
    new ResizeObserver(() => this.queueFit()).observe(this.host)
  }

  get isOpen(): boolean {
    return this.open
  }

  async show(): Promise<void> {
    this.open = true
    this.root.hidden = false
    void this.root.offsetWidth // reflow, so the fade-in transition runs even without a frame
    this.root.classList.add('visible')
    api.setSettingsVisible(true) // hides the AI views behind the panel
    this.onVisibility(true)
    this.config = await api.termConfig()
    if (!this.open) return
    if (this.term) this.apply(this.config)
    else this.create(this.config)
    // Not in a requestAnimationFrame: those don't run while the window isn't painting (hidden,
    // occluded), and the shell must start regardless. Reading the size forces layout.
    this.doFit()
    void this.ensureRunning()
    this.term?.focus()
  }

  hide(): void {
    if (!this.open) return
    this.open = false
    this.root.classList.remove('visible')
    this.root.hidden = true
    api.termFocus(false)
    api.setSettingsVisible(false)
    this.onVisibility(false)
  }

  toggle(): void {
    if (this.open) this.hide()
    else void this.show()
  }

  private options(c: TerminalConfig) {
    // The panel paints the background (colour + window.opacity) once; xterm stays transparent on
    // top of it, so there's no darker double layer.
    const theme: ITheme = { ...c.theme, background: 'rgba(0, 0, 0, 0)' }
    // Quote real family names; generic ones (monospace…) must stay bare.
    const generic = /^(monospace|sans-serif|serif|ui-monospace)$/i
    const families = [c.fontFamily, ...c.fontFallback, 'monospace']
      .filter((f, i, all) => all.indexOf(f) === i)
      .map((f) => (generic.test(f) ? f : `"${f.replace(/"/g, '')}"`))
    return {
      fontFamily: families.join(', '),
      fontSize: this.fontSize,
      scrollback: c.scrollback,
      cursorStyle: c.cursorStyle,
      cursorBlink: c.cursorBlink,
      cursorInactiveStyle: c.cursorInactiveStyle,
      drawBoldTextInBrightColors: c.boldBright,
      allowTransparency: true,
      theme,
    }
  }

  private create(c: TerminalConfig): void {
    this.fontSize = c.fontSize
    this.root.style.setProperty('--term-bg', withAlpha(c.theme.background, c.opacity))
    const term = new Terminal({ ...this.options(c), allowProposedApi: false, macOptionIsMeta: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(this.host)
    this.term = term
    this.fit = fit

    term.onData((d) => {
      if (this.exited) {
        // Any key after the shell exited starts a fresh one (the key itself is dropped).
        this.exited = false
        term.clear()
        void this.ensureRunning()
        return
      }
      api.termInput(d)
    })
    term.onResize(({ cols, rows }) => {
      if (this.running) api.termResize(cols, rows)
    })
    term.onTitleChange((t) => (this.title.textContent = t || 'Terminal'))
    term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (!sel) return
      if (this.platform() === 'linux') api.clipboardWrite(sel, 'selection') // primary selection, like Alacritty
      if (this.config?.copyOnSelect) api.clipboardWrite(sel)
    })
    term.textarea?.addEventListener('focus', () => api.termFocus(true))
    term.textarea?.addEventListener('blur', () => api.termFocus(false))
    term.attachCustomKeyEventHandler((e) => this.onKey(e))
  }

  private apply(c: TerminalConfig): void {
    if (!this.term) return
    this.fontSize = c.fontSize
    this.root.style.setProperty('--term-bg', withAlpha(c.theme.background, c.opacity))
    Object.assign(this.term.options, this.options(c))
  }

  /** Alacritty-style copy / paste and font-size keys; returning false keeps xterm from handling it. */
  private onKey(e: KeyboardEvent): boolean {
    if (e.type !== 'keydown' || !this.term) return true
    const mac = this.platform() === 'darwin'
    const mod = mac ? e.metaKey : e.ctrlKey
    // macOS: ⌘C / ⌘V go through the Edit menu (native copy / paste events xterm already handles).
    if (!mac && e.ctrlKey && e.shiftKey && !e.altKey) {
      if (e.code === 'KeyC') {
        const sel = this.term.getSelection()
        if (sel) api.clipboardWrite(sel)
        return false
      }
      if (e.code === 'KeyV') {
        void api.clipboardRead().then((t) => t && this.term?.paste(t))
        return false
      }
    }
    if (mod && !e.shiftKey && !e.altKey) {
      if (e.key === '=' || e.key === '+') return this.zoom(1)
      if (e.key === '-') return this.zoom(-1)
      if (e.key === '0') return this.zoom(0)
    }
    return true
  }

  private zoom(step: 1 | -1 | 0): false {
    if (!this.term) return false
    const base = this.config?.fontSize ?? 16
    this.fontSize = step === 0 ? base : Math.min(48, Math.max(8, this.fontSize + step))
    this.term.options.fontSize = this.fontSize
    this.doFit()
    return false
  }

  private async ensureRunning(): Promise<void> {
    if (this.running || !this.term) return
    this.doFit()
    const ok = await api.termStart(this.term.cols, this.term.rows)
    this.running = ok
    if (!ok) this.term.write('\x1b[31mImpossible de démarrer le terminal (module pty indisponible).\x1b[0m\r\n')
  }

  private queueFit(): void {
    if (this.fitQueued || !this.open) return
    this.fitQueued = true
    requestAnimationFrame(() => {
      this.fitQueued = false
      this.doFit()
    })
  }

  private doFit(): void {
    if (!this.fit || !this.open || this.host.clientWidth === 0 || this.host.clientHeight === 0) return
    try {
      this.fit.fit()
    } catch {
      /* not laid out yet */
    }
  }
}
