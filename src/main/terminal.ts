import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse } from 'smol-toml'
import type { TerminalConfig } from '../shared/protocol'

// Built-in terminal: a real shell in a pty (node-pty, native) rendered by xterm.js in the shell
// window. Its look comes from the user's alacritty.toml so it feels like their Alacritty.

type PtyModule = typeof import('node-pty')
type Pty = ReturnType<PtyModule['spawn']>

let ptyModule: PtyModule | null | undefined
function loadPty(): PtyModule | null {
  if (ptyModule !== undefined) return ptyModule
  try {
    ptyModule = require('node-pty') as PtyModule
  } catch (error) {
    console.error('[terminal] node-pty unavailable:', error)
    ptyModule = null
  }
  return ptyModule
}

// ---------- Alacritty config ----------

type Toml = Record<string, unknown>
const isObj = (v: unknown): v is Toml => !!v && typeof v === 'object' && !Array.isArray(v)

function deepMerge(base: Toml, over: Toml): Toml {
  const out: Toml = { ...base }
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Toml, v) : v
  return out
}

function expandPath(p: string, base: string): string {
  const home = p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
  return isAbsolute(home) ? home : resolve(base, home)
}

/** Parses a config file and the files it imports (themes are usually imported). */
function loadToml(path: string, depth = 0): Toml {
  const raw = parse(readFileSync(path, 'utf8')) as Toml
  const general = isObj(raw.general) ? raw.general : {}
  const imports = (Array.isArray(general.import) ? general.import : Array.isArray(raw.import) ? raw.import : []) as unknown[]
  let merged: Toml = {}
  if (depth < 4) {
    for (const entry of imports) {
      if (typeof entry !== 'string') continue
      const p = expandPath(entry, dirname(path))
      try {
        if (existsSync(p)) merged = deepMerge(merged, loadToml(p, depth + 1))
      } catch (error) {
        console.warn(`[terminal] import ${p} ignored:`, error)
      }
    }
  }
  return deepMerge(merged, raw)
}

function configCandidates(): string[] {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  const list = [join(xdg, 'alacritty', 'alacritty.toml'), join(homedir(), '.config', 'alacritty', 'alacritty.toml'), join(homedir(), '.alacritty.toml')]
  if (process.platform === 'win32' && process.env.APPDATA) list.push(join(process.env.APPDATA, 'alacritty', 'alacritty.toml'))
  return list
}

/** The merged Alacritty config and the file it came from ({} / null when there is none). */
function readAlacritty(): { cfg: Toml; source: string | null } {
  for (const path of configCandidates()) {
    if (!existsSync(path)) continue
    try {
      return { cfg: loadToml(path), source: path }
    } catch (error) {
      console.warn(`[terminal] ${path} unreadable, using defaults:`, error)
      return { cfg: {}, source: null }
    }
  }
  return { cfg: {}, source: null }
}

const get = (o: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), o)

/** "0x2E3440" / "#2e3440" → "#2e3440"; anything else (CellForeground…) → undefined. */
function color(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const m = /^(?:0x|#)?([0-9a-f]{6})$/i.exec(v.trim())
  return m ? `#${m[1].toLowerCase()}` : undefined
}

// Alacritty's own defaults, used for anything the config leaves out.
const DEFAULT_THEME: Record<string, string> = {
  background: '#181818',
  foreground: '#d8d8d8',
  black: '#181818',
  red: '#ac4242',
  green: '#90a959',
  yellow: '#f4bf75',
  blue: '#6a9fb5',
  magenta: '#aa759f',
  cyan: '#75b5aa',
  white: '#d8d8d8',
  brightBlack: '#6b6b6b',
  brightRed: '#c55555',
  brightGreen: '#aac474',
  brightYellow: '#feca88',
  brightBlue: '#82b8c8',
  brightMagenta: '#c28cb8',
  brightCyan: '#93d3c3',
  brightWhite: '#f8f8f8',
}
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

let nerdFont: string | null | undefined
/**
 * An installed Nerd Font, used as fallback for icon glyphs (eza, starship, fish prompts…). Alacritty
 * finds them through fontconfig's fallback; Chromium doesn't search private-use codepoints, so we
 * name one explicitly.
 */
function detectNerdFont(): string | null {
  if (nerdFont !== undefined) return nerdFont
  nerdFont = null
  if (process.platform === 'win32') return null
  try {
    const out = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 3000 })
    const families = [...new Set(out.split('\n').flatMap((l) => l.split(',')).map((s) => s.trim()).filter(Boolean))]
    nerdFont =
      families.find((f) => /^Symbols Nerd Font Mono$/i.test(f)) ??
      families.find((f) => /Nerd Font Mono$/i.test(f)) ??
      families.find((f) => /Nerd Font/i.test(f)) ??
      null
  } catch {
    /* no fontconfig (stock macOS): fall back to the generic list in the shell */
  }
  return nerdFont
}

export function terminalConfig(): TerminalConfig {
  const { cfg, source } = readAlacritty()
  const theme = { ...DEFAULT_THEME }
  const bg = color(get(cfg, 'colors', 'primary', 'background'))
  const fg = color(get(cfg, 'colors', 'primary', 'foreground'))
  if (bg) theme.background = bg
  if (fg) theme.foreground = fg
  for (const name of ANSI) {
    const n = color(get(cfg, 'colors', 'normal', name))
    const b = color(get(cfg, 'colors', 'bright', name))
    if (n) theme[name] = n
    if (b) theme[`bright${name[0].toUpperCase()}${name.slice(1)}`] = b
  }
  const cursor = color(get(cfg, 'colors', 'cursor', 'cursor'))
  const cursorText = color(get(cfg, 'colors', 'cursor', 'text'))
  theme.cursor = cursor ?? theme.foreground
  theme.cursorAccent = cursorText ?? theme.background
  const selBg = color(get(cfg, 'colors', 'selection', 'background'))
  const selFg = color(get(cfg, 'colors', 'selection', 'text'))
  theme.selectionBackground = selBg ? `${selBg}cc` : `${theme.foreground}55`
  if (selFg) theme.selectionForeground = selFg

  const family = get(cfg, 'font', 'normal', 'family')
  const size = get(cfg, 'font', 'size')
  // cursor.style is either "Block" or { shape, blinking }.
  const style = get(cfg, 'cursor', 'style')
  const shape = String((isObj(style) ? style.shape : style) ?? 'Block').toLowerCase()
  const blinking = String((isObj(style) ? style.blinking : get(cfg, 'cursor', 'blinking')) ?? 'Off').toLowerCase()
  const cursorStyle = shape === 'underline' ? 'underline' : shape === 'beam' ? 'bar' : 'block'
  const opacity = Number(get(cfg, 'window', 'opacity'))
  const history = Number(get(cfg, 'scrolling', 'history'))

  return {
    fontFamily: typeof family === 'string' && family.trim() ? family.trim() : 'monospace',
    fontFallback: [detectNerdFont(), 'Symbols Nerd Font Mono', 'Symbols Nerd Font'].filter((f): f is string => !!f),
    // Alacritty sizes are points; xterm wants CSS pixels.
    fontSize: Math.round((typeof size === 'number' && size > 0 ? size : 11.25) * (4 / 3)),
    scrollback: Number.isFinite(history) && history >= 0 ? Math.min(history, 100_000) : 10_000,
    cursorStyle,
    cursorBlink: blinking === 'on' || blinking === 'always',
    cursorInactiveStyle: get(cfg, 'cursor', 'unfocused_hollow') === false ? cursorStyle : 'outline',
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
    boldBright: get(cfg, 'colors', 'draw_bold_text_with_bright_colors') === true,
    copyOnSelect: get(cfg, 'selection', 'save_to_clipboard') === true,
    theme,
    source,
  }
}

// ---------- Shell process ----------

/** Shell to run: [terminal] shell (or legacy [shell]) from the config, else the user's login shell. */
function shellCommand(cfg: Toml): { file: string; args: string[] } {
  const configured = get(cfg, 'terminal', 'shell') ?? get(cfg, 'shell')
  if (typeof configured === 'string' && configured) return { file: configured, args: [] }
  if (isObj(configured) && typeof configured.program === 'string') {
    return { file: configured.program, args: Array.isArray(configured.args) ? configured.args.map(String) : [] }
  }
  if (process.platform === 'win32') return { file: 'powershell.exe', args: [] }
  // Like Alacritty: the login shell from the user database (/etc/passwd), not $SHELL, which an
  // app inherits from whatever launched it and may be stale.
  let login = ''
  try {
    login = userInfo().shell ?? ''
  } catch {
    /* no passwd entry */
  }
  const shell = (login && existsSync(login) ? login : '') || process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  // macOS terminals start login shells (that's how the PATH from /etc/paths gets set).
  return { file: shell, args: process.platform === 'darwin' ? ['-l'] : [] }
}

/**
 * The environment for the shell: ours, minus what Electron and the AppImage runtime inject (an
 * AppImage puts its own lib / bin dirs on LD_LIBRARY_PATH, PATH… which would break system tools).
 */
function shellEnv(cfg: Toml): Record<string, string> {
  const env: Record<string, string> = {}
  const mount = process.env.APPDIR
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (/^(APPDIR|APPIMAGE|ARGV0|OWD|ELECTRON_|CHROME_|CHROMIUM_)/.test(k)) continue
    env[k] = v
  }
  // Electron rewrites XDG_CURRENT_DESKTOP on Linux and keeps the real one aside.
  if (env.ORIGINAL_XDG_CURRENT_DESKTOP) {
    env.XDG_CURRENT_DESKTOP = env.ORIGINAL_XDG_CURRENT_DESKTOP
    delete env.ORIGINAL_XDG_CURRENT_DESKTOP
  }
  if (mount) {
    for (const k of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'PERLLIB', 'GSETTINGS_SCHEMA_DIR', 'QT_PLUGIN_PATH', 'PYTHONPATH', 'PYTHONHOME']) {
      if (!env[k]) continue
      const parts = env[k].split(':').filter((p) => p && !p.startsWith(mount))
      if (parts.length) env[k] = parts.join(':')
      else delete env[k]
    }
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'AI-Control-Center'
  const extra = get(cfg, 'env')
  if (isObj(extra)) for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') env[k] = v
  return env
}

function workingDirectory(cfg: Toml): string {
  const wd = get(cfg, 'general', 'working_directory') ?? get(cfg, 'working_directory')
  if (typeof wd === 'string' && wd && wd !== 'None') {
    const p = expandPath(wd, homedir())
    if (existsSync(p)) return p
  }
  return homedir()
}

export class TerminalManager {
  private proc: Pty | null = null
  private buffer = ''
  private flushQueued = false

  constructor(
    private readonly onData: (data: string) => void,
    private readonly onExit: (code: number) => void,
  ) {}

  get running(): boolean {
    return this.proc !== null
  }

  /** Starts the shell if it isn't running; returns false when no pty is available. */
  start(cols: number, rows: number): boolean {
    if (this.proc) {
      this.resize(cols, rows)
      return true
    }
    const pty = loadPty()
    if (!pty) return false
    const { cfg } = readAlacritty()
    const { file, args } = shellCommand(cfg)
    try {
      this.proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: Math.max(2, cols),
        rows: Math.max(2, rows),
        cwd: workingDirectory(cfg),
        env: shellEnv(cfg),
      })
    } catch (error) {
      console.error(`[terminal] cannot start ${file}:`, error)
      this.proc = null
      return false
    }
    this.proc.onData((d) => {
      // Coalesce bursts (e.g. `cat` of a big file) into one IPC message per tick.
      this.buffer += d
      if (this.flushQueued) return
      this.flushQueued = true
      setImmediate(() => this.flush())
    })
    this.proc.onExit(({ exitCode }) => {
      this.flush()
      this.proc = null
      this.onExit(exitCode)
    })
    return true
  }

  private flush(): void {
    this.flushQueued = false
    if (!this.buffer) return
    const out = this.buffer
    this.buffer = ''
    this.onData(out)
  }

  write(data: string): void {
    this.proc?.write(data)
  }

  resize(cols: number, rows: number): void {
    if (!this.proc || cols < 2 || rows < 2) return
    try {
      this.proc.resize(cols, rows)
    } catch {
      /* exited meanwhile */
    }
  }

  kill(): void {
    try {
      this.proc?.kill()
    } catch {
      /* already gone */
    }
    this.proc = null
  }
}
