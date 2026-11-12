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
