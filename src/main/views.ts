import { EventEmitter } from 'node:events'
import type { BaseWindow, WebContents } from 'electron'
import { WebContentsView } from 'electron'
import type { NavAction, Rect } from '../shared/protocol'
import type { AiConfig } from './config'
import { guardNavigation } from './navigation'
import { preloadPath } from './paths'
import { prepareSession } from './sessions'

export const CARD_RADIUS = 14

export interface ViewPrefs {
  /** Hidden AIs are not loaded. */
  enabled(aiId: string): boolean
  zoom(aiId: string): number
}

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
  /** While the shell shows a panel (settings) over the content area, every view is hidden. */
  private overlaid = false
  private rect: Rect = { x: 0, y: 0, width: 800, height: 600 }

  constructor(
    private readonly win: BaseWindow,
    readonly ais: AiConfig[],
    private background: string,
    private readonly prefs: ViewPrefs,
  ) {
    super()
    for (const ai of ais) this.create(ai)
  }

  setBackground(color: string): void {
    this.background = color
    for (const e of this.views.values()) e.view.setBackgroundColor(color)
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
    view.setBackgroundColor(this.background)
    // Matches the shell's content card (--card-radius).
    view.setBorderRadius(CARD_RADIUS)
    this.win.contentView.addChildView(view)
    const entry: AiView = { ai, view, loaded: false }
    this.views.set(ai.id, entry)

    const wc = view.webContents
    guardNavigation(wc, ai)
    // Chromium resets the zoom on cross-document navigations: re-apply the AI's own factor.
    wc.on('did-navigate', () => wc.setZoomFactor(this.prefs.zoom(ai.id)))
    const changed = () => this.emit('changed')
    for (const ev of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page'] as const) {
      wc.on(ev as 'did-stop-loading', changed)
    }
    wc.on('render-process-gone', (_e, details) => {
      console.error(`[views] ${ai.id} : processus terminé (${details.reason}), rechargement`)
      if (details.reason !== 'clean-exit') wc.reload()
    })
  }

  /** Loads a view if it is not yet (e.g. an AI that was just shown again). */
  ensureLoaded(id: string): void {
    const entry = this.views.get(id)
    if (entry) this.load(entry)
  }

  setZoom(id: string, factor: number): void {
    this.views.get(id)?.view.webContents.setZoomFactor(factor)
  }

  private load(entry: AiView): void {
    if (entry.loaded || !this.prefs.enabled(entry.ai.id)) return
    entry.loaded = true
    void entry.view.webContents.loadURL(entry.ai.url)
  }

  /** Loads the active view first, then the others shortly after so background notifications work. */
  start(initialId: string | null): void {
    const first = this.select(initialId ?? this.ais.find((a) => this.prefs.enabled(a.id))?.id)
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
    this.activeId = entry.ai.id
    this.applyVisibility()
    entry.view.setBounds(this.rect)
    if (!this.overlaid) entry.view.webContents.focus()
    this.emit('changed')
    return entry
  }

  setOverlay(overlaid: boolean): void {
    this.overlaid = overlaid
    this.applyVisibility()
    if (!overlaid) this.active?.view.webContents.focus()
  }

  get isOverlaid(): boolean {
    return this.overlaid
  }

  private applyVisibility(): void {
    for (const [id, e] of this.views) e.view.setVisible(!this.overlaid && id === this.activeId)
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
