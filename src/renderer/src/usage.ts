import type { AiPublic, AiUsage, UsageSnapshot } from '../../shared/protocol'
import { icons } from './icons'

const api = window.aicc

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function button(cls: string, html: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls)
  b.type = 'button'
  b.innerHTML = html
  b.title = title
  b.setAttribute('aria-label', title)
  b.addEventListener('click', onClick)
  return b
}

/** "il y a 3 min", "à l'instant". */
function fmtAgo(ts: number | null): string {
  if (!ts) return ''
  const d = Date.now() - ts
  if (d < 45_000) return "à l'instant"
  if (d < 3_600_000) return `il y a ${Math.floor(d / 60_000)} min`
  if (d < 86_400_000) return `il y a ${Math.floor(d / 3_600_000)} h`
  return `il y a ${Math.floor(d / 86_400_000)} j`
}

/** "réarme dans 3 h", "réarme mer. 00:59", "réarme le 16 déc." — when a window resets. */
function fmtReset(resetsAt: number | null): string {
  if (!resetsAt) return ''
  const d = resetsAt - Date.now()
  if (d <= 0) return 'réarme à l’instant'
  if (d < 3_600_000) return `réarme dans ${Math.max(1, Math.floor(d / 60_000))} min`
  if (d < 86_400_000) return `réarme dans ${Math.floor(d / 3_600_000)} h`
  const date = new Date(resetsAt)
  if (d < 7 * 86_400_000) {
    const day = date.toLocaleDateString('fr-FR', { weekday: 'short' })
    const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    return `réarme ${day} ${time}`
  }
  return `réarme le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
}

function level(pct: number): 'ok' | 'warn' | 'danger' {
  if (pct >= 90) return 'danger'
  if (pct >= 70) return 'warn'
  return 'ok'
}

/** The quota dashboard: each AI's official usage, read live from its signed-in session. */
export class UsagePanel {
  private open = false
  private snapshot: UsageSnapshot | null = null
  private body: HTMLDivElement | null = null
  private refreshTimer: number | null = null
  private loading = false

  constructor(
    private readonly root: HTMLElement,
    private readonly getAis: () => AiPublic[],
    private readonly onVisibility: (open: boolean) => void,
  ) {
    document.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape' && !(e.target as HTMLElement).closest('input, select')) this.hide()
    })
  }

  get isOpen(): boolean {
    return this.open
  }

  async show(): Promise<void> {
    this.open = true
    this.root.hidden = false
    requestAnimationFrame(() => this.root.classList.add('visible'))
    api.setSettingsVisible(true) // hides the AI views behind the overlay
    this.onVisibility(true)
    this.render() // paint the shell immediately (with a loading state)
    await this.load(false)
    // Refresh the live numbers periodically while the panel stays open.
    this.refreshTimer = window.setInterval(() => void this.load(true), 120_000)
  }

  hide(): void {
    if (!this.open) return
    this.open = false
    this.root.classList.remove('visible')
    this.root.hidden = true
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    api.setSettingsVisible(false)
    this.onVisibility(false)
  }

  toggle(): void {
    if (this.open) this.hide()
    else void this.show()
  }

  private async load(force: boolean): Promise<void> {
    if (this.loading) return
    this.loading = true
    this.render()
    try {
      this.snapshot = await api.getUsage(force)
    } finally {
      this.loading = false
      if (this.open) this.render()
    }
  }

  private render(): void {
    const scroll = this.body?.scrollTop ?? 0
    this.root.replaceChildren()

    const header = el('header', 'settings-header')
    const right = el('div', 'usage-head-actions')
    const refresh = button('icon-btn', icons.reload, 'Actualiser', () => void this.load(true))
    refresh.classList.toggle('spinning', this.loading)
    right.append(refresh, button('icon-btn', icons.close, 'Fermer (Échap)', () => this.hide()))
    header.append(el('h1', undefined, 'Usage'), right)
    this.root.append(header)

    const body = el('div', 'usage-body')
    this.body = body

    const intro = el(
      'p',
      'usage-intro',
      'Les quotas officiels de chaque compte, lus en direct depuis tes sessions connectées — donc identiques sur tous tes appareils. Rien ne quitte ta machine.',
    )
    body.append(intro)

    const list = el('div', 'usage-list')
    const snap = this.snapshot
    for (const ai of this.getAis()) {
      const u = snap?.ais[ai.id]
      list.append(this.card(ai, u, !snap && this.loading))
    }
    body.append(list)

    this.root.append(body)
    body.scrollTop = scroll
  }

  private card(ai: AiPublic, u: AiUsage | undefined, initialLoading: boolean): HTMLElement {
    const card = el('div', 'usage-card')
    card.style.setProperty('--item-accent', ai.accent)

    const head = el('div', 'usage-card-head')
    const iconWrap = el('span', 'usage-ai-icon')
    const img = el('img')
    img.src = ai.icon
    img.alt = ''
    img.draggable = false
    iconWrap.append(img)
    const title = el('div', 'usage-ai')
    title.append(el('span', 'usage-ai-name', ai.name))
    if (u?.plan) title.append(el('span', 'usage-plan', u.plan))
    head.append(iconWrap, title)
    if (u?.status === 'ok' && u.fetchedAt) head.append(el('span', 'usage-stamp', fmtAgo(u.fetchedAt)))
    card.append(head)

    if (!u || initialLoading) {
      card.append(el('p', 'usage-msg', 'Lecture…'))
      return card
    }
    if (u.status === 'ok' && u.windows.length) {
      const bars = el('div', 'usage-bars')
      for (const w of u.windows) {
        const row = el('div', 'usage-win')
        const top = el('div', 'usage-win-top')
        top.append(el('span', 'usage-win-label', w.label), el('span', 'usage-win-pct', `${w.usedPercent} %`))
        const track = el('div', 'usage-track')
        const fill = el('div', `usage-fill ${level(w.usedPercent)}`)
        fill.style.width = `${Math.max(2, w.usedPercent)}%`
        track.append(fill)
        const reset = el('span', 'usage-win-reset', fmtReset(w.resetsAt))
        row.append(top, track, reset)
        bars.append(row)
      }
      card.append(bars)
    } else {
      const msg = el('p', `usage-msg ${u.status}`, u.detail ?? 'Indisponible.')
      card.append(msg)
    }
    return card
  }
}
