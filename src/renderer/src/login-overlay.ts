import type { AiPublic, LoginStatus } from '../../shared/protocol'
import { icons } from './icons'

const api = window.aicc

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/**
 * Shown over the content card while a provider that blocks embedded sign-in (Google, Apple) is
 * handled in the real browser. The app watches the browser and imports the session automatically;
 * this overlay only reports progress and offers finish / reopen / cancel.
 */
export class LoginOverlay {
  private aiId: string | null = null
  private doneTimer: number | undefined

  constructor(
    private readonly root: HTMLElement,
    private readonly getAi: (id: string) => AiPublic | undefined,
    private readonly onShownChange: (shown: boolean) => void,
  ) {
    api.onLoginStatus((s) => this.update(s))
  }

  get isOpen(): boolean {
    return this.aiId !== null
  }

  /** The AI whose sign-in is in progress, if any (so the shell can hide it on AI switch). */
  get activeAi(): string | null {
    return this.aiId
  }

  private hide(): void {
    if (!this.aiId) return
    this.aiId = null
    this.root.classList.remove('visible')
    this.root.hidden = true
    window.clearTimeout(this.doneTimer)
    this.onShownChange(false)
  }

  private update(s: LoginStatus): void {
    if (s.state === 'cancelled') {
      if (s.aiId === this.aiId) this.hide()
      return
    }
    if (s.state === 'done') {
      // Ignore a stray completion for an AI we are not showing.
      if (this.aiId !== null && s.aiId !== this.aiId) return
      this.aiId = s.aiId
      this.render(s)
      this.root.hidden = false
      requestAnimationFrame(() => this.root.classList.add('visible'))
      this.onShownChange(true)
      // The view reloads signed-in; close the overlay shortly after the confirmation.
      window.clearTimeout(this.doneTimer)
      this.doneTimer = window.setTimeout(() => this.hide(), 1400)
      return
    }
    // watching / searching / none-found / timeout
    const first = this.aiId !== s.aiId
    this.aiId = s.aiId
    this.render(s)
    if (first) {
      this.root.hidden = false
      requestAnimationFrame(() => this.root.classList.add('visible'))
      this.onShownChange(true)
    }
  }

  private render(s: LoginStatus): void {
    const ai = this.getAi(s.aiId)
    this.root.replaceChildren()
    if (ai) this.root.style.setProperty('--accent', ai.accent)

    const card = el('div', 'login-card')

    const head = el('div', 'login-head')
    if (ai) {
      const img = el('img', 'login-ai-icon')
      img.src = ai.icon
      img.alt = ''
      head.append(img)
    }
    const working = s.state === 'watching' || s.state === 'searching' || s.state === 'none-found'
    const spinner = el('div', s.state === 'done' ? 'login-badge done' : 'login-badge')
    spinner.innerHTML = s.state === 'done' ? icons.check : s.state === 'timeout' ? icons.globe : ''
    if (working) spinner.classList.add('spin')
    head.append(spinner)
    card.append(head)

    const name = ai?.name ?? 'l’IA'
    const TITLE: Record<LoginStatus['state'], string> = {
      watching: 'Connexion dans votre navigateur',
      searching: 'Recherche de votre session…',
      'none-found': 'Pas encore connecté',
      timeout: 'Temps écoulé',
      done: 'Connecté',
      cancelled: '',
    }
    const BODY: Record<LoginStatus['state'], string> = {
      watching: `La page de connexion de ${name} s’est ouverte dans votre navigateur. Connectez-vous (Google, Apple…) : dès que c’est fait, ${name} se connecte ici automatiquement.`,
      searching: 'Lecture de votre session dans le navigateur…',
      'none-found': `Aucune session trouvée pour ${name}. Terminez la connexion dans le navigateur, puis cliquez « J’ai terminé ».`,
      timeout: `Si vous vous êtes connecté, cliquez « J’ai terminé ». Sinon, rouvrez la page de connexion.`,
      done: `${name} est connecté${s.browser ? ` (via ${s.browser})` : ''}. La page se recharge.`,
      cancelled: '',
    }
    card.append(el('h2', 'login-title', TITLE[s.state]), el('p', 'login-body', BODY[s.state]))

    // macOS without Full Disk Access: the app cannot read the browser's cookies at all.
    if (s.needsFda && s.state !== 'done') {
      const fda = el('div', 'login-fda')
      fda.append(
        el('p', 'login-fda-text', 'Sur macOS, autorisez d’abord l’Accès complet au disque pour « AI Control Center », sinon l’app ne peut pas lire votre session. Activez-le, relancez l’app si macOS le demande, puis revenez ici.'),
      )
      const openBtn = el('button', 'login-btn primary')
      openBtn.type = 'button'
      openBtn.textContent = 'Ouvrir les réglages d’accès au disque'
      openBtn.addEventListener('click', () => api.loginAction(s.aiId, 'fda'))
      fda.append(openBtn)
      card.append(fda)
    }

    if (s.detail) card.append(el('p', 'login-detail', s.detail))

    if (s.state !== 'done') {
      const actions = el('div', 'login-actions')
      const btn = (label: string, primary: boolean, action: 'finish' | 'reopen' | 'cancel') => {
        const b = el('button', primary ? 'login-btn primary' : 'login-btn')
        b.type = 'button'
        b.textContent = label
        b.addEventListener('click', () => api.loginAction(s.aiId, action))
        return b
      }
      actions.append(
        btn('J’ai terminé', true, 'finish'),
        btn('Rouvrir le navigateur', false, 'reopen'),
        btn('Annuler', false, 'cancel'),
      )
      card.append(actions)
      if (s.state === 'searching') actions.querySelectorAll('button').forEach((b) => (b.disabled = true))
    }

    this.root.replaceChildren(card)
  }
}
