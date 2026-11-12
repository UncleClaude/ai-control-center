import { EventEmitter } from 'node:events'
import type { BaseWindow, WebContents } from 'electron'
import { WebContentsView } from 'electron'
import type { NavAction, Rect } from '../shared/protocol'
import type { AiConfig } from './config'
import { guardNavigation } from './navigation'
import { preloadPath } from './paths'
import { prepareSession } from './sessions'

export interface AiView {
  ai: AiConfig
  view: WebContentsView
  loaded: boolean
}

/**
 * One WebContentsView per AI, all kept alive. Switching only toggles visibility, so a page is
 * never reloaded and a running generation is never interrupted.
 */
export class ViewManager extends EventEmitter<{ changed: [] }> {
  readonly views = new Map<string, AiView>()
  activeId: string | null = null
  private rect: Rect = { x: 0, y: 0, width: 800, height: 600 }

  constructor(
    private readonly win: BaseWindow,
    readonly ais: AiConfig[],
  ) {
    super()
    for (const ai of ais) this.create(ai)
  }

  private create(ai: AiConfig): void {
    const view = new WebContentsView({
      webPreferences: {
        session: prepareSession(ai),
        preload: preloadPath('site'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Hidden views must keep running: generations finish and adapters keep observing.
        backgroundThrottling: false,
        spellcheck: true,
      },
    })
    view.setVisible(false)
    this.win.contentView.addChildView(view)
    const entry: AiView = { ai, view, loaded: false }
    this.views.set(ai.id, entry)

    const wc = view.webContents
    guardNavigation(wc, ai)
    const changed = () => this.emit('changed')
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page'] as const) {
      wc.on(ev as 'did-stop-loading', changed)
    }
    wc.on('render-process-gone', (_e, details) => {
      console.error(`[views] ${ai.id} : processus terminé (${details.reason}), rechargement`)
      if (details.reason !== 'clean-exit') wc.reload()
    })
  }

  private load(entry: AiView): void {
    if (entry.loaded) return
    entry.loaded = true
    void entry.view.webContents.loadURL(entry.ai.url)
  }

  /** Loads the active view first, then the others shortly after so background notifications work. */
  start(initialId: string | null): void {
    const first = this.select(initialId ?? this.ais[0]?.id)
    const rest = () => this.views.forEach((e) => this.load(e))
    const wc = first?.view.webContents
    if (wc) {
      const timer = setTimeout(rest, 4000)
      wc.once('did-finish-load', () => {
        clearTimeout(timer)
        setTimeout(rest, 800)
      })
    } else rest()
  }

  select(id: string | undefined): AiView | undefined {
    const entry = id ? this.views.get(id) : undefined
    if (!entry) return undefined
    this.load(entry)
    for (const [otherId, other] of this.views) other.view.setVisible(otherId === id)
    this.activeId = entry.ai.id
    entry.view.setBounds(this.rect)
    entry.view.webContents.focus()
    this.emit('changed')
    return entry
  }

  selectIndex(index: number): void {
    const ai = this.ais[index]
    if (ai) this.select(ai.id)
  }

  get active(): AiView | undefined {
    return this.activeId ? this.views.get(this.activeId) : undefined
  }

  fromContents(contents: WebContents): AiView | undefined {
    for (const entry of this.views.values()) if (entry.view.webContents === contents) return entry
    return undefined
  }

  setContentRect(rect: Rect): void {
    this.rect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    }
    // Every view keeps the same bounds so a switch never triggers a relayout of the page.
    for (const entry of this.views.values()) entry.view.setBounds(this.rect)
  }

  nav(action: NavAction, ignoreCache = false): void {
    const wc = this.active?.view.webContents
    if (!wc) return
    const history = wc.navigationHistory
    if (action === 'back' && history.canGoBack()) history.goBack()
    else if (action === 'forward' && history.canGoForward()) history.goForward()
    else if (action === 'reload') (ignoreCache ? wc.reloadIgnoringCache() : wc.reload())
  }

  toggleDevTools(): void {
    this.active?.view.webContents.toggleDevTools()
  }
}
