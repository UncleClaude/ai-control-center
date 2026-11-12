import { join } from 'node:path'
import { app, BaseWindow, ipcMain, WebContentsView, type IpcMainEvent } from 'electron'
import { z } from 'zod'
import { IPC, type Platform, type ShellState, type SiteRole } from '../shared/protocol'
import { loadAiConfig } from './config'
import { installMenu } from './menu'
import { preloadPath } from './paths'
import { chromeMajor, chromeUserAgent, firefoxIdentity } from './sessions'
import { attachShortcuts, type ShortcutHandlers } from './shortcuts'
import { ViewManager } from './views'

// Stable, space-free profile directory: ~/.config/ai-control-center, ~/Library/Application Support/ai-control-center
app.setPath('userData', join(app.getPath('appData'), 'ai-control-center'))
app.userAgentFallback = chromeUserAgent()

let win: BaseWindow | null = null
let shellView: WebContentsView | null = null
let views: ViewManager | null = null

function shellState(): ShellState {
  const loading: Record<string, boolean> = {}
  for (const [id, e] of views?.views ?? []) loading[id] = e.loaded && e.view.webContents.isLoading()
  const history = views?.active?.view.webContents.navigationHistory
  return {
    platform: process.platform as Platform,
    ais: (views?.ais ?? []).map((ai) => ({ id: ai.id, name: ai.name, icon: ai.iconDataUrl })),
    activeId: views?.activeId ?? null,
    loading,
    badges: {},
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
    const role: SiteRole = { aiId: entry?.ai.id ?? null, adapter: entry?.ai.adapter ?? null, chromeMajor, firefox: firefoxIdentity() }
    e.returnValue = role
  })
}

function createWindow(): void {
  const ais = loadAiConfig()
  win = new BaseWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: 'AI Control Center',
    backgroundColor: '#1c1d22',
    show: false,
  })

  shellView = new WebContentsView({
    webPreferences: { preload: preloadPath('shell'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  // The shell is added first so it sits under the AI views; it draws the sidebar and reports
  // where the content area is.
  win.contentView.addChildView(shellView)
  views = new ViewManager(win, ais)

  const handlers: ShortcutHandlers = {
    selectIndex: (i) => views?.selectIndex(i),
    nav: (a, ignoreCache) => views?.nav(a, ignoreCache),
    toggleDevTools: () => views?.toggleDevTools(),
  }
  installMenu(ais, handlers)
  attachShortcuts(shellView.webContents, handlers)
  for (const e of views.views.values()) attachShortcuts(e.view.webContents, handlers)
  views.on('changed', pushState)

  const layoutShell = () => {
    if (!win || !shellView) return
    const { width, height } = win.getContentBounds()
    shellView.setBounds({ x: 0, y: 0, width, height })
  }
  win.on('resize', layoutShell)
  layoutShell()

  shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shellView.webContents.on('will-navigate', (e) => e.preventDefault())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void shellView.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void shellView.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  shellView.webContents.once('did-finish-load', () => win?.show())

  views.start(null)
  win.on('closed', () => {
    win = null
    shellView = null
    views = null
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  app.whenReady().then(() => {
    registerIpc()
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
