import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { app, type WebContents } from 'electron'
import base from '../skins/base.css?raw'
import chatgpt from '../skins/chatgpt.css?raw'
import claude from '../skins/claude.css?raw'
import muse from '../skins/muse.css?raw'
import palette from '../skins/palette.css?raw'
import type { AiConfig } from './config'

/** Built-in skins, keyed by adapter name (same key as the DOM adapters). */
const BUILT_IN: Record<string, string> = { claude, chatgpt, muse }

export function userSkinDir(): string {
  return join(app.getPath('userData'), 'skins')
}

/**
 * Light theming of the AI sites: a CSS layer injected into each page so its surfaces use the app's
 * palette. Text and content stay opaque. The user can add or override rules in
 * <userData>/skins/<id>.css (reloaded live when saved).
 */
export class SkinManager {
  private readonly inserted = new Map<WebContents, string>()
  private readonly attached = new Set<WebContents>()
  private watcher: FSWatcher | null = null

  constructor(
    private readonly enabled: (aiId: string) => boolean,
    private readonly lookup: (contents: WebContents) => AiConfig | undefined,
  ) {
    const dir = userSkinDir()
    try {
      mkdirSync(dir, { recursive: true })
      let timer: NodeJS.Timeout | null = null
      this.watcher = watch(dir, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => this.refreshAll(), 150)
      })
    } catch (error) {
      console.warn('[skins] surveillance du dossier impossible :', error)
    }
  }

  private cssFor(ai: AiConfig): string {
    // The accent comes from ais.json, so every tone follows the AI's own colour.
    const accent = `:root { --aicc-accent: ${ai.accent}; }`
    const parts = [palette, accent, base, BUILT_IN[ai.adapter ?? ai.id] ?? '']
    const user = join(userSkinDir(), `${ai.id}.css`)
    if (existsSync(user)) {
      try {
        parts.push(`/* ${user} */\n${readFileSync(user, 'utf8')}`)
      } catch (error) {
        console.warn(`[skins] lecture impossible : ${user}`, error)
      }
    }
    return parts.join('\n')
  }

  /** Hooks a view: the skin is (re)applied on every new document. */
  attach(contents: WebContents): void {
    this.attached.add(contents)
    contents.on('dom-ready', () => void this.apply(contents))
    contents.once('destroyed', () => {
      this.attached.delete(contents)
      this.inserted.delete(contents)
    })
  }

  async apply(contents: WebContents): Promise<void> {
    const ai = this.lookup(contents)
    if (!ai || contents.isDestroyed()) return
    const previous = this.inserted.get(contents)
    this.inserted.delete(contents)
    if (previous) await contents.removeInsertedCSS(previous).catch(() => undefined)
    if (!this.enabled(ai.id)) return
    try {
      const key = await contents.insertCSS(this.cssFor(ai), { cssOrigin: 'author' })
      this.inserted.set(contents, key)
    } catch (error) {
      console.warn(`[skins] ${ai.id} : injection impossible`, error)
    }
  }

  /** Re-applies every skin, e.g. after a user skin file or a toggle changed. */
  refreshAll(): void {
    for (const contents of this.attached) void this.apply(contents)
  }

  dispose(): void {
    this.watcher?.close()
  }
}
