// Types and channel names shared by main, preloads and the shell renderer.

export type Platform = 'darwin' | 'linux' | 'win32'
export type NavAction = 'back' | 'forward' | 'reload'
export type WindowAction = 'minimize' | 'maximize' | 'close'

export interface AiPublic {
  id: string
  name: string
  /** data: URL, safe for the shell CSP. */
  icon: string
}

export interface ShellState {
  platform: Platform
  ais: AiPublic[]
  activeId: string | null
  loading: Record<string, boolean>
  badges: Record<string, number>
  canGoBack: boolean
  canGoForward: boolean
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
} as const

export interface ShellApi {
  getState(): Promise<ShellState>
  onState(listener: (state: ShellState) => void): () => void
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
}
