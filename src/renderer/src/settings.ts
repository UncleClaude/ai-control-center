import type { AiPublic, GlassPreference, Settings, SettingsPatch } from '../../shared/protocol'
import { icons } from './icons'

const api = window.aicc

const GLASS_LABEL: Record<string, string> = {
  vibrancy: 'vibrancy macOS',
  blur: 'flou du compositeur',
  tint: 'repli teinté (pas de flou)',
  solid: 'opaque',
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const row = el('label', 'switch')
  const input = el('input')
  input.type = 'checkbox'
  input.checked = checked
  input.setAttribute('role', 'switch')
  input.addEventListener('change', () => onChange(input.checked))
  const track = el('span', 'switch-track')
  track.append(el('span', 'switch-thumb'))
  row.append(input, track, el('span', 'switch-label', label))
  return row
}

/** Settings panel, shown over the content area (main hides the site views meanwhile). */
export class SettingsPanel {
  private open = false
  private settings: Settings | null = null

  constructor(
    private readonly root: HTMLElement,
    private readonly getAis: () => AiPublic[],
    private readonly onVisibility: (open: boolean) => void,
  ) {
    document.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') this.hide()
    })
  }

  get isOpen(): boolean {
    return this.open
  }

  async show(): Promise<void> {
    this.settings = await api.getSettings()
    this.render()
    this.open = true
    this.root.hidden = false
    requestAnimationFrame(() => this.root.classList.add('visible'))
    api.setSettingsVisible(true)
    this.onVisibility(true)
    this.root.querySelector<HTMLElement>('button, input')?.focus()
  }

  hide(): void {
    if (!this.open) return
    this.open = false
    this.root.classList.remove('visible')
    this.root.hidden = true
    api.setSettingsVisible(false)
    this.onVisibility(false)
  }

  toggle(): void {
    if (this.open) this.hide()
    else void this.show()
  }

  private async patch(p: SettingsPatch): Promise<void> {
    this.settings = await api.setSettings(p)
  }

  private render(): void {
    const s = this.settings
    if (!s) return
    this.root.replaceChildren()

    const header = el('header', 'settings-header')
    header.append(el('h1', undefined, 'Réglages'))
    const close = el('button', 'icon-btn')
    close.type = 'button'
    close.innerHTML = icons.close
    close.setAttribute('aria-label', 'Fermer les réglages')
    close.title = 'Fermer (Échap)'
    close.addEventListener('click', () => this.hide())
    header.append(close)

    const body = el('div', 'settings-body')

    // Per AI
    const aiSection = el('section', 'settings-section')
    aiSection.append(el('h2', undefined, 'Intelligences artificielles'))
    for (const ai of this.getAis()) {
      const prefs = s.ai[ai.id] ?? { notifications: true, sound: false, skin: true }
      const card = el('div', 'ai-card')
      card.style.setProperty('--card-accent', ai.accent)
      const head = el('div', 'ai-card-head')
      const img = el('img')
      img.src = ai.icon
      img.alt = ''
      head.append(img, el('span', 'ai-card-name', ai.name))
      const test = el('button', 'pill-btn')
      test.type = 'button'
      test.innerHTML = `${icons.bell}<span>Tester</span>`
      test.title = 'Afficher une notification de test'
      test.addEventListener('click', () => api.testNotification(ai.id))
      head.append(test)
      const opts = el('div', 'ai-card-options')
      opts.append(
        toggle('Notifications', prefs.notifications, (v) => void this.patch({ ai: { [ai.id]: { notifications: v } } })),
        toggle('Son', prefs.sound, (v) => void this.patch({ ai: { [ai.id]: { sound: v } } })),
        toggle('Habillage aux couleurs de l’app', prefs.skin, (v) => void this.patch({ ai: { [ai.id]: { skin: v } } })),
      )
      card.append(head, opts)
      aiSection.append(card)
    }

    // General
    const general = el('section', 'settings-section')
    general.append(el('h2', undefined, 'Général'))
    const box = el('div', 'settings-box')
    box.append(
      toggle('Fermer la fenêtre la garde dans la barre système', s.closeToTray, (v) => void this.patch({ closeToTray: v })),
    )
    const glassRow = el('div', 'field')
    glassRow.append(el('span', 'field-label', 'Effet de verre'))
    const seg = el('div', 'segmented')
    const choices: [GlassPreference, string][] = [
      ['auto', 'Auto'],
      ['glass', 'Verre'],
      ['solid', 'Opaque'],
    ]
    for (const [value, label] of choices) {
      const b = el('button', value === s.glass ? 'active' : '', label)
      b.type = 'button'
      b.setAttribute('aria-pressed', String(value === s.glass))
      b.addEventListener('click', async () => {
        await this.patch({ glass: value })
        this.render()
      })
      seg.append(b)
    }
    glassRow.append(seg)
    const note = el(
      'p',
      'field-note',
      `Actuellement : ${GLASS_LABEL[s.glassActive] ?? s.glassActive} (${s.glassReason}). Un changement s’applique au prochain lancement.`,
    )
    box.append(glassRow, note)
    general.append(box)

    // Files
    const files = el('section', 'settings-section')
    files.append(el('h2', undefined, 'Personnalisation'))
    const fbox = el('div', 'settings-box')
    const link = (icon: string, label: string, detail: string, which: 'config' | 'skins') => {
      const b = el('button', 'link-row')
      b.type = 'button'
      b.innerHTML = icon
      const text = el('span', 'link-text')
      text.append(el('span', 'link-label', label), el('span', 'link-detail', detail))
      b.append(text)
      b.addEventListener('click', () => api.openPath(which))
      return b
    }
    fbox.append(
      link(icons.file, 'Liste des IA (ais.json)', s.configPath, 'config'),
      link(icons.folder, 'Dossier d’habillages personnels', s.skinsPath, 'skins'),
    )
    files.append(fbox)

    body.append(aiSection, general, files)
    this.root.append(header, body)
  }
}
