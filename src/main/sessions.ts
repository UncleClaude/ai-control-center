import { session, type Session } from 'electron'
import { isGoogleAuthHost, type SiteRole } from '../shared/protocol'
import type { AiConfig } from './config'
import { isInAppUrl } from './navigation'

export const chromeMajor = process.versions.chrome.split('.')[0]

/**
 * A plain desktop Chrome user agent (no "Electron/x" or app token). Google sign-in and some
 * anti-bot checks refuse embedded browsers that advertise themselves.
 */
export function chromeUserAgent(): string {
  const os =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
}

/** Firefox ships every 4 weeks; Firefox 160 was current in early November 2026. */
function firefoxMajor(): number {
  const anchor = Date.UTC(2026, 10, 3)
  return 160 + Math.max(0, Math.floor((Date.now() - anchor) / (28 * 86_400_000)))
}

export function firefoxIdentity(): SiteRole['firefox'] {
  const v = `${firefoxMajor()}.0`
  if (process.platform === 'darwin')
    return {
      userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${v}) Gecko/20100101 Firefox/${v}`,
      appVersion: '5.0 (Macintosh)',
      platform: 'MacIntel',
      oscpu: 'Intel Mac OS X 10.15',
    }
  if (process.platform === 'win32')
    return {
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${v}) Gecko/20100101 Firefox/${v}`,
      appVersion: '5.0 (Windows)',
      platform: 'Win32',
      oscpu: 'Windows NT 10.0; Win64; x64',
    }
  return {
    userAgent: `Mozilla/5.0 (X11; Linux x86_64; rv:${v}) Gecko/20100101 Firefox/${v}`,
    appVersion: '5.0 (X11)',
    platform: 'Linux x86_64',
    oscpu: 'Linux x86_64',
  }
}

function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const brandsHeader = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not?A_Brand";v="99"`

/** Permissions the AI sites need: voice mode, notifications, clipboard, fullscreen video. */
const GRANTED = new Set([
  'notifications',
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection',
])

const prepared = new Set<string>()

export function partitionFor(ai: AiConfig): string {
  return `persist:ai-${ai.id}`
}

/** Persistent, isolated session per AI: cookies and storage survive restarts. */
export function prepareSession(ai: AiConfig): Session {
  const ses = session.fromPartition(partitionFor(ai))
  if (prepared.has(ai.id)) return ses
  prepared.add(ai.id)

  ses.setUserAgent(ai.userAgent ?? chromeUserAgent())

  const firefoxUA = firefoxIdentity().userAgent
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    // A top-level navigation is judged by its own URL (so the OAuth callback back to the AI gets
    // Chrome again); everything else by the document that issued it.
    const contextUrl = details.resourceType === 'mainFrame' ? details.url : (details.webContents?.getURL() ?? details.url)
    const asFirefox = isGoogleAuthHost(hostOf(contextUrl))
    for (const key of Object.keys(headers)) {
      const k = key.toLowerCase()
      if (asFirefox && (k.startsWith('sec-ch-ua') || k === 'user-agent')) delete headers[key]
      // Client hints must agree with the Chrome user agent.
      else if (k === 'sec-ch-ua') headers[key] = brandsHeader
    }
    if (asFirefox) headers['User-Agent'] = firefoxUA
    callback({ requestHeaders: headers })
  })

  const allowed = (permission: string, url: string | undefined) =>
    GRANTED.has(permission) && !!url && isInAppUrl(ai, url)

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = allowed(permission, details.requestingUrl)
    if (!ok) console.info(`[permissions] ${ai.id} : refus de « ${permission} » pour ${details.requestingUrl}`)
    callback(ok)
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed(permission, origin))
  return ses
}
