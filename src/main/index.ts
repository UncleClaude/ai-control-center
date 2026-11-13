import { join } from 'node:path'
import { app, globalShortcut, ipcMain, nativeTheme, screen, shell, WebContentsView, type BaseWindow, type IpcMainEvent } from 'electron'
import { z } from 'zod'
import { IPC, type AiPublic, type GlassPreference, type LoginState, type LoginStatus, type Platform, type Settings, type ShellState, type SiteRole } from '../shared/protocol'
import { detectBrowsers, hasSession, readCookies, type BrowserProfile } from './browser-cookies'
import { configFilePath, loadAiConfig, type AiConfig } from './config'
import { detectGlass, type GlassInfo } from './glass'
import { installMenu } from './menu'
import { openExternal } from './navigation'
import { NotificationHub } from './notifications'
import { preloadPath } from './paths'
import { chromeMajor, chromeUserAgent, firefoxIdentity } from './sessions'
import { attachShortcuts, type ShortcutHandlers } from './shortcuts'
import { SkinManager, userSkinDir } from './skins'
import { applyGlobalShortcut, applyLaunchAtLogin, launchUnsupported, startsHidden } from './startup'
import { store } from './store'
import { applyUpdate, checkForUpdate, relaunchForUpdate, type UpdateInfo } from './updater'
import { AppTray } from './tray'
import { ViewManager, type AiView } from './views'
import { createMainWindow, siteBackground } from './window'

// Stable, space-free profile directory: ~/.config/ai-control-center, ~/Library/Application Support/ai-control-center
// AICC_PROFILE=<name> runs a separate profile (own sessions, own single-instance lock) for testing.
const profile = process.env.AICC_PROFILE?.replace(/[^\w-]/g, '')
app.setPath('userData', join(app.getPath('appData'), profile ? `ai-control-center-${profile}` : 'ai-control-center'))
app.userAgentFallback = chromeUserAgent()
// Global shortcuts under Wayland go through the XDG GlobalShortcuts portal (KDE, Hyprland, GNOME 48+).
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

let win: BaseWindow | null = null
let shellView: WebContentsView | null = null
let views: ViewManager | null = null
let tray: AppTray | null = null
let skins: SkinManager | null = null
let hub: NotificationHub | null = null
let glass: GlassInfo
let quitting = false
let badges: Record<string, number> = {}
let shortcutError: string | null = null
/** The newest release found by a check, kept so applyUpdate knows what to download. */
let pendingUpdate: UpdateInfo | null = null

function publicUpdate(info: UpdateInfo): { version: string; notes: string; pageUrl: string; selfInstall: boolean } {
  const selfInstall = process.platform === 'linux' && !!process.env.APPIMAGE && !!info.asset
  return { version: info.version, notes: info.notes.slice(0, 2000), pageUrl: info.pageUrl, selfInstall }
}
/** ais.json accents, before the user's per-AI overrides. */
const baseAccent = new Map<string, string>()

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

// ---------- AI order and visibility ----------

/** Every configured AI, in the user's rail order (new ones at the end, in ais.json order). */
function orderedAis(): AiConfig[] {
  const all = views?.ais ?? []
  const order = store.state.prefs.order
  const rank = (ai: AiConfig) => {
    const i = order.indexOf(ai.id)
    return i === -1 ? order.length + all.indexOf(ai) : i
  }
  return [...all].sort((a, b) => rank(a) - rank(b))
}

/** What the rail, shortcuts and tray show. */
function visibleAis(): AiConfig[] {
  return orderedAis().filter((ai) => store.aiPrefs(ai.id).enabled)
}

const publicAi = (ai: AiConfig): AiPublic => ({ id: ai.id, name: ai.name, icon: ai.iconDataUrl, accent: ai.accent })

function applyAccent(ai: AiConfig): void {
  ai.accent = store.aiPrefs(ai.id).accent ?? baseAccent.get(ai.id) ?? ai.accent
}

// ---------- Shell state ----------

function shellState(): ShellState {
  const loading: Record<string, boolean> = {}
  for (const [id, e] of views?.views ?? []) loading[id] = e.loaded && e.view.webContents.isLoading()
  const history = views?.active?.view.webContents.navigationHistory
  return {
    platform: process.platform as Platform,
    glass: glass.mode,
    maximized: win?.isMaximized() ?? false,
    fullscreen: win?.isFullScreen() ?? false,
    focused: win?.isFocused() ?? false,
    ais: visibleAis().map(publicAi),
    activeId: views?.activeId ?? null,
    loading,
    badges,
    canGoBack: history?.canGoBack() ?? false,
    canGoForward: history?.canGoForward() ?? false,
    appearance: { tint: store.state.prefs.tint, reduceMotion: store.state.prefs.reduceMotion },
    version: app.getVersion(),
  }
}

let pushQueued = false
function pushState(): void {
  if (pushQueued) return
  pushQueued = true
  setImmediate(() => {
    pushQueued = false
    if (shellView && !shellView.webContents.isDestroyed()) shellView.webContents.send(IPC.state, shellState())
  })
}

// ---------- Window visibility ----------

function showWindow(aiId?: string): void {
  if (!win) return
  if (aiId) views?.select(aiId)
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  views?.active?.view.webContents.focus()
}

function toggleWindow(): void {
  if (!win) return
  if (win.isVisible() && !win.isMinimized() && win.isFocused()) win.hide()
  else showWindow()
}

/** The user is looking at this AI right now. */
function isViewing(aiId: string): boolean {
  return !!win && win.isVisible() && !win.isMinimized() && win.isFocused() && views?.activeId === aiId
}

function markSeen(): void {
  const id = views?.activeId
  if (id && isViewing(id)) hub?.seen(id)
}

function quit(): void {
  quitting = true
  app.quit()
}

// ---------- Geometry persistence ----------

function restoredBounds(): Partial<Electron.Rectangle> {
  const w = store.state.window
  const bounds: Partial<Electron.Rectangle> = { width: w.width, height: w.height }
  // Positions only matter where the platform lets clients place windows (not Wayland).
  if (w.x !== undefined && w.y !== undefined) {
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      w.x! < a.x + a.width - 80 && w.x! + w.width > a.x + 80 && w.y! >= a.y - 10 && w.y! < a.y + a.height - 80,
    )
    if (visible) Object.assign(bounds, { x: w.x, y: w.y })
  }
  return bounds
}

function trackGeometry(window: BaseWindow): void {
  const save = () => {
    if (window.isDestroyed() || window.isFullScreen()) return
    const maximized = window.isMaximized()
    const b = window.getNormalBounds()
    store.update((s) => {
      s.window = { width: b.width, height: b.height, maximized, ...(process.env.WAYLAND_DISPLAY ? {} : { x: b.x, y: b.y }) }
    })
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize'] as const) window.on(ev as 'resize', save)
}

// ---------- IPC ----------

function fromShell(event: { sender: Electron.WebContents }): boolean {
  return !!shellView && event.sender === shellView.webContents
}

function registerIpc(): void {
  const Id = z.string().max(64)
  const Nav = z.enum(['back', 'forward', 'reload'])
  const WinAction = z.enum(['minimize', 'maximize', 'close'])
  const RectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })

  ipcMain.handle(IPC.getState, (e) => (fromShell(e) ? shellState() : null))
  ipcMain.on(IPC.select, (e, id) => {
    const target = Id.parse(id)
    if (fromShell(e) && store.aiPrefs(target).enabled) views?.select(target)
  })
  ipcMain.on(IPC.nav, (e, action) => fromShell(e) && views?.nav(Nav.parse(action)))
  ipcMain.on(IPC.layout, (e, rect) => fromShell(e) && views?.setContentRect(RectSchema.parse(rect)))
  ipcMain.on(IPC.windowControl, (e, action) => {
    if (!fromShell(e) || !win) return
    const a = WinAction.parse(action)
    if (a === 'minimize') win.minimize()
    else if (a === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else win.close()
  })
  const AdapterEventSchema = z.object({
    kind: z.enum(['generating', 'done', 'needs-input']),
    snippet: z.string().max(400),
    key: z.string().max(600),
    url: z.string().max(2000),
  })
  const WebNotificationSchema = z.object({
    id: z.string().max(40),
    title: z.string().max(200),
    body: z.string().max(500),
    tag: z.string().max(120),
  })
  const aiOf = (e: { sender: Electron.WebContents }) => views?.fromContents(e.sender)?.ai
  ipcMain.on(IPC.siteEvent, (e, payload) => {
    const ai = aiOf(e)
    const event = AdapterEventSchema.safeParse(payload)
    if (ai && event.success) hub?.adapter(ai.id, event.data)
  })
  ipcMain.on(IPC.webNotification, (e, payload) => {
    const ai = aiOf(e)
    const n = WebNotificationSchema.safeParse(payload)
    if (ai && n.success) hub?.web(ai.id, n.data)
  })
  ipcMain.on(IPC.siteLog, (e, level, message) => {
    const ai = aiOf(e)
    if (!ai || typeof message !== 'string') return
    ;(level === 'warn' ? console.warn : console.info)(`[adapter:${ai.id}] ${message.slice(0, 600)}`)
  })

  // ---- Settings ----
  const settings = (): Settings => {
    const p = store.state.prefs
    const ordered = orderedAis()
    return {
      closeToTray: p.closeToTray,
      glass: p.glass,
      glassActive: glass.mode,
      glassReason: glass.reason,
      theme: p.theme,
      tint: p.tint,
      reduceMotion: p.reduceMotion,
      launchAtLogin: p.launchAtLogin,
      startHidden: p.startHidden,
      launchUnsupported: launchUnsupported(),
      startupAi: p.startupAi,
      globalShortcut: p.globalShortcut,
      globalShortcutKey: p.globalShortcutKey,
      globalShortcutError: shortcutError,
      doNotDisturb: p.doNotDisturb,
      autoUpdate: p.autoUpdate,
      order: ordered.map((ai) => ai.id),
      ai: Object.fromEntries(
        ordered.map((ai) => {
          const prefs = store.aiPrefs(ai.id)
          return [
            ai.id,
            {
              notifications: prefs.notifications,
              sound: prefs.sound,
              skin: prefs.skin,
              enabled: prefs.enabled,
              accent: ai.accent,
              accentCustom: prefs.accent !== null,
              zoom: prefs.zoom,
            },
          ]
        }),
      ),
      ais: ordered.map(publicAi),
      configPath: configFilePath(),
      skinsPath: userSkinDir(),
      dataPath: app.getPath('userData'),
      version: app.getVersion(),
      versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    }
  }
  const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
  const AiPatch = z
    .object({
      notifications: z.boolean(),
      sound: z.boolean(),
      skin: z.boolean(),
      enabled: z.boolean(),
      accent: Hex.nullable(),
      zoom: z.number().min(0.5).max(2),
    })
    .partial()
  const Patch = z.object({
    closeToTray: z.boolean().optional(),
    glass: z.enum(['auto', 'glass', 'solid']).optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    tint: z.number().int().min(0).max(30).optional(),
    reduceMotion: z.boolean().optional(),
    launchAtLogin: z.boolean().optional(),
    startHidden: z.boolean().optional(),
    startupAi: z.string().max(64).optional(),
    globalShortcut: z.boolean().optional(),
    globalShortcutKey: z.string().min(1).max(80).optional(),
    doNotDisturb: z.boolean().optional(),
    autoUpdate: z.boolean().optional(),
    order: z.array(Id).max(64).optional(),
    ai: z.record(Id, AiPatch).optional(),
  })
  ipcMain.handle(IPC.getSettings, (e) => (fromShell(e) ? settings() : null))
  ipcMain.handle(IPC.setSettings, (e, raw) => {
    if (!fromShell(e)) return null
    const patch = Patch.parse(raw)
    const known = (id: string) => !!views?.views.has(id)
    let skinChanged = patch.tint !== undefined
    let railChanged = !!patch.order
    store.update((s) => {
      const { ai: aiPatch, order, ...general } = patch
      Object.assign(s.prefs, Object.fromEntries(Object.entries(general).filter(([, v]) => v !== undefined)))
      if (order) s.prefs.order = order.filter(known)
      for (const [id, p] of Object.entries(aiPatch ?? {})) {
        if (!known(id)) continue
        const next = { ...store.aiPrefs(id), ...p }
        // At least one AI stays visible.
        if (p.enabled === false && visibleAis().every((ai) => ai.id === id)) next.enabled = true
        s.prefs.ai[id] = next
        if (p.skin !== undefined || p.accent !== undefined) skinChanged = true
        if (p.enabled !== undefined || p.accent !== undefined) railChanged = true
      }
    })
    for (const [id, p] of Object.entries(patch.ai ?? {})) {
      const ai = views?.views.get(id)?.ai
      if (!ai) continue
      if (p.accent !== undefined) applyAccent(ai)
      if (p.zoom !== undefined) views?.setZoom(id, store.aiPrefs(id).zoom)
      if (p.enabled) views?.ensureLoaded(id)
    }
    // The active AI was hidden: move to the first visible one.
    const active = views?.activeId
    if (active && !store.aiPrefs(active).enabled) views?.select(visibleAis()[0]?.id)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if (patch.launchAtLogin !== undefined || patch.startHidden !== undefined) {
      applyLaunchAtLogin(store.state.prefs.launchAtLogin, store.state.prefs.startHidden)
    }
    if (patch.globalShortcut !== undefined || patch.globalShortcutKey !== undefined) registerGlobalShortcut()
    if (skinChanged) skins?.refreshAll()
    if (railChanged) installMenu(visibleAis(), handlers)
    tray?.refresh()
    pushState()
    return settings()
  })
  ipcMain.on(IPC.loginAction, (e, id, action) => {
    if (!fromShell(e)) return
    const act = z.enum(['finish', 'cancel', 'reopen']).parse(action)
    void handleLoginAction(Id.parse(id), act)
  })

  ipcMain.handle(IPC.checkUpdate, async (e) => {
    if (!fromShell(e)) return { update: null }
    try {
      pendingUpdate = await checkForUpdate()
      return { update: pendingUpdate ? publicUpdate(pendingUpdate) : null }
    } catch (error) {
      return { update: null, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(IPC.applyUpdate, async (e) => {
    if (!fromShell(e) || !pendingUpdate) return { error: 'aucune mise à jour en attente' }
    try {
      const result = await applyUpdate(pendingUpdate, (f) => shellView?.webContents.send(IPC.updateProgress, f))
      if (result === 'relaunch') relaunchForUpdate()
      return { result }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.aiAction, async (e, id, action) => {
    if (!fromShell(e)) return false
    const entry = views?.views.get(Id.parse(id))
    const kind = z.enum(['clear-cache', 'sign-out']).parse(action)
    if (!entry) return false
    const wc = entry.view.webContents
    await wc.session.clearCache()
    if (kind === 'sign-out') {
      // Cookies, local storage, IndexedDB, service workers: the AI starts signed out.
      await wc.session.clearStorageData()
      hub?.seen(entry.ai.id)
      if (entry.loaded) void wc.loadURL(entry.ai.url)
    } else if (entry.loaded) wc.reloadIgnoringCache()
    console.info(`[settings] ${entry.ai.id} : ${kind === 'sign-out' ? 'données effacées' : 'cache vidé'}`)
    return true
  })
  ipcMain.on(IPC.settingsVisible, (e, visible) => fromShell(e) && views?.setOverlay(visible === true))
  ipcMain.on(IPC.openPath, (e, which) => {
    if (!fromShell(e)) return
    if (which === 'config') void shell.openPath(configFilePath())
    else if (which === 'skins') void shell.openPath(userSkinDir())
    else if (which === 'data') void shell.openPath(app.getPath('userData'))
  })
  ipcMain.on(IPC.testNotification, (e, id) => {
    if (fromShell(e) && typeof id === 'string' && views?.views.has(id)) hub?.test(id)
  })

  // Site preloads ask (synchronously, at startup) which AI they belong to.
  ipcMain.on(IPC.siteRole, (e: IpcMainEvent) => {
    const entry = views?.fromContents(e.sender)
    const role: SiteRole = {
      aiId: entry?.ai.id ?? null,
      adapter: entry?.ai.adapter ?? null,
      chromeMajor,
      firefox: firefoxIdentity(),
    }
    e.returnValue = role
  })
}

// ---------- Browser sign-in hand-off ----------
// When the user picks a provider that blocks embedded login (Google, Apple), the flow opens in the
// real browser; the app then watches that browser for the AI's session cookie and imports it.

// Known session-cookie names, so completion is detected the instant the user is signed in.
const SESSION_COOKIES: Record<string, string[]> = {
  claude: ['sessionKey'],
  chatgpt: ['__Secure-next-auth.session-token', '__Secure-next-auth.session-token.0'],
}

interface LoginWatch {
  timer: NodeJS.Timeout
  deadline: number
}
const loginWatches = new Map<string, LoginWatch>()

function aiHost(ai: AiConfig): string {
  try {
    return new URL(ai.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
/** The AI's own domains (never the shared Google/Apple identity hosts): the session cookie lives here. */
function aiDomains(ai: AiConfig): string[] {
  return [...new Set([aiHost(ai), ...ai.allowedDomains].filter(Boolean))]
}
function sessionNames(ai: AiConfig): string[] {
  return SESSION_COOKIES[ai.adapter ?? ''] ?? []
}

function sendLogin(aiId: string, state: LoginState, extra?: { browser?: string; imported?: number; detail?: string }): void {
  shellView?.webContents.send(IPC.loginStatus, { aiId, state, ...extra } satisfies LoginStatus)
}

/** What the overlay shows about where the session can come from, and OS-specific gotchas. */
function loginDetail(found: BrowserProfile[], failure: boolean): string {
  if (found.length === 0) {
    const where = process.platform === 'darwin' ? 'Chrome, Safari…' : 'Firefox, Chrome…'
    return `Aucun navigateur détecté (${where}). Connecte-toi dans un navigateur installé normalement.`
  }
  const names = found.map((b) => b.label).join(', ')
  if (!failure) return `Navigateur${found.length > 1 ? 's' : ''} détecté${found.length > 1 ? 's' : ''} : ${names}.`
  // After a failed scan, the usual macOS causes are permission walls.
  if (process.platform === 'darwin') {
    return `Détecté : ${names}, mais pas de session lisible. Avec Chrome, autorise l’accès au trousseau quand macOS le demande. Avec Safari, donne à l’app l’Accès complet au disque (Réglages Système → Confidentialité et sécurité).`
  }
  return `Détecté : ${names}, mais aucune session pour ce site. Es-tu bien connecté dans ce navigateur ?`
}

/** Injects the AI-domain cookies from one browser profile and reloads; returns how many landed. */
async function importFrom(entry: AiView, profile: BrowserProfile): Promise<number> {
  let cookies
  try {
    cookies = readCookies(profile, aiDomains(entry.ai))
  } catch (error) {
    console.error(`[login] ${entry.ai.id} ← ${profile.label} : ${error instanceof Error ? error.message : error}`)
    return 0
  }
  const ses = entry.view.webContents.session
  let imported = 0
  for (const c of cookies) {
    try {
      await ses.cookies.set({
        url: c.url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expirationDate,
        sameSite: c.sameSite,
      })
      imported++
    } catch {
      // One malformed cookie (e.g. SameSite=None without Secure) must not abort the import.
    }
  }
  if (imported > 0) {
    entry.loaded = true
    await ses.cookies.flushStore()
    entry.view.webContents.loadURL(entry.ai.url)
    console.info(`[login] ${entry.ai.id} ← ${profile.label} : ${imported}/${cookies.length} cookies importés`)
  }
  return imported
}

/** Scans browsers for a completed session for this AI and imports the first one found. */
async function tryImport(entry: AiView): Promise<string | null> {
  const host = aiHost(entry.ai)
  const names = sessionNames(entry.ai)
  for (const profile of detectBrowsers()) {
    if (!hasSession(profile, host, names)) continue
    if ((await importFrom(entry, profile)) > 0) return profile.label
  }
  return null
}

function stopLoginWatch(aiId: string): void {
  const w = loginWatches.get(aiId)
  if (w) clearInterval(w.timer)
  loginWatches.delete(aiId)
}

/** A blocked provider was reached: open the sign-in in the browser and poll for the session. */
function startBrowserLogin(aiId: string): void {
  const entry = views?.views.get(aiId)
  if (!entry) return
  showWindow(aiId)
  openExternal(entry.ai.url)
  views?.setLoginOverlay(aiId)
  sendLogin(aiId, 'watching', { detail: loginDetail(detectBrowsers(), false) })
  stopLoginWatch(aiId)
  const deadline = Date.now() + 180_000
  const timer = setInterval(() => {
    void (async () => {
      if (!loginWatches.has(aiId)) return
      const label = await tryImport(entry)
      if (label) {
        stopLoginWatch(aiId)
        views?.setLoginOverlay(null)
        sendLogin(aiId, 'done', { browser: label })
      } else if (Date.now() > deadline) {
        stopLoginWatch(aiId)
        sendLogin(aiId, 'timeout', { detail: loginDetail(detectBrowsers(), true) })
      }
    })()
  }, 2500)
  loginWatches.set(aiId, { timer, deadline })
}

async function handleLoginAction(aiId: string, action: 'finish' | 'cancel' | 'reopen'): Promise<void> {
  const entry = views?.views.get(aiId)
  if (!entry) return
  if (action === 'reopen') {
    openExternal(entry.ai.url)
    return
  }
  if (action === 'cancel') {
    stopLoginWatch(aiId)
    views?.setLoginOverlay(null)
    sendLogin(aiId, 'cancelled')
    return
  }
  // finish: import now from whichever browser already has the session.
  sendLogin(aiId, 'searching')
  const label = await tryImport(entry)
  if (label) {
    stopLoginWatch(aiId)
    views?.setLoginOverlay(null)
    sendLogin(aiId, 'done', { browser: label })
  } else {
    sendLogin(aiId, 'none-found', { detail: loginDetail(detectBrowsers(), true) })
  }
}

/** At launch: look for a newer release and, if found, ask the shell to prompt the user. */
async function checkUpdatesAtStartup(): Promise<void> {
  try {
    pendingUpdate = await checkForUpdate()
    if (pendingUpdate) {
      console.info(`[update] version ${pendingUpdate.version} disponible`)
      shellView?.webContents.send(IPC.updateAvailable, publicUpdate(pendingUpdate))
    }
  } catch (error) {
    console.info(`[update] vérification impossible : ${error instanceof Error ? error.message : error}`)
  }
}

// ---------- Shortcuts ----------

function zoomActive(step: 1 | -1 | 0): void {
  const id = views?.activeId
  if (!id) return
  const current = store.aiPrefs(id).zoom
  let next = 1
  if (step !== 0) {
    const i = ZOOM_STEPS.findIndex((z) => z >= current - 0.001)
    const at = i === -1 ? ZOOM_STEPS.length - 1 : i
    next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + step))]
  }
  store.update((s) => (s.prefs.ai[id] = { ...store.aiPrefs(id), zoom: next }))
  views?.setZoom(id, next)
}

const handlers: ShortcutHandlers = {
  selectIndex: (i) => {
    const ai = visibleAis()[i]
    if (ai) views?.select(ai.id)
  },
  nav: (a, ignoreCache) => views?.nav(a, ignoreCache),
  toggleDevTools: () => views?.toggleDevTools(),
  quit,
  openSettings: () => {
    showWindow()
    shellView?.webContents.send(IPC.openSettings)
  },
  zoom: zoomActive,
}

function registerGlobalShortcut(): void {
  const p = store.state.prefs
  shortcutError = applyGlobalShortcut(p.globalShortcut, p.globalShortcutKey, toggleWindow)
  if (shortcutError) console.warn(`[shortcut] ${p.globalShortcutKey} : ${shortcutError}`)
}

// ---------- Window ----------

function glassPreference(): GlassPreference {
  const env = process.env.AICC_GLASS
  return env === 'glass' || env === 'solid' || env === 'auto' ? env : store.state.prefs.glass
}

function createWindow(): void {
  const ais = loadAiConfig()
  for (const ai of ais) {
    baseAccent.set(ai.id, ai.accent)
    applyAccent(ai)
  }
  nativeTheme.themeSource = store.state.prefs.theme
  glass = detectGlass(glassPreference())
  console.info(`[glass] mode ${glass.mode} (${glass.reason})`)
  const window = createMainWindow(glass, restoredBounds())
  win = window
  if (store.state.window.maximized) window.maximize()
  trackGeometry(window)

  shellView = new WebContentsView({
    webPreferences: { preload: preloadPath('shell'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // Transparent so the vibrancy / compositor blur shows through the shell's glass.
  shellView.setBackgroundColor('#00000000')
  // The shell is added first so it sits under the AI views; it draws the chrome and reports
  // where the content card is.
  window.contentView.addChildView(shellView)
  views = new ViewManager(window, ais, siteBackground(), {
    enabled: (id) => store.aiPrefs(id).enabled,
    zoom: (id) => store.aiPrefs(id).zoom,
    onBlockedAuth: (id) => startBrowserLogin(id),
  })

  installMenu(visibleAis(), handlers)
  attachShortcuts(shellView.webContents, handlers)
  for (const e of views.views.values()) attachShortcuts(e.view.webContents, handlers)
  views.on('changed', () => {
    pushState()
    markSeen()
    const id = views?.activeId
    if (id && id !== store.state.lastAiId) store.update((s) => (s.lastAiId = id))
  })
  // Switching AI (or the user dismissing it) ends an in-progress browser sign-in.
  views.on('login-cancelled', (aiId) => {
    stopLoginWatch(aiId)
    sendLogin(aiId, 'cancelled')
  })

  const layoutShell = () => {
    if (!win || !shellView) return
    const { width, height } = win.getContentBounds()
    shellView.setBounds({ x: 0, y: 0, width, height })
  }
  window.on('resize', layoutShell)
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'] as const) {
    window.on(ev as 'focus', pushState)
  }
  layoutShell()

  // Closing hides into the tray unless disabled (or we are really quitting).
  window.on('close', (event) => {
    if (quitting || !store.state.prefs.closeToTray) return
    event.preventDefault()
    if (process.platform === 'darwin' && window.isFullScreen()) {
      window.once('leave-full-screen', () => window.hide())
      window.setFullScreen(false)
    } else window.hide()
  })

  const onTheme = () => views?.setBackground(siteBackground())
  nativeTheme.on('updated', onTheme)

  shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shellView.webContents.on('will-navigate', (e) => e.preventDefault())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void shellView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void shellView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  shellView.webContents.once('did-finish-load', () => {
    if (!startsHidden(store.state.prefs.startHidden)) win?.show()
    // Check GitHub for a newer release shortly after launch, then prompt (if enabled).
    if (store.state.prefs.autoUpdate) setTimeout(() => void checkUpdatesAtStartup(), 3500)
  })

  skins = new SkinManager(
    (id) => process.env.AICC_SKINS !== '0' && store.aiPrefs(id).skin,
    (contents) => views?.fromContents(contents)?.ai,
    () => store.state.prefs.tint,
  )
  for (const e of views.views.values()) skins.attach(e.view.webContents)

  hub = new NotificationHub({
    ais,
    prefs: (id) => store.aiPrefs(id),
    doNotDisturb: () => store.state.prefs.doNotDisturb,
    isViewing,
    open: (id, url) => {
      showWindow(id)
      const wc = views?.views.get(id)?.view.webContents
      if (wc && url && url !== wc.getURL()) void wc.loadURL(url)
    },
    clickWeb: (id, webId) => views?.views.get(id)?.view.webContents.send(IPC.webNotificationClick, webId),
    playSound: () => shellView?.webContents.send(IPC.playSound),
  })
  hub.on('badges', (counts) => {
    badges = counts
    pushState()
    tray?.setBadges(counts)
    app.setBadgeCount(Object.values(counts).reduce((a, b) => a + b, 0))
  })
  window.on('focus', markSeen)
  window.on('show', markSeen)

  const pref = store.state.prefs.startupAi
  const initial = pref === 'last' ? store.state.lastAiId : pref
  views.start(initial && visibleAis().some((a) => a.id === initial) ? initial : (visibleAis()[0]?.id ?? null))

  tray = new AppTray(visibleAis, {
    toggleWindow,
    openAi: (id) => showWindow(id),
    isCloseToTray: () => store.state.prefs.closeToTray,
    setCloseToTray: (value) => store.update((s) => (s.prefs.closeToTray = value)),
    isDoNotDisturb: () => store.state.prefs.doNotDisturb,
    setDoNotDisturb: (value) => store.update((s) => (s.prefs.doNotDisturb = value)),
    quit,
  })

  registerGlobalShortcut()
  // Keep the login item pointing at the current executable (an AppImage may have moved).
  if (store.state.prefs.launchAtLogin) applyLaunchAtLogin(true, store.state.prefs.startHidden)

  window.on('closed', () => {
    nativeTheme.off('updated', onTheme)
    tray?.destroy()
    tray = null
    skins?.dispose()
    skins = null
    hub = null
    win = null
    shellView = null
    views = null
  })
}

// ---------- App lifecycle ----------

/**
 * Single instance. A packaged app brings its existing window forward; in development a new
 * `npm run dev` replaces the running instance (often hidden in the tray with stale code).
 */
const isDev = !app.isPackaged

function startup(): void {
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    if (isDev && (data as { replace?: boolean } | undefined)?.replace) {
      console.info('[dev] remplacée par une nouvelle instance')
      quit()
      return
    }
    showWindow()
  })
  app.whenReady().then(() => {
    store.load()
    registerIpc()
    createWindow()
  })
  // macOS: clicking the Dock icon brings the hidden window back.
  app.on('activate', () => showWindow())
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('before-quit', () => {
    quitting = true
    store.flush()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

if (app.requestSingleInstanceLock({ replace: isDev })) {
  startup()
} else if (isDev) {
  // The running instance has been asked to quit: take over once its lock is released.
  let tries = 0
  const retry = () => {
    if (app.requestSingleInstanceLock({ replace: false })) startup()
    else if (++tries < 40) setTimeout(retry, 250)
    else {
      console.error("[dev] l'instance déjà ouverte ne s'est pas fermée : quittez-la (tray → Quitter)")
      app.quit()
    }
  }
  setTimeout(retry, 400)
} else {
  app.quit()
}
