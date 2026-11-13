import type { UpdateInfoPublic } from '../../shared/protocol'
import { icons } from './icons'

const api = window.aicc

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/**
 * Startup prompt when a newer release exists: it asks whether to update. On Linux it downloads and
 * installs the new AppImage and restarts; on macOS it downloads the dmg and opens it to drag in.
 */
export class UpdatePrompt {
  private open = false

  constructor(
    private readonly root: HTMLElement,
    private readonly currentVersion: () => string,
    private readonly setViewsHidden: (hidden: boolean) => void,
  ) {
    api.onUpdateAvailable((u) => this.show(u))
  }

  private hide(): void {
    if (!this.open) return
    this.open = false
    this.root.classList.remove('visible')
    this.root.hidden = true
    this.setViewsHidden(false)
  }

  show(update: UpdateInfoPublic): void {
    this.render(update)
    this.open = true
    this.root.hidden = false
    this.setViewsHidden(true)
    requestAnimationFrame(() => this.root.classList.add('visible'))
  }

  private render(update: UpdateInfoPublic): void {
    this.root.replaceChildren()
    const card = el('div', 'login-card')

    const head = el('div', 'login-head')
    const badge = el('div', 'login-badge done')
    badge.innerHTML = icons.download
    head.append(badge)
    card.append(head)

    card.append(
      el('h2', 'login-title', 'Mise à jour disponible'),
      el('p', 'login-body', `Version ${update.version} (actuelle : ${this.currentVersion()}). Voulez-vous l’installer ?`),
    )

    const notes = (update.notes || '').trim()
    if (notes) {
      const pre = el('p', 'login-detail')
      pre.textContent = notes.length > 240 ? notes.slice(0, 240) + '…' : notes
      card.append(pre)
    }

    const progress = el('div', 'update-progress')
    const bar = el('div', 'update-progress-bar')
    progress.append(bar)
    progress.hidden = true
    card.append(progress)

    const status = el('p', 'login-detail')
    status.hidden = true

    const actions = el('div', 'login-actions')
    const update_ = el('button', 'login-btn primary')
    update_.type = 'button'
    update_.textContent = update.selfInstall ? 'Mettre à jour et redémarrer' : 'Télécharger'
    const later = el('button', 'login-btn')
    later.type = 'button'
    later.textContent = 'Plus tard'
    later.addEventListener('click', () => this.hide())

    update_.addEventListener('click', async () => {
      update_.disabled = true
      later.disabled = true
      update_.textContent = 'Téléchargement…'
      progress.hidden = false
      const off = api.onUpdateProgress((f) => (bar.style.width = `${Math.round(f * 100)}%`))
      try {
        const res = await api.applyUpdate()
        if (res.error) {
          status.hidden = false
          status.textContent = `Échec : ${res.error}`
          update_.disabled = false
          later.disabled = false
          update_.textContent = 'Réessayer'
          progress.hidden = true
        } else if (res.result === 'quit') {
          status.hidden = false
          status.textContent = 'Installation… l’app va se fermer et rouvrir automatiquement.'
        } else if (res.result === 'opened') {
          status.hidden = false
          status.textContent = 'Le dmg s’ouvre : glissez l’app dans Applications, puis rouvrez-la.'
          update_.style.display = 'none'
          later.textContent = 'Fermer'
          later.disabled = false
        } else if (res.result === 'page') {
          status.hidden = false
          status.textContent = 'La page de téléchargement s’est ouverte dans votre navigateur.'
          update_.style.display = 'none'
          later.textContent = 'Fermer'
          later.disabled = false
        }
        // 'relaunch': the app restarts, nothing more to do here.
      } finally {
        off()
      }
    })

    actions.append(update_, later)
    card.append(status, actions)
    this.root.replaceChildren(card)
  }
}
