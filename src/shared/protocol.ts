// Types and channel names shared by main, preloads and the shell renderer.

export type Platform = 'darwin' | 'linux' | 'win32'
export type NavAction = 'back' | 'forward' | 'reload'
export type WindowAction = 'minimize' | 'maximize' | 'close'
export type GlassMode = 'vibrancy' | 'blur' | 'tint' | 'solid'
export type GlassPreference = 'auto' | 'glass' | 'solid'
export type ThemePreference = 'system' | 'light' | 'dark'
export type AiAction = 'clear-cache' | 'sign-out'

export interface AiPublic {
  id: string
  name: string
  /** data: URL, safe for the shell CSP. */
  icon: string
  accent: string
}

export interface ShellState {
  platform: Platform
  glass: GlassMode
  maximized: boolean
  fullscreen: boolean
  focused: boolean
  ais: AiPublic[]
  activeId: string | null
  loading: Record<string, boolean>
  badges: Record<string, number>
  canGoBack: boolean
  canGoForward: boolean
  /** Live appearance preferences the shell applies itself. */
  appearance: { tint: number; reduceMotion: boolean }
  /** App version, for the update prompt. */
  version: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const IPC = {
  getState: 'shell:get-state',
  state: 'shell:state',
  select: 'shell:select',
  nav: 'shell:nav',
  layout: 'shell:layout',
  windowControl: 'shell:window',
  siteRole: 'site:role',
  /** site → main: adapter detection (AdapterEvent) */
  siteEvent: 'site:event',
  /** site → main: adapter diagnostics, printed in the terminal */
  siteLog: 'site:log',
  /** site → main: a notification the page itself tried to show */
  webNotification: 'site:web-notification',
  /** main → site: the native notification relaying a web one was clicked */
  webNotificationClick: 'site:web-notification-click',
  /** main → shell: play the notification chime */
  playSound: 'shell:play-sound',
  /** main → shell: open the settings panel (menu / shortcut) */
  openSettings: 'shell:open-settings',
  settingsVisible: 'shell:settings-visible',
  getSettings: 'shell:get-settings',
  setSettings: 'shell:set-settings',
  openPath: 'shell:open-path',
  testNotification: 'shell:test-notification',
  aiAction: 'shell:ai-action',
  /** shell → main: create a new AI (instance of an existing one, or a custom service). */
  addAi: 'shell:add-ai',
  /** shell → main: delete a user-added AI. */
  removeAi: 'shell:remove-ai',
  /** shell → main: rename an AI. */
  renameAi: 'shell:rename-ai',
  /** shell → main: set (PNG data URL) or reset (null) an AI's logo. */
  setAiIcon: 'shell:set-ai-icon',
  /** main → shell: a browser sign-in is in progress / finished for an AI. */
  loginStatus: 'shell:login-status',
  /** shell → main: the overlay's finish / cancel / reopen buttons. */
  loginAction: 'shell:login-action',
  checkUpdate: 'shell:check-update',
  applyUpdate: 'shell:apply-update',
  /** main → shell: download progress (0–1) while applying an update. */
  updateProgress: 'shell:update-progress',
  /** main → shell: an update was found at startup; prompt the user. */
  updateAvailable: 'shell:update-available',
} as const

/** A newer release, as surfaced to the shell (download URLs stay in main). */
export interface UpdateInfoPublic {
  version: string
  notes: string
  pageUrl: string
  /** true on platforms where the app can fetch and apply it itself (Linux AppImage). */
  selfInstall: boolean
}
export type UpdateApply = 'relaunch' | 'quit' | 'opened' | 'page'

export type LoginState = 'watching' | 'searching' | 'none-found' | 'done' | 'timeout' | 'cancelled'
export type LoginAction = 'finish' | 'cancel' | 'reopen' | 'fda'

/** Progress of a browser sign-in hand-off, pushed to the shell to drive the overlay. */
export interface LoginStatus {
  aiId: string
  state: LoginState
  /** On 'done': how the session was found. */
  browser?: string
  imported?: number
  /** Extra line for the overlay: detected browsers while watching, or a hint on failure. */
  detail?: string
  /** macOS without Full Disk Access: the overlay shows upfront guidance + an open-settings button. */
  needsFda?: boolean
}

export interface WebNotificationPayload {
  id: string
  title: string
  body: string
  tag: string
}

export interface AiSettings {
  notifications: boolean
  sound: boolean
  skin: boolean
  /** Shown in the rail, shortcuts and tray (a hidden AI is not loaded). */
  enabled: boolean
  /** Effective accent; `accentCustom` says whether it overrides ais.json. */
  accent: string
  accentCustom: boolean
  zoom: number
  /** One of the three bundled AIs: can be hidden and renamed, but not deleted. */
  builtIn: boolean
  /** The service URL, shown on custom entries. */
  url: string
  /** The logo was replaced by the user (so a reset-to-default button can show). */
  iconCustom: boolean
}

/** Create a new AI entry: a fresh instance of an existing AI (own login), or a custom service. */
export type AddAiSpec =
  | { kind: 'instance'; baseId: string; name?: string }
  | { kind: 'custom'; name: string; url: string }

/** Result of add / remove / rename: the refreshed settings, plus the new id (on add) or an error. */
export interface MutateAiResult {
  settings: Settings
  id?: string
  error?: string
}

export interface Settings {
  closeToTray: boolean
  glass: GlassPreference
  /** Mode actually in use (the preference applies at next launch). */
  glassActive: GlassMode
  glassReason: string
  theme: ThemePreference
  /** Accent share in the window and site surfaces, in percent (0–30). */
  tint: number
  reduceMotion: boolean
  launchAtLogin: boolean
  startHidden: boolean
  /** Why launch at login is unavailable (e.g. running from sources); null when supported. */
  launchUnsupported: string | null
  /** 'last' or an AI id. */
  startupAi: string
  globalShortcut: boolean
  globalShortcutKey: string
  /** Registration failure for the global shortcut, if any. */
  globalShortcutError: string | null
  doNotDisturb: boolean
  autoUpdate: boolean
  /** Rail order (ids, every configured AI). */
  order: string[]
  ai: Record<string, AiSettings>
  /** Every configured AI, hidden ones included, in rail order. */
  ais: AiPublic[]
  configPath: string
  skinsPath: string
  dataPath: string
  version: string
  versions: { electron: string; chrome: string }
}

export interface AiSettingsPatch {
  notifications?: boolean
  sound?: boolean
  skin?: boolean
  enabled?: boolean
  /** null restores the ais.json colour. */
  accent?: string | null
  zoom?: number
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'closeToTray'
    | 'glass'
    | 'theme'
    | 'tint'
    | 'reduceMotion'
    | 'launchAtLogin'
    | 'startHidden'
    | 'startupAi'
    | 'globalShortcut'
    | 'globalShortcutKey'
    | 'doNotDisturb'
    | 'autoUpdate'
    | 'order'
  >
> & {
  ai?: Record<string, AiSettingsPatch>
}

export interface ShellApi {
  getState(): Promise<ShellState>
  onState(listener: (state: ShellState) => void): () => void
  onPlaySound(listener: () => void): () => void
  onOpenSettings(listener: () => void): () => void
  setSettingsVisible(visible: boolean): void
  getSettings(): Promise<Settings>
  setSettings(patch: SettingsPatch): Promise<Settings>
  openPath(which: 'config' | 'skins' | 'data'): void
  testNotification(aiId: string): void
  aiAction(aiId: string, action: AiAction): Promise<boolean>
  /** Create a new AI (instance of an existing one, or a custom service like OpenWebUI). */
  addAi(spec: AddAiSpec): Promise<MutateAiResult>
  /** Delete a user-added AI (built-in ones can only be hidden). */
  removeAi(id: string): Promise<MutateAiResult>
  /** Rename an AI. */
  renameAi(id: string, name: string): Promise<MutateAiResult>
  /** Replace an AI's logo with a processed PNG (data URL), or reset it with null. */
  setAiIcon(id: string, dataUrl: string | null): Promise<MutateAiResult>
  /** Browser sign-in progress, pushed from main. */
  onLoginStatus(listener: (status: LoginStatus) => void): () => void
  /** The login overlay's finish / cancel / reopen buttons. */
  loginAction(aiId: string, action: LoginAction): void
  /** Checks GitHub for a newer release (Réglages → Mises à jour). */
  checkUpdate(): Promise<{ update: UpdateInfoPublic | null; error?: string }>
  /** Downloads and applies the pending update; reports progress via onUpdateProgress. */
  applyUpdate(): Promise<{ result?: UpdateApply; error?: string }>
  onUpdateProgress(listener: (fraction: number) => void): () => void
  /** An update found at startup: show the prompt. */
  onUpdateAvailable(listener: (update: UpdateInfoPublic) => void): () => void
  select(id: string): void
  nav(action: NavAction): void
  setContentRect(rect: Rect): void
  windowControl(action: WindowAction): void
}

/** What a site preload learns about the view it runs in. */
export interface SiteRole {
  aiId: string | null
  adapter: string | null
  chromeMajor: string
  /** Identity presented on Google sign-in pages (see GOOGLE_AUTH_HOSTS). */
  firefox: { userAgent: string; appVersion: string; platform: string; oscpu: string }
}

/**
 * Google refuses sign-in from embedded Chromium ("This browser or app may not be secure"), even with
 * a Chrome user agent. On these hosts only, views present themselves as Firefox, which Google
 * accepts. Headers are rewritten in main, navigator properties in the site preload.
 */
export const GOOGLE_AUTH_HOSTS = ['accounts.google.com', 'accounts.youtube.com']

export function isGoogleAuthHost(host: string): boolean {
  return GOOGLE_AUTH_HOSTS.includes(host.toLowerCase())
}
