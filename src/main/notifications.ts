import { EventEmitter } from 'node:events'
import { Notification, nativeImage, type NativeImage } from 'electron'
import type { AdapterEvent } from '../adapters/types'
import type { WebNotificationPayload } from '../shared/protocol'
import type { AiConfig } from './config'
import { resourcePath } from './paths'
import type { AiPrefs } from './store'

type Kind = 'done' | 'needs-input'

interface Candidate {
  kind: Kind
  snippet: string
  key: string
  url?: string
  source: 'adapter' | 'web'
  web?: WebNotificationPayload
}

interface AiTrack {
  /** Candidates collected during the short merge window. */
  pending: Candidate[]
  timer: NodeJS.Timeout | null
  lastAt: number
  lastKey: string
  lastKind: Kind | null
  /** A new generation started since the last notification. */
  armed: boolean
}

export interface HubDeps {
  ais: AiConfig[]
  prefs(aiId: string): AiPrefs
  /** True when the user is looking at this AI (window focused, visible, AI active). */
  isViewing(aiId: string): boolean
  /** Bring the window up on this AI; optionally load the conversation URL. */
  open(aiId: string, url?: string): void
  /** Replay a click on the site's own notification shim. */
  clickWeb(aiId: string, webId: string): void
  playSound(): void
}

/** Site and adapter often fire for the same response: merge what arrives within this window. */
const MERGE_MS = 1500
/** After a notification, ignore further ones for the same AI unless a new generation starts. */
const QUIET_MS = 20_000

const debug = (...args: unknown[]) => {
  if (process.env.AICC_DEBUG) console.info('[notifications]', ...args)
}

const LABEL: Record<Kind, string> = { done: 'Réponse terminée', 'needs-input': 'A besoin de toi' }

/**
 * Single place deciding whether to notify: one native notification per response, only when the
 * user is not looking at that AI, with a badge until the response is seen.
 */
export class NotificationHub extends EventEmitter<{ badges: [Record<string, number>] }> {
  private readonly tracks = new Map<string, AiTrack>()
  private readonly badges: Record<string, number> = {}
  /** Live notifications must stay referenced or their click handlers are garbage-collected. */
  private readonly live = new Set<Notification>()
  private readonly icons = new Map<string, NativeImage>()

  constructor(private readonly deps: HubDeps) {
    super()
    const fallback = nativeImage.createFromPath(resourcePath('icons', 'app.png'))
    for (const ai of deps.ais) {
      this.tracks.set(ai.id, { pending: [], timer: null, lastAt: 0, lastKey: '', lastKind: null, armed: true })
      const img = ai.iconPng ? nativeImage.createFromPath(ai.iconPng) : null
      this.icons.set(ai.id, img && !img.isEmpty() ? img : fallback)
    }
  }

  get badgeCounts(): Record<string, number> {
    return { ...this.badges }
  }

  /** From the DOM adapter. */
  adapter(aiId: string, event: AdapterEvent): void {
    const track = this.tracks.get(aiId)
    if (!track) return
    debug(aiId, 'adapter', event.kind, event.key, JSON.stringify(event.snippet.slice(0, 60)))
    if (event.kind === 'generating') {
      track.armed = true
      return
    }
    this.collect(aiId, { kind: event.kind, snippet: event.snippet, key: event.key, url: event.url, source: 'adapter' })
  }

  /** From the site's own Notification API, relayed by the preload. */
  web(aiId: string, payload: WebNotificationPayload): void {
    debug(aiId, 'web notification', JSON.stringify(payload.title), payload.tag)
    const looksLikeAsk = /approv|confirm|permission|waiting|attend|besoin|input|question|action/i.test(
      `${payload.title} ${payload.body}`,
    )
    this.collect(aiId, {
      kind: looksLikeAsk ? 'needs-input' : 'done',
      snippet: payload.body || payload.title,
      key: payload.tag ? `web:${payload.tag}` : `web:${payload.id}`,
      source: 'web',
      web: payload,
    })
  }

  private collect(aiId: string, candidate: Candidate): void {
    const track = this.tracks.get(aiId)!
    track.pending.push(candidate)
    if (!track.timer) track.timer = setTimeout(() => this.flush(aiId), MERGE_MS)
  }

  private flush(aiId: string): void {
    const track = this.tracks.get(aiId)!
    const batch = track.pending
    track.pending = []
    track.timer = null
    if (!batch.length) return

    // needs-input beats done; for the same kind, the adapter (has the URL and a clean snippet)
    // beats the web one, but a web notification's click target is kept.
    const rank = (c: Candidate) => (c.kind === 'needs-input' ? 2 : 0) + (c.source === 'adapter' ? 1 : 0)
    const best = [...batch].sort((a, b) => rank(b) - rank(a))[0]
    const web = batch.find((c) => c.web)?.web

    const now = Date.now()
    const sameResponse = best.key === track.lastKey
    const quiet = now - track.lastAt < QUIET_MS && !track.armed
    // A request for input after a plain "done" (e.g. an approval later in the turn) is still worth telling.
    const upgrade = best.kind === 'needs-input' && track.lastKind === 'done'
    if ((sameResponse || quiet) && !upgrade) {
      debug(aiId, 'skip (duplicate)', { sameResponse, quiet })
      return
    }

    track.lastAt = now
    track.lastKey = best.key
    track.lastKind = best.kind
    track.armed = false

    if (this.deps.isViewing(aiId)) {
      debug(aiId, 'skip (being viewed)')
      return
    }
    const prefs = this.deps.prefs(aiId)
    if (!prefs.notifications) {
      debug(aiId, 'skip (disabled for this AI)')
      return
    }
    debug(aiId, 'notify', best.kind, best.source, web ? '(+web click)' : '')

    this.badges[aiId] = (this.badges[aiId] ?? 0) + 1
    this.emit('badges', this.badgeCounts)
    this.show(aiId, best, web)
    if (prefs.sound) this.deps.playSound()
  }

  private show(aiId: string, c: Candidate, web?: WebNotificationPayload): void {
    if (!Notification.isSupported()) return
    const ai = this.deps.ais.find((a) => a.id === aiId)!
    const body = c.snippet ? `${LABEL[c.kind]} — ${c.snippet}` : LABEL[c.kind]
    const n = new Notification({
      title: ai.name,
      subtitle: LABEL[c.kind], // macOS
      body,
      icon: this.icons.get(aiId),
      silent: true, // our own chime, when enabled, is played by the shell
      urgency: c.kind === 'needs-input' ? 'critical' : 'normal', // Linux
      timeoutType: c.kind === 'needs-input' ? 'never' : 'default',
    })
    this.live.add(n)
    const forget = () => this.live.delete(n)
    n.on('close', forget)
    n.on('failed', forget)
    n.on('click', () => {
      forget()
      this.deps.open(aiId, web ? undefined : c.url)
      if (web) this.deps.clickWeb(aiId, web.id)
    })
    n.show()
  }

  /** Settings "Test" button: shows a sample notification regardless of focus. */
  test(aiId: string): void {
    this.show(aiId, { kind: 'done', snippet: 'Ceci est une notification de test.', key: 'test', source: 'adapter' })
    if (this.deps.prefs(aiId).sound) this.deps.playSound()
  }

  /** The user looked at this AI: its badge goes away. */
  seen(aiId: string): void {
    if (!this.badges[aiId]) return
    delete this.badges[aiId]
    this.emit('badges', this.badgeCounts)
  }
}
