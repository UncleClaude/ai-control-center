// Runs (sandboxed, isolated world) in every AI view and its sign-in popups.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, isGoogleAuthHost, type SiteRole } from '../shared/protocol'

const role = ipcRenderer.sendSync(IPC.siteRole) as SiteRole

if (isGoogleAuthHost(location.hostname)) {
  /** Google sign-in pages: look like Firefox, matching the headers rewritten in main. */
  contextBridge.executeInMainWorld({
    func: (ff: SiteRole['firefox']) => {
      const define = (target: object, key: string, value: unknown) => {
        try {
          Object.defineProperty(target, key, { get: () => value, configurable: true, enumerable: true })
        } catch {
          /* non-configurable on this build: leave it */
        }
      }
      const proto = Navigator.prototype
      define(proto, 'userAgent', ff.userAgent)
      define(proto, 'appVersion', ff.appVersion)
      define(proto, 'platform', ff.platform)
      define(proto, 'vendor', '')
      define(proto, 'productSub', '20100101')
      define(proto, 'oscpu', ff.oscpu)
      define(proto, 'buildID', '20181001000000')
      define(proto, 'userAgentData', undefined)
      try {
        delete (window as { chrome?: unknown }).chrome
      } catch {
        /* ignore */
      }
    },
    args: [role.firefox],
  })
} else {
  /**
   * Elsewhere: navigator.userAgentData must agree with the Chrome user agent and the sec-ch-ua
   * header, otherwise sites can tell this is not a regular browser. Runs before page scripts.
   */
  contextBridge.executeInMainWorld({
    func: (major: string) => {
      const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }
      const uad = nav.userAgentData
      if (!uad) return
      const proto = Object.getPrototypeOf(uad)
      const brands = [
        { brand: 'Chromium', version: major },
        { brand: 'Google Chrome', version: major },
        { brand: 'Not?A_Brand', version: '99' },
      ]
      const desc = Object.getOwnPropertyDescriptor(proto, 'brands')
      if (desc?.get) Object.defineProperty(proto, 'brands', { ...desc, get: () => brands.map((b) => ({ ...b })) })
      const original = proto.getHighEntropyValues
      if (typeof original === 'function') {
        proto.getHighEntropyValues = function (hints: string[]) {
          return original.call(this, hints).then((values: Record<string, unknown>) => {
            const full = values.fullVersionList as { brand: string; version: string }[] | undefined
            if (full) {
              const v = full.find((b) => b.brand === 'Chromium')?.version ?? `${major}.0.0.0`
              values.fullVersionList = [
                { brand: 'Chromium', version: v },
                { brand: 'Google Chrome', version: v },
                { brand: 'Not?A_Brand', version: '99.0.0.0' },
              ]
            }
            if (values.brands) values.brands = brands.map((b) => ({ ...b }))
            return values
          })
        }
      }
    },
    args: [role.chromeMajor],
  })
}
