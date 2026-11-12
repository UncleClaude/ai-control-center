// Types and channel names shared by main, preloads and the shell renderer.

export type Platform = 'darwin' | 'linux' | 'win32'
export type NavAction = 'back' | 'forward' | 'reload'
export type WindowAction = 'minimize' | 'maximize' | 'close'
export type GlassMode = 'vibrancy' | 'blur' | 'tint' | 'solid'
export type GlassPreference = 'auto' | 'glass' | 'solid'

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
} as const

export interface WebNotificationPayload {
  id: string
  title: string
  body: string
  tag: string
}

export interface ShellApi {
  getState(): Promise<ShellState>
  onState(listener: (state: ShellState) => void): () => void
  onPlaySound(listener: () => void): () => void
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
