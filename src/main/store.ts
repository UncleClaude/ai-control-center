import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { GlassPreference, ThemePreference } from '../shared/protocol'

export interface AiPrefs {
  notifications: boolean
  sound: boolean
  skin: boolean
  enabled: boolean
  /** Overrides the ais.json accent; null = use it. */
  accent: string | null
  zoom: number
}

export interface Prefs {
  closeToTray: boolean
  glass: GlassPreference
  theme: ThemePreference
  tint: number
  reduceMotion: boolean
  launchAtLogin: boolean
  startHidden: boolean
  startupAi: string
  globalShortcut: boolean
  globalShortcutKey: string
  doNotDisturb: boolean
  order: string[]
  ai: Record<string, AiPrefs>
}

export interface AppState {
  window: { width: number; height: number; x?: number; y?: number; maximized: boolean }
  lastAiId: string | null
  prefs: Prefs
}

const DEFAULTS: AppState = {
  window: { width: 1280, height: 840, maximized: false },
  lastAiId: null,
  prefs: {
    closeToTray: true,
    glass: 'auto',
    theme: 'system',
    tint: 11,
    reduceMotion: false,
    launchAtLogin: false,
    startHidden: true,
    startupAi: 'last',
    globalShortcut: false,
    globalShortcutKey: 'CommandOrControl+Shift+Space',
    doNotDisturb: false,
    order: [],
    ai: {},
  },
}

export const DEFAULT_AI_PREFS: AiPrefs = { notifications: true, sound: false, skin: true, enabled: true, accent: null, zoom: 1 }

/** Small JSON store in userData/state.json: window geometry, last AI, preferences. */
class Store {
  private data: AppState = structuredClone(DEFAULTS)
  private timer: NodeJS.Timeout | null = null
  private file = ''

  load(): void {
    this.file = join(app.getPath('userData'), 'state.json')
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AppState>
      this.data = {
        window: { ...DEFAULTS.window, ...raw.window },
        lastAiId: raw.lastAiId ?? null,
        prefs: { ...DEFAULTS.prefs, ...raw.prefs, ai: { ...raw.prefs?.ai } },
      }
    } catch (error) {
      console.error('[store] state.json illisible, valeurs par défaut :', error)
    }
  }

  get state(): Readonly<AppState> {
    return this.data
  }

  aiPrefs(id: string): AiPrefs {
    return { ...DEFAULT_AI_PREFS, ...this.data.prefs.ai[id] }
  }

  update(mutate: (s: AppState) => void): void {
    mutate(this.data)
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 400)
  }

  /** Atomic write (tmp + rename) so a crash never leaves a half-written file. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.file)
    } catch (error) {
      console.error('[store] écriture impossible :', error)
    }
  }
}

export const store = new Store()
