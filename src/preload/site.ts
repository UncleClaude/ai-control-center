// Runs (sandboxed, isolated world) in every AI view and its sign-in popups.
import { contextBridge, ipcRenderer } from 'electron'
import { adapterFor } from '../adapters'
import { runAdapter } from '../adapters/runtime'
import { IPC, isGoogleAuthHost, type SiteRole, type WebNotificationPayload } from '../shared/protocol'

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

// ---------- AI views only (not sign-in popups) ----------

if (role.aiId && window.top === window) {
  /**
   * 1. Relay the site's own notifications. The page's Notification (and service-worker
   * showNotification) is replaced, in the page world, by a shim that hands the notification to us
   * through a DOM event; main shows it natively and de-duplicates it with the adapter. A click on
   * the native notification is replayed on the shim, so the site's onclick (open the right
   * conversation) runs as usual.
   */
  contextBridge.executeInMainWorld({
    func: () => {
      type Opts = { body?: string; tag?: string; icon?: string; data?: unknown }
      const live = new Map<string, EventTarget & { onclick: ((e: Event) => void) | null }>()
      let seq = 0
      const send = (title: string, opts: Opts | undefined) => {
        const id = `n${Date.now().toString(36)}${(seq++).toString(36)}`
        const detail = JSON.stringify({ id, title: String(title ?? ''), body: String(opts?.body ?? ''), tag: String(opts?.tag ?? '') })
        document.dispatchEvent(new CustomEvent('aicc:web-notification', { detail }))
        return id
      }
      class RelayedNotification extends EventTarget {
        static get permission(): NotificationPermission {
          return 'granted'
        }
        static requestPermission(cb?: (p: NotificationPermission) => void): Promise<NotificationPermission> {
          cb?.('granted')
          return Promise.resolve('granted')
        }
        static get maxActions(): number {
          return 0
        }
        onclick: ((e: Event) => void) | null = null
        onshow: ((e: Event) => void) | null = null
        onclose: ((e: Event) => void) | null = null
        onerror: ((e: Event) => void) | null = null
        readonly title: string
        readonly body: string
        readonly tag: string
        readonly data: unknown
        readonly icon: string
        constructor(title: string, opts?: Opts) {
          super()
          this.title = String(title ?? '')
          this.body = String(opts?.body ?? '')
          this.tag = String(opts?.tag ?? '')
          this.data = opts?.data ?? null
          this.icon = String(opts?.icon ?? '')
          const id = send(title, opts)
          live.set(id, this)
          setTimeout(() => {
            const e = new Event('show')
            this.onshow?.(e)
            this.dispatchEvent(e)
          }, 0)
        }
        close(): void {
          const e = new Event('close')
          this.onclose?.(e)
          this.dispatchEvent(e)
        }
      }
      document.addEventListener('aicc:web-notification-click', (ev) => {
        const id = String((ev as CustomEvent).detail ?? '')
        const n = live.get(id)
        if (!n) return
        const e = new Event('click', { cancelable: true })
        n.onclick?.(e)
        n.dispatchEvent(e)
      })
      Object.defineProperty(window, 'Notification', { value: RelayedNotification, writable: true, configurable: true })
      const swProto = (window as { ServiceWorkerRegistration?: { prototype: { showNotification?: unknown } } })
        .ServiceWorkerRegistration?.prototype
      if (swProto) {
        swProto.showNotification = function (title: string, opts?: Opts) {
          send(title, opts)
          return Promise.resolve()
        }
      }
    },
    args: [],
  })

  document.addEventListener('aicc:web-notification', (ev) => {
    try {
      const n = JSON.parse(String((ev as CustomEvent).detail)) as WebNotificationPayload
      ipcRenderer.send(IPC.webNotification, {
        id: n.id.slice(0, 40),
        title: n.title.slice(0, 200),
        body: n.body.slice(0, 500),
        tag: n.tag.slice(0, 120),
      } satisfies WebNotificationPayload)
    } catch {
      /* malformed: ignore */
    }
  })
  ipcRenderer.on(IPC.webNotificationClick, (_e, id: string) => {
    document.dispatchEvent(new CustomEvent('aicc:web-notification-click', { detail: String(id) }))
  })

  // 2. DOM adapter: end of generation / waiting for the user.
  const spec = adapterFor(role.adapter)
  runAdapter(
    spec,
    (event) => ipcRenderer.send(IPC.siteEvent, event),
    (level, message) => {
      ;(level === 'warn' ? console.warn : console.info)(`[adapter:${spec.name}] ${message}`)
      ipcRenderer.send(IPC.siteLog, level, message)
    },
  )
}
