import type { AddAiSpec, AiAction, AiPublic, AiSettings, GlassPreference, Platform, Settings, SettingsPatch, ThemePreference } from '../../shared/protocol'
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

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('lecture impossible'))
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('image illisible'))
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

/** Fraction of nearly-transparent pixels, to tell a logo-with-background from a cut-out glyph. */
function transparentFraction(img: HTMLImageElement): number {
  const n = 48
  const c = el('canvas')
  c.width = n
  c.height = n
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  ctx.drawImage(img, 0, 0, n, n)
  let transparent = 0
  try {
    const d = ctx.getImageData(0, 0, n, n).data
    for (let i = 3; i < d.length; i += 4) if (d[i] < 24) transparent++
  } catch {
    return 0
  }
  return transparent / (n * n)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Processes any uploaded image into the app's icon style: a rounded square "bubble" matching the
 * built-in logos. An image that already has its own background fills the bubble (cover); a cut-out
 * glyph is centred with padding on the AI's accent colour. Returns a 256×256 PNG data URL.
 */
async function bubbleIcon(file: File, accent: string): Promise<string> {
  const img = await loadImage(file)
  const size = 256
  const canvas = el('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas indisponible')
  ctx.imageSmoothingQuality = 'high'
  // Same corner radius as the bundled SVGs (rx 16 on a 64 viewBox = 25 %).
  roundRect(ctx, 0, 0, size, size, size * 0.25)
  ctx.clip()

  const w0 = img.naturalWidth || img.width
  const h0 = img.naturalHeight || img.height
  const cutOut = transparentFraction(img) > 0.06
  if (cutOut) {
    ctx.fillStyle = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#3a3f47'
    ctx.fillRect(0, 0, size, size)
    const box = size * 0.62
    const scale = Math.min(box / w0, box / h0)
    const w = w0 * scale
    const h = h0 * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  } else {
    // Cover: fill the bubble edge-to-edge, cropping the overflow.
    const scale = Math.max(size / w0, size / h0)
    const w = w0 * scale
    const h = h0 * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
  }
  return canvas.toDataURL('image/png')
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
      this.updatesSection(s),
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
    return section('Intelligences artificielles', ...cards, this.addAiBox(s), note)
  }

  /** Mutating call (add / remove / rename). On success redraws from the returned settings. */
  private async mutateAi(run: () => Promise<{ settings: Settings; error?: string }>, onError?: (msg: string) => void): Promise<void> {
    const r = await run()
    if (r.error) onError?.(r.error)
    else {
      this.settings = r.settings
      this.render()
    }
  }

  private addAiBox(s: Settings): HTMLElement {
    // Instance: a second, independently-logged-in copy of an existing AI.
    const baseSel = el('select', 'select')
    baseSel.setAttribute('aria-label', 'IA à dupliquer')
    for (const a of s.ais) {
      const o = el('option', undefined, a.name)
      o.value = a.id
      baseSel.append(o)
    }
    const instName = el('input', 'text-input')
    instName.type = 'text'
    instName.placeholder = 'Nom (ex. Claude Travail)'
    instName.maxLength = 60
    const instErr = el('p', 'field-note warn')
    instErr.hidden = true
    const instBtn = pill(icons.plus, 'Dupliquer', 'Créer une autre instance avec sa propre connexion', (b) => {
      b.disabled = true
      void this.mutateAi(
        () => api.addAi({ kind: 'instance', baseId: baseSel.value, name: instName.value.trim() || undefined }),
        (msg) => {
          b.disabled = false
          instErr.textContent = msg
          instErr.hidden = false
        },
      )
    })
    const instRow = el('div', 'add-ai-row')
    instRow.append(baseSel, instName, instBtn)

    // Custom: any web service (OpenWebUI, openclaw, LibreChat…) by its address.
    const custName = el('input', 'text-input')
    custName.type = 'text'
    custName.placeholder = 'Nom (ex. OpenWebUI)'
    custName.maxLength = 60
    const custUrl = el('input', 'text-input')
    custUrl.type = 'url'
    custUrl.placeholder = 'https://chat.exemple.com'
    custUrl.maxLength = 300
    const custErr = el('p', 'field-note warn')
    custErr.hidden = true
    const custBtn = pill(icons.plus, 'Ajouter', 'Ajouter un service web personnalisé', (b) => {
      b.disabled = true
      void this.mutateAi(
        () => api.addAi({ kind: 'custom', name: custName.value, url: custUrl.value } satisfies AddAiSpec),
        (msg) => {
          b.disabled = false
          custErr.textContent = msg
          custErr.hidden = false
        },
      )
    })
    const custRow = el('div', 'add-ai-row')
    custRow.append(custName, custUrl, custBtn)

    const wrap = el('div', 'add-ai')
    wrap.append(
      el('h3', 'add-ai-title', 'Nouvelle instance (connexion séparée)'),
      el('p', 'field-note', 'Une deuxième connexion à la même IA — un Claude perso et un Claude travail, par exemple.'),
      instRow,
      instErr,
      el('h3', 'add-ai-title', 'Service personnalisé'),
      el('p', 'field-note', 'Ajoute n’importe quel service web (OpenWebUI, openclaw, LibreChat…) par son adresse. Connexion Google/Apple gérée comme pour les autres.'),
      custRow,
      custErr,
    )
    return box(wrap)
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
      this.editableName(ai),
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
    // Logo: pick an image, resized into a bubble matching the other icons.
    const fileInput = el('input')
    fileInput.type = 'file'
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
    fileInput.hidden = true
    const changeBtn = button('icon-btn', icons.image, 'Changer le logo', () => fileInput.click())
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0]
      if (!f) return
      changeBtn.disabled = true
      try {
        const dataUrl = await bubbleIcon(f, prefs.accent)
        await this.mutateAi(() => api.setAiIcon(ai.id, dataUrl), () => (changeBtn.disabled = false))
      } catch {
        changeBtn.disabled = false
        changeBtn.classList.add('danger')
        window.setTimeout(() => changeBtn.classList.remove('danger'), 2000)
      }
      fileInput.value = ''
    })
    const logoWrap = el('span', 'field-control')
    logoWrap.append(el('span', 'mini-label', 'Logo'), changeBtn, fileInput)
    if (prefs.iconCustom) {
      logoWrap.append(button('icon-btn', icons.undo, 'Logo d’origine', () => void this.mutateAi(() => api.setAiIcon(ai.id, null))))
    }
    look.append(colorWrap, zoomWrap, logoWrap)
    card.append(look)

    // Actions
    const actions = el('div', 'ai-card-row')
    actions.append(
      pill(icons.bell, 'Tester', 'Afficher une notification de test', () => api.testNotification(ai.id)),
      el('span', 'spacer'),
      this.actionButton(ai, 'clear-cache', icons.trash, 'Vider le cache', 'Vide le cache et recharge la page (la connexion est conservée)'),
      this.actionButton(ai, 'sign-out', icons.logout, 'Se déconnecter', 'Efface cookies et données du site : vous devrez vous reconnecter'),
    )
    if (!prefs.builtIn) actions.append(this.deleteButton(ai))
    card.append(actions)
    return card
  }

  /** The AI name, click (or Enter) to rename in place. */
  private editableName(ai: AiPublic): HTMLElement {
    const span = el('span', 'ai-card-name editable', ai.name)
    span.title = 'Cliquer pour renommer'
    span.tabIndex = 0
    span.setAttribute('role', 'button')
    const start = () => {
      const input = el('input', 'ai-name-input')
      input.type = 'text'
      input.value = ai.name
      input.maxLength = 60
      input.setAttribute('aria-label', `Renommer ${ai.name}`)
      let done = false
      const finish = (save: boolean) => {
        if (done) return
        done = true
        const v = input.value.trim()
        if (save && v && v !== ai.name) void this.mutateAi(() => api.renameAi(ai.id, v))
        else this.render()
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.stopPropagation()
          finish(false)
        }
      })
      input.addEventListener('blur', () => finish(true))
      span.replaceWith(input)
      input.focus()
      input.select()
    }
    span.addEventListener('click', start)
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        start()
      }
    })
    return span
  }

  /** Delete button for a user-added AI: asks for a second click within 4 s. */
  private deleteButton(ai: AiPublic): HTMLButtonElement {
    let armed = false
    let timer: number | undefined
    const label = (b: HTMLButtonElement, t: string) => (b.querySelector('span')!.textContent = t)
    return pill(
      icons.trash,
      'Supprimer',
      'Supprimer cette IA et toutes ses données',
      (b) => {
        if (!armed) {
          armed = true
          b.classList.add('confirm')
          label(b, `Supprimer ${ai.name} ?`)
          timer = window.setTimeout(() => {
            armed = false
            b.classList.remove('confirm')
            label(b, 'Supprimer')
          }, 4000)
          return
        }
        window.clearTimeout(timer)
        armed = false
        b.disabled = true
        void this.mutateAi(
          () => api.removeAi(ai.id),
          (msg) => {
            b.disabled = false
            b.classList.remove('confirm')
            label(b, msg.slice(0, 20))
          },
        )
      },
      'danger',
    )
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

  private updatesSection(s: Settings): HTMLElement {
    const status = el('p', 'field-note')
    const check = pill(icons.reload, 'Vérifier maintenant', 'Chercher une nouvelle version sur GitHub', async (b) => {
      b.disabled = true
      const label = b.querySelector('span')!
      const prev = label.textContent
      label.textContent = 'Vérification…'
      status.className = 'field-note'
      status.textContent = ''
      try {
        const { update, error } = await api.checkUpdate()
        if (error) {
          status.textContent = `Vérification impossible : ${error}`
        } else if (!update) {
          status.textContent = `Vous avez la dernière version (${s.version}).`
        } else {
          status.textContent = `Version ${update.version} disponible.`
          const install = pill(
            icons.download,
            update.selfInstall ? 'Installer et redémarrer' : 'Télécharger',
            'Installer la mise à jour',
            async (ib) => {
              ib.disabled = true
              ib.querySelector('span')!.textContent = 'Téléchargement…'
              const res = await api.applyUpdate()
              if (res.error) ib.querySelector('span')!.textContent = `Échec : ${res.error}`
              else if (res.result === 'quit') status.textContent = 'Installation… l’app va redémarrer.'
              else if (res.result === 'opened') status.textContent = 'Le dmg s’ouvre : glissez l’app dans Applications.'
              else if (res.result === 'page') status.textContent = 'Page de téléchargement ouverte dans le navigateur.'
            },
          )
          status.after(install)
        }
      } catch {
        status.textContent = 'Vérification impossible.'
      }
      label.textContent = prev
      b.disabled = false
    })
    const row = el('div', 'ai-card-row')
    row.style.marginTop = '0'
    row.style.borderTop = '0'
    row.style.paddingTop = '0'
    row.append(check)
    return section(
      'Mises à jour',
      box(
        toggle('Vérifier les mises à jour au démarrage', s.autoUpdate, (v) => void this.patch({ autoUpdate: v }, false)),
        el('p', 'field-note', `Version actuelle : ${s.version}. Les mises à jour viennent des releases GitHub du projet.`),
        row,
        status,
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
