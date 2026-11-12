import { shell, type WebContents } from 'electron'
import type { AiConfig } from './config'
import { preloadPath } from './paths'

/**
 * Sign-in and anti-bot hosts every AI may reach, in addition to its own allowedDomains.
 * Keeping them in-app (same session) is what makes "Continue with Google/Apple" work.
 */
export const AUTH_DOMAINS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'appleid.apple.com',
  'idmsa.apple.com',
  'login.microsoftonline.com',
  'login.live.com',
  'account.live.com',
  'auth.openai.com',
  'auth0.openai.com',
  'challenges.cloudflare.com',
  'www.facebook.com',
  'm.facebook.com',
  'accounts.meta.com',
  'auth.meta.com',
]

export function hostMatches(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase()
  return domains.some((d) => h === d || h.endsWith(`.${d}`))
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export function isAiUrl(ai: AiConfig, url: string): boolean {
  const u = parse(url)
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:') && hostMatches(u.hostname, ai.allowedDomains)
}

export function isAuthUrl(url: string): boolean {
  const u = parse(url)
  return !!u && u.protocol === 'https:' && hostMatches(u.hostname, AUTH_DOMAINS)
}

export function isInAppUrl(ai: AiConfig, url: string): boolean {
  return isAiUrl(ai, url) || isAuthUrl(url)
}

export function openExternal(url: string): void {
  const u = parse(url)
  if (u && ['http:', 'https:', 'mailto:'].includes(u.protocol)) {
    void shell.openExternal(u.toString())
  } else {
    console.warn('[navigation] lien externe ignoré (protocole non autorisé) :', url)
  }
}

/**
 * Keeps a view (or one of its popups) on its AI + sign-in hosts.
 * - Main-frame navigations elsewhere open in the default browser.
 * - Server redirects are never blocked: OAuth chains bounce through hosts we cannot list.
 * - window.open to a sign-in host, or a sized popup on the AI's own domain, stays an in-app popup
 *   (same session, keeps window.opener so the OAuth callback can reach the page).
 * - target=_blank links on the AI's own domain load in place; anything else goes to the browser.
 */
export function guardNavigation(contents: WebContents, ai: AiConfig, isPopup = false): void {
  contents.on('will-navigate', (event) => {
    if (!event.isMainFrame || isInAppUrl(ai, event.url)) return
    event.preventDefault()
    openExternal(event.url)
    if (isPopup && contents.getURL() === 'about:blank') contents.close()
  })

  contents.setWindowOpenHandler(({ url, disposition, features }) => {
    const blank = url === '' || url === 'about:blank'
    const popupWanted = disposition === 'new-window' || features.length > 0
    if (blank || isAuthUrl(url) || (isAiUrl(ai, url) && popupWanted)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            preload: preloadPath('site'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      }
    }
    if (isAiUrl(ai, url)) {
      if (!isPopup) void contents.loadURL(url)
      else return { action: 'allow' }
      return { action: 'deny' }
    }
    openExternal(url)
    return { action: 'deny' }
  })

  contents.on('did-create-window', (win) => {
    guardNavigation(win.webContents, ai, true)
  })
}
