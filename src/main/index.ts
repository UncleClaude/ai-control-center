import { join } from 'node:path'
import { app, ipcMain, nativeTheme, screen, WebContentsView, type BaseWindow, type IpcMainEvent } from 'electron'
import { z } from 'zod'
import { IPC, type GlassPreference, type Platform, type ShellState, type SiteRole } from '../shared/protocol'
import { loadAiConfig } from './config'
import { detectGlass, type GlassInfo } from './glass'
import { installMenu } from './menu'
import { preloadPath } from './paths'
import { chromeMajor, chromeUserAgent, firefoxIdentity } from './sessions'
import { attachShortcuts, type ShortcutHandlers } from './shortcuts'
import { store } from './store'
import { AppTray } from './tray'
import { ViewManager } from './views'
import { createMainWindow, siteBackground } from './window'

// Stable, space-free profile directory: ~/.config/ai-control-center, ~/Library/Application Support/ai-control-center
// AICC_PROFILE=<name> runs a separate profile (own sessions, own single-instance lock) for testing.
const profile = process.env.AICC_PROFILE?.replace(/[^\w-]/g, '')
app.setPath('userData', join(app.getPath('appData'), profile ? `ai-control-center-${profile}` : 'ai-control-center'))
app.userAgentFallback = chromeUserAgent()

let win: BaseWindow | null = null
let shellView: WebContentsView | null = null
let views: ViewManager | null = null
let tray: AppTray | null = null
let glass: GlassInfo
let quitting = false
let badges: Record<string, number> = {}

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
    ais: (views?.ais ?? []).map((ai) => ({ id: ai.id, name: ai.name, icon: ai.iconDataUrl, accent: ai.accent })),
    activeId: views?.activeId ?? null,
    loading,
    badges,
    canGoBack: history?.canGoBack() ?? false,
    canGoForward: history?.canGoForward() ?? false,
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
  ipcMain.on(IPC.select, (e, id) => fromShell(e) && views?.select(Id.parse(id)))
  ipcMain.on(IPC.nav, (e, action) => fromShell(e) && views?.nav(Nav.parse(action)))
  ipcMain.on(IPC.layout, (e, rect) => fromShell(e) && views?.setContentRect(RectSchema.parse(rect)))
  ipcMain.on(IPC.windowControl, (e, action) => {
    if (!fromShell(e) || !win) return
    const a = WinAction.parse(action)
    if (a === 'minimize') win.minimize()
    else if (a === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else win.close()
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

// ---------- Window ----------

function glassPreference(): GlassPreference {
  const env = process.env.AICC_GLASS
  return env === 'glass' || env === 'solid' || env === 'auto' ? env : store.state.prefs.glass
}

function createWindow(): void {
  const ais = loadAiConfig()
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
  views = new ViewManager(window, ais, siteBackground())

  const handlers: ShortcutHandlers = {
    selectIndex: (i) => views?.selectIndex(i),
    nav: (a, ignoreCache) => views?.nav(a, ignoreCache),
    toggleDevTools: () => views?.toggleDevTools(),
    quit,
  }
  installMenu(ais, handlers)
  attachShortcuts(shellView.webContents, handlers)
  for (const e of views.views.values()) attachShortcuts(e.view.webContents, handlers)
  views.on('changed', () => {
    pushState()
    const id = views?.activeId
    if (id && id !== store.state.lastAiId) store.update((s) => (s.lastAiId = id))
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
    if (!process.argv.includes('--hidden')) win?.show()
  })

  const last = store.state.lastAiId
  views.start(last && ais.some((a) => a.id === last) ? last : null)

  tray = new AppTray(ais, {
    toggleWindow,
    openAi: (id) => showWindow(id),
    isCloseToTray: () => store.state.prefs.closeToTray,
    setCloseToTray: (value) => store.update((s) => (s.prefs.closeToTray = value)),
    quit,
  })

  window.on('closed', () => {
    nativeTheme.off('updated', onTheme)
    tray?.destroy()
    tray = null
    win = null
    shellView = null
    views = null
  })
}

// ---------- App lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(() => {
    store.load()
    registerIpc()
    createWindow()
  })
  // macOS: clicking the Dock icon brings the hidden window back.
  app.on('activate', () => showWindow())
  app.on('before-quit', () => {
    quitting = true
    store.flush()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
