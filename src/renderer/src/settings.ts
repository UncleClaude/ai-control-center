import type { AiAction, AiPublic, AiSettings, BrowserInfo, GlassPreference, Platform, Settings, SettingsPatch, ThemePreference } from '../../shared/protocol'
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

function button(cls: string, html: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls)
  b.type = 'button'
  b.innerHTML = html
  b.setAttribute('aria-label', label)
  b.title = label
  b.addEventListener('click', onClick)
  return b
}

function pill(icon: string, text: string, title: string, onClick: (b: HTMLButtonElement) => void, cls = ''): HTMLButtonElement {
  const b = el('button', `pill-btn ${cls}`.trim())
  b.type = 'button'
  b.innerHTML = `${icon}<span>${text}</span>`
  b.title = title
  b.addEventListener('click', () => onClick(b))
  return b
}

function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, disabled = false): HTMLLabelElement {
  const row = el('label', 'switch')
  const input = el('input')
  input.type = 'checkbox'
  input.checked = checked
  input.disabled = disabled
  input.setAttribute('role', 'switch')
  input.addEventListener('change', () => onChange(input.checked))
  const track = el('span', 'switch-track')
  track.append(el('span', 'switch-thumb'))
  row.append(input, track, el('span', 'switch-label', label))
  if (disabled) row.style.opacity = '0.5'
  return row
}

function field(label: string, control: HTMLElement, disabled = false): HTMLDivElement {
  const row = el('div', disabled ? 'field disabled' : 'field')
  row.append(el('span', 'field-label', label), control)
  return row
}

function segmented<T extends string>(choices: [T, string][], value: T, onPick: (v: T) => void): HTMLDivElement {
  const seg = el('div', 'segmented')
  for (const [v, label] of choices) {
    const b = el('button', v === value ? 'active' : '', label)
    b.type = 'button'
    b.setAttribute('aria-pressed', String(v === value))
    b.addEventListener('click', () => onPick(v))
    seg.append(b)
  }
  return seg
}

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const s = el('section', 'settings-section')
  s.append(el('h2', undefined, title), ...children)
  return s
}

function box(...children: (HTMLElement | null)[]): HTMLDivElement {
  const b = el('div', 'settings-box')
  b.append(...children.filter((c): c is HTMLElement => c !== null))
  return b
}

/** Settings panel, shown over the content area (main hides the site views meanwhile). */
export class SettingsPanel {
  private open = false
  private settings: Settings | null = null
  private body: HTMLDivElement | null = null
  private browsers: BrowserInfo[] = []

  constructor(
    private readonly root: HTMLElement,
    private readonly platform: () => Platform,
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
    this.settings = await api.getSettings()
    this.browsers = await api.listBrowsers().catch(() => [])
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

  /** Saves a change; `rerender` redraws the panel (for controls whose neighbours depend on it). */
  private async patch(p: SettingsPatch, rerender = true): Promise<void> {
    this.settings = await api.setSettings(p)
    if (rerender) this.render()
  }

  private patchAi(id: string, p: SettingsPatch['ai'] extends Record<string, infer T> | undefined ? T : never, rerender = true) {
    return this.patch({ ai: { [id]: p } }, rerender)
  }

  private render(): void {
    const s = this.settings
    if (!s) return
    // Keep the scroll position across redraws.
    const scroll = this.body?.scrollTop ?? 0
    this.root.replaceChildren()

    const header = el('header', 'settings-header')
    header.append(el('h1', undefined, 'Réglages'), button('icon-btn', icons.close, 'Fermer (Échap)', () => this.hide()))

    const body = el('div', 'settings-body')
    body.append(
      this.aiSection(s),
      this.appearanceSection(s),
      this.notificationsSection(s),
      this.startupSection(s),
      this.filesSection(s),
      this.aboutSection(s),
    )
    this.root.append(header, body)
    this.body = body
    body.scrollTop = scroll
  }

  // ---------- Sections ----------

  private aiSection(s: Settings): HTMLElement {
    const cards = s.ais.map((ai, i) => this.aiCard(s, ai, s.ai[ai.id], i))
    const note = el('p', 'field-note', 'L’ordre détermine aussi les raccourcis (Ctrl+1, Ctrl+2…). Une IA masquée n’est pas chargée.')
    return section('Intelligences artificielles', ...cards, note)
  }

  private aiCard(s: Settings, ai: AiPublic, prefs: AiSettings, index: number): HTMLElement {
    const card = el('div', prefs.enabled ? 'ai-card' : 'ai-card hidden-ai')
    card.style.setProperty('--card-accent', prefs.accent)

    const head = el('div', 'ai-card-head')
    const img = el('img')
    img.src = ai.icon
    img.alt = ''
    const order = el('div', 'order-btns')
    const move = (delta: number) => {
      const next = [...s.order]
      const [id] = next.splice(index, 1)
      next.splice(index + delta, 0, id)
      void this.patch({ order: next })
    }
    const up = button('icon-btn', icons.up, `Monter ${ai.name}`, () => move(-1))
    const down = button('icon-btn', icons.down, `Descendre ${ai.name}`, () => move(1))
    up.disabled = index === 0
    down.disabled = index === s.ais.length - 1
    order.append(up, down)
    const visibleCount = Object.values(s.ai).filter((a) => a.enabled).length
    head.append(
      img,
      el('span', 'ai-card-name', ai.name),
      order,
      toggle(
        'Afficher',
        prefs.enabled,
        (v) => void this.patchAi(ai.id, { enabled: v }),
        prefs.enabled && visibleCount <= 1,
      ),
    )
    card.append(head)

    const opts = el('div', 'ai-card-options')
    opts.append(
      toggle('Notifications', prefs.notifications, (v) => void this.patchAi(ai.id, { notifications: v }, false)),
      toggle('Son', prefs.sound, (v) => void this.patchAi(ai.id, { sound: v }, false)),
      toggle('Habillage aux couleurs de l’app', prefs.skin, (v) => void this.patchAi(ai.id, { skin: v }, false)),
    )
    card.append(opts)

    // Accent colour + zoom
    const look = el('div', 'ai-card-row')
    const color = el('input', 'color-input')
    color.type = 'color'
    color.value = prefs.accent
    color.title = 'Couleur de l’IA (rail, teinte de la fenêtre et du site)'
    color.setAttribute('aria-label', `Couleur de ${ai.name}`)
    let colorTimer: number | undefined
    color.addEventListener('input', () => {
      card.style.setProperty('--card-accent', color.value)
      window.clearTimeout(colorTimer)
      colorTimer = window.setTimeout(() => void this.patchAi(ai.id, { accent: color.value }, false), 120)
    })
    color.addEventListener('change', () => void this.patchAi(ai.id, { accent: color.value }))
    const colorWrap = el('span', 'field-control')
    colorWrap.append(el('span', 'mini-label', 'Couleur'), color)
    if (prefs.accentCustom) {
      colorWrap.append(button('icon-btn', icons.undo, 'Couleur d’origine', () => void this.patchAi(ai.id, { accent: null })))
    }

    const zoom = el('span', 'zoom')
    const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    const at = Math.max(0, STEPS.findIndex((z) => z >= prefs.zoom - 0.001))
    const setZoom = (z: number) => void this.patchAi(ai.id, { zoom: z })
    const minus = button('icon-btn', icons.minus, 'Zoom arrière', () => setZoom(STEPS[Math.max(0, at - 1)]))
    const plus = button('icon-btn', icons.plus, 'Zoom avant', () => setZoom(STEPS[Math.min(STEPS.length - 1, at + 1)]))
    const value = el('button', 'icon-btn zoom-value', `${Math.round(prefs.zoom * 100)} %`)
    value.type = 'button'
    value.title = 'Taille réelle (100 %)'
    value.addEventListener('click', () => setZoom(1))
    minus.disabled = at === 0
    plus.disabled = at === STEPS.length - 1
    zoom.append(minus, value, plus)
    const zoomWrap = el('span', 'field-control')
    zoomWrap.append(el('span', 'mini-label', 'Zoom'), zoom)
    look.append(colorWrap, zoomWrap)
    card.append(look)

    // Actions
    const actions = el('div', 'ai-card-row')
    actions.append(
      pill(icons.bell, 'Tester', 'Afficher une notification de test', () => api.testNotification(ai.id)),
      el('span', 'spacer'),
      this.actionButton(ai, 'clear-cache', icons.trash, 'Vider le cache', 'Vide le cache et recharge la page (la connexion est conservée)'),
      this.actionButton(ai, 'sign-out', icons.logout, 'Se déconnecter', 'Efface cookies et données du site : vous devrez vous reconnecter'),
    )
    card.append(this.loginRow(ai), actions)
    return card
  }

  /** Browser-login hand-off: sign in in the real browser, then import that site's session cookies. */
  private loginRow(ai: AiPublic): HTMLElement {
    const row = el('div', 'ai-card-row login-row')

    const open = pill(icons.globe, 'Se connecter via le navigateur', 'Ouvre la page de connexion dans votre navigateur par défaut', () =>
      api.browserLogin(ai.id),
    )

    const status = el('span', 'login-status')
    const setStatus = (text: string, cls = '') => {
      status.textContent = text
      status.className = `login-status ${cls}`.trim()
    }

    const importWrap = el('span', 'field-control')
    if (this.browsers.length === 0) {
      setStatus('Aucun navigateur détecté pour l’import.', 'muted')
      row.append(open, el('span', 'spacer'), status)
      return row
    }

    const select = el('select', 'select')
    select.setAttribute('aria-label', `Navigateur à importer pour ${ai.name}`)
    for (const b of this.browsers) {
      const o = el('option', undefined, b.label)
      o.value = b.id
      select.append(o)
    }
    const doImport = pill(icons.download, 'Importer ma session', 'Lit les cookies de ce site depuis le navigateur choisi', async (b) => {
      b.disabled = true
      const label = b.querySelector('span')!
      const prev = label.textContent
      label.textContent = 'Import…'
      setStatus('')
      try {
        const res = await api.importCookies(ai.id, select.value)
        if (res.imported > 0) setStatus(`${res.imported} cookie${res.imported > 1 ? 's' : ''} importé${res.imported > 1 ? 's' : ''}, la page se recharge.`, 'ok')
        else setStatus(res.error ?? 'Rien à importer.', 'warn')
      } catch {
        setStatus('Échec de l’import.', 'warn')
      }
      label.textContent = prev
      b.disabled = false
    })
    importWrap.append(el('span', 'mini-label', 'Importer depuis'), select, doImport)
    row.append(open, importWrap, status)
    return row
  }

  /** Cache / sign-out buttons. Sign-out asks for a second click within 4 s. */
  private actionButton(ai: AiPublic, action: AiAction, icon: string, text: string, title: string): HTMLButtonElement {
    const destructive = action === 'sign-out'
    let armed = false
    let timer: number | undefined
    const label = (b: HTMLButtonElement, t: string) => (b.querySelector('span')!.textContent = t)
    return pill(
      icon,
      text,
      title,
      async (b) => {
        if (destructive && !armed) {
          armed = true
          b.classList.add('confirm')
          label(b, `Effacer ${ai.name} ?`)
          timer = window.setTimeout(() => {
            armed = false
            b.classList.remove('confirm')
            label(b, text)
          }, 4000)
          return
        }
        window.clearTimeout(timer)
        armed = false
        b.classList.remove('confirm')
        b.disabled = true
        const ok = await api.aiAction(ai.id, action)
        b.disabled = false
        b.classList.add('done')
        label(b, ok ? (destructive ? 'Déconnecté' : 'Cache vidé') : 'Échec')
        window.setTimeout(() => {
          b.classList.remove('done')
          label(b, text)
        }, 2500)
      },
      destructive ? 'danger' : '',
    )
  }

  private appearanceSection(s: Settings): HTMLElement {
    const theme = segmented<ThemePreference>(
      [
        ['system', 'Système'],
        ['light', 'Clair'],
        ['dark', 'Sombre'],
      ],
      s.theme,
      (v) => void this.patch({ theme: v }),
    )

    const range = el('input', 'range')
    range.type = 'range'
    range.min = '0'
    range.max = '30'
    range.step = '1'
    range.value = String(s.tint)
    range.setAttribute('aria-label', 'Intensité de la teinte')
    const value = el('span', 'range-value', `${s.tint} %`)
    let timer: number | undefined
    range.addEventListener('input', () => {
      value.textContent = `${range.value} %`
      document.documentElement.style.setProperty('--tint', `${range.value}%`)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void this.patch({ tint: Number(range.value) }, false), 150)
    })
    const tint = el('span', 'field-control')
    tint.append(range, value)

    const glass = segmented<GlassPreference>(
      [
        ['auto', 'Auto'],
        ['glass', 'Verre'],
        ['solid', 'Opaque'],
      ],
      s.glass,
      (v) => void this.patch({ glass: v }),
    )
    const note = el(
      'p',
      'field-note',
      `Effet de verre actuel : ${GLASS_LABEL[s.glassActive] ?? s.glassActive} (${s.glassReason}). Il change au prochain lancement.`,
    )
    return section(
      'Apparence',
      box(
        field('Thème', theme),
        field('Teinte des surfaces', tint),
        field('Effet de verre', glass),
        note,
        toggle('Réduire les animations', s.reduceMotion, (v) => void this.patch({ reduceMotion: v }, false)),
      ),
    )
  }

  private notificationsSection(s: Settings): HTMLElement {
    return section(
      'Notifications',
      box(
        toggle('Ne pas déranger', s.doNotDisturb, (v) => void this.patch({ doNotDisturb: v }, false)),
        el('p', 'field-note', 'Aucune notification ni son ; les icônes respirent toujours pour signaler une réponse non lue. Aussi dans le menu de la barre système.'),
      ),
    )
  }

  private startupSection(s: Settings): HTMLElement {
    const unsupported = s.launchUnsupported
    const startAi = el('select', 'select')
    startAi.setAttribute('aria-label', 'IA ouverte au démarrage')
    const opt = (value: string, label: string) => {
      const o = el('option', undefined, label)
      o.value = value
      o.selected = value === s.startupAi
      return o
    }
    startAi.append(opt('last', 'La dernière utilisée'), ...s.ais.filter((a) => s.ai[a.id]?.enabled).map((a) => opt(a.id, a.name)))
    startAi.addEventListener('change', () => void this.patch({ startupAi: startAi.value }, false))

    const key = el('input', 'text-input')
    key.type = 'text'
    key.value = s.globalShortcutKey
    key.spellcheck = false
    key.setAttribute('aria-label', 'Combinaison du raccourci global')
    key.placeholder = 'CommandOrControl+Shift+Space'
    const commit = () => {
      const v = key.value.trim()
      if (v && v !== s.globalShortcutKey) void this.patch({ globalShortcutKey: v })
    }
    key.addEventListener('change', commit)
    key.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
    })

    const shortcutNote = s.globalShortcut && s.globalShortcutError
      ? el('p', 'field-note warn', `Raccourci non enregistré : ${s.globalShortcutError}.`)
      : el(
          'p',
          'field-note',
          this.platform() === 'linux'
            ? 'Fonctionne partout, même fenêtre masquée. Sous Wayland, KDE ou Hyprland peuvent demander une confirmation la première fois.'
            : 'Fonctionne partout, même fenêtre masquée.',
        )

    return section(
      'Démarrage et fenêtre',
      box(
        toggle(
          'Lancer à l’ouverture de session',
          s.launchAtLogin,
          (v) => void this.patch({ launchAtLogin: v }),
          !!unsupported,
        ),
        toggle(
          'Démarrer masqué dans la barre système',
          s.startHidden,
          (v) => void this.patch({ startHidden: v }, false),
          !!unsupported || !s.launchAtLogin,
        ),
        unsupported ? el('p', 'field-note', `Lancement automatique : ${unsupported}.`) : null,
        field('IA au démarrage', startAi),
        toggle('Fermer la fenêtre la garde dans la barre système', s.closeToTray, (v) => void this.patch({ closeToTray: v }, false)),
        toggle('Raccourci global pour afficher / masquer', s.globalShortcut, (v) => void this.patch({ globalShortcut: v })),
        field('Combinaison', key, !s.globalShortcut),
        shortcutNote,
      ),
    )
  }

  private filesSection(s: Settings): HTMLElement {
    const link = (icon: string, label: string, detail: string, which: 'config' | 'skins' | 'data') => {
      const b = el('button', 'link-row')
      b.type = 'button'
      b.innerHTML = icon
      const text = el('span', 'link-text')
      text.append(el('span', 'link-label', label), el('span', 'link-detail', detail))
      b.append(text)
      b.addEventListener('click', () => api.openPath(which))
      return b
    }
    return section(
      'Fichiers',
      box(
        link(icons.file, 'Liste des IA (ais.json)', s.configPath, 'config'),
        link(icons.folder, 'Dossier d’habillages personnels', s.skinsPath, 'skins'),
        link(icons.folder, 'Dossier des données de l’app', s.dataPath, 'data'),
      ),
    )
  }

  private aboutSection(s: Settings): HTMLElement {
    const mac = this.platform() === 'darwin'
    const m = mac ? '⌘' : 'Ctrl+'
    const rows: [string, string][] = [
      [`${m}1 … ${m}9`, 'Aller à l’IA n°1 … 9'],
      [`${m}R  ·  F5`, 'Recharger (avec Maj : sans cache)'],
      [mac ? '⌘[  ·  ⌘]' : 'Ctrl+[  ·  Ctrl+]  ·  Alt+←/→', 'Précédent / suivant'],
      [`${m}=  ·  ${m}-  ·  ${m}0`, 'Zoom avant / arrière / taille réelle de l’IA affichée'],
      [`${m},`, 'Réglages'],
      [mac ? '⌥⌘I' : 'F12', 'Outils de développement du site'],
      [mac ? '⌘Q' : 'Ctrl+Q', 'Quitter'],
    ]
    const dl = el('dl', 'shortcut-list')
    for (const [k, v] of rows) dl.append(el('dt', undefined, k), el('dd', undefined, v))
    return section(
      'Raccourcis et version',
      box(
        dl,
        el('p', 'about-line', `AI Control Center ${s.version} · Electron ${s.versions.electron} · Chromium ${s.versions.chrome}`),
      ),
    )
  }
}
