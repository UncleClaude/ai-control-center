import { EventEmitter } from 'node:events'

// Electron's globalShortcut does not work on KDE/GNOME Wayland. The XDG GlobalShortcuts portal does,
// and uniquely gives both press (Activated) and release (Deactivated) — needed for push-to-talk.
// We talk to it over D-Bus (dbus-next, pure JS). Keys are confirmed by the user in the compositor's
// own dialog on first bind, and remembered by shortcut id afterwards.

type DbusModule = typeof import('dbus-next')
let dbus: DbusModule | null = null
try {
  dbus = require('dbus-next') as DbusModule
} catch {
  dbus = null
}

const PORTAL = 'org.freedesktop.portal.Desktop'
const PORTAL_PATH = '/org/freedesktop/portal/desktop'
const IFACE = 'org.freedesktop.portal.GlobalShortcuts'

export interface PortalShortcut {
  id: string
  description: string
  /** Suggested trigger (e.g. "CTRL+SHIFT+a"); the user can change it in the compositor dialog. */
  preferredTrigger?: string
}

const rand = () => `aicc${Math.floor(Math.random() * 1e9)}`

/** Linux-only global shortcuts via the XDG portal; emits 'activated'(id) and 'deactivated'(id). */
export class PortalShortcuts extends EventEmitter {
  // dbus-next's published types are incomplete (ProxyObject, bus.name…), so these stay loosely typed.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  private bus: any = null
  private gs: any = null
  private session: string | null = null

  static available(): boolean {
    return (
      process.platform === 'linux' &&
      (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) &&
      !!dbus
    )
  }

  /** (Re)binds the given set; returns true once a session is created and BindShortcuts is sent. */
  async bind(shortcuts: PortalShortcut[]): Promise<boolean> {
    await this.reset()
    if (!dbus || !shortcuts.length) return false
    const { Variant } = dbus
    try {
      this.bus = dbus.sessionBus()
      const obj = await this.bus.getProxyObject(PORTAL, PORTAL_PATH)
      this.gs = obj.getInterface(IFACE)
      this.gs.on('Activated', (_s: string, id: string) => this.emit('activated', id))
      this.gs.on('Deactivated', (_s: string, id: string) => this.emit('deactivated', id))

      // CreateSession — we need its reply to learn the session handle.
      const created = await this.awaitRequest((options) =>
        this.gs!.CreateSession({ ...options, session_handle_token: new Variant('s', rand()) }),
      )
      if (!created || created.response !== 0) return false
      this.session = (created.results.session_handle as { value: string }).value

      // BindShortcuts — fire it; the compositor shows its assignment dialog and, once confirmed, the
      // Activated/Deactivated signals start flowing. We don't block on its reply.
      const list = shortcuts.map((s) => [
        s.id,
        {
          description: new Variant('s', s.description),
          ...(s.preferredTrigger ? { preferred_trigger: new Variant('s', s.preferredTrigger) } : {}),
        },
      ])
      await this.gs.BindShortcuts(this.session, list, '', { handle_token: new Variant('s', rand()) })
      return true
    } catch (error) {
      console.warn('[portal] bind failed:', error)
      await this.reset()
      return false
    }
  }

  /** Calls a portal method and resolves with its Response (response code + results). */
  private awaitRequest(
    call: (options: Record<string, unknown>) => Promise<string>,
  ): Promise<{ response: number; results: Record<string, unknown> } | null> {
    if (!this.bus || !dbus) return Promise.resolve(null)
    const { Variant } = dbus
    const token = rand()
    const sender = String(this.bus.name ?? '').replace(/^:/, '').replace(/\./g, '_')
    const reqPath = `${PORTAL_PATH}/request/${sender}/${token}`
    return new Promise((resolve) => {
      let settled = false
      const finish = (v: { response: number; results: Record<string, unknown> } | null) => {
        if (settled) return
        settled = true
        resolve(v)
      }
      const subscribe = async (path: string) => {
        try {
          const reqObj = await this.bus!.getProxyObject(PORTAL, path)
          reqObj
            .getInterface('org.freedesktop.portal.Request')
            .once('Response', (response: number, results: Record<string, unknown>) => finish({ response, results }))
        } catch {
          /* object not exported yet */
        }
      }
      void subscribe(reqPath)
      call({ handle_token: new Variant('s', token) })
        .then((retPath) => {
          if (!settled && retPath) void subscribe(retPath)
        })
        .catch(() => finish(null))
      setTimeout(() => finish(null), 15_000)
    })
  }

  async reset(): Promise<void> {
    try {
      this.gs?.removeAllListeners?.('Activated')
      this.gs?.removeAllListeners?.('Deactivated')
    } catch {
      /* ignore */
    }
    try {
      this.bus?.disconnect?.()
    } catch {
      /* ignore */
    }
    this.bus = null
    this.gs = null
    this.session = null
  }
}
