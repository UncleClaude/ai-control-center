import type { ShellState } from '../../shared/protocol'
import { icons } from './icons'
import { SettingsPanel } from './settings'
import { playChime } from './sound'
import './styles/tokens.css'
import './styles/app.css'

const api = window.aicc
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const root = document.documentElement
const list = $<HTMLUListElement>('rail-list')
const indicator = $<HTMLDivElement>('rail-indicator')
const content = $<HTMLDivElement>('content')
const backBtn = $<HTMLButtonElement>('nav-back')
const forwardBtn = $<HTMLButtonElement>('nav-forward')
const reloadBtn = $<HTMLButtonElement>('nav-reload')
const maxBtn = $<HTMLButtonElement>('wc-max')
const railToggle = $<HTMLButtonElement>('rail-toggle')
const settingsBtn = $<HTMLButtonElement>('rail-settings')

backBtn.title = 'Précédent'
forwardBtn.title = 'Suivant'
reloadBtn.title = 'Recharger'
backBtn.innerHTML = icons.back
forwardBtn.innerHTML = icons.forward
reloadBtn.innerHTML = icons.reload
$('wc-min').innerHTML = icons.minimize
$('wc-close').innerHTML = icons.close

settingsBtn.innerHTML = icons.settings
settingsBtn.title = 'Réglages'
const settings = new SettingsPanel(
  $('settings'),
  () => state?.platform ?? 'linux',
  (open) => {
    root.classList.toggle('settings-open', open)
    settingsBtn.classList.toggle('active', open)
    placeIndicator()
  },
)
settingsBtn.addEventListener('click', () => settings.toggle())
api.onOpenSettings(() => void settings.show())

backBtn.addEventListener('click', () => api.nav('back'))
forwardBtn.addEventListener('click', () => api.nav('forward'))
reloadBtn.addEventListener('click', () => api.nav('reload'))
$('wc-min').addEventListener('click', () => api.windowControl('minimize'))
maxBtn.addEventListener('click', () => api.windowControl('maximize'))
$('wc-close').addEventListener('click', () => api.windowControl('close'))
// Double-click on empty title bar space toggles maximise, as on native windows.
document.querySelector('.titlebar')?.addEventListener('dblclick', (e) => {
  if ((e.target as HTMLElement).closest('button, .nav-pill')) return
  if (state?.platform !== 'darwin') api.windowControl('maximize')
})

// Expanded rail (icons + names) is a per-machine convenience.
const RAIL_KEY = 'aicc.railExpanded'
let railExpanded = false
try {
  railExpanded = localStorage.getItem(RAIL_KEY) === '1'
} catch {
  /* storage unavailable */
}
function applyRail(): void {
  root.dataset.rail = railExpanded ? 'expanded' : 'compact'
  railToggle.innerHTML = railExpanded ? icons.collapse : icons.expand
  railToggle.setAttribute('aria-label', railExpanded ? 'Masquer les noms' : 'Afficher les noms')
  railToggle.title = railToggle.getAttribute('aria-label') ?? ''
  requestAnimationFrame(placeIndicator)
}
railToggle.addEventListener('click', () => {
  railExpanded = !railExpanded
  try {
    localStorage.setItem(RAIL_KEY, railExpanded ? '1' : '0')
  } catch {
    /* ignore */
  }
  applyRail()
})
applyRail()

let state: ShellState | null = null
const buttons = new Map<string, HTMLButtonElement>()

function buildRail(s: ShellState): void {
  list.replaceChildren()
  buttons.clear()
  const mod = s.platform === 'darwin' ? '⌘' : 'Ctrl+'
  s.ais.forEach((ai, i) => {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.className = 'rail-item'
    btn.type = 'button'
    btn.dataset.id = ai.id
    btn.style.setProperty('--item-accent', ai.accent)
    btn.title = i < 9 ? `${ai.name}   ${mod}${i + 1}` : ai.name
    btn.setAttribute('aria-label', ai.name)

    const iconWrap = document.createElement('span')
    iconWrap.className = 'rail-icon'
    const img = document.createElement('img')
    img.src = ai.icon
    img.alt = ''
    img.draggable = false
    iconWrap.append(img)

    const label = document.createElement('span')
    label.className = 'rail-label'
    label.textContent = ai.name

    btn.append(iconWrap, label)
    btn.addEventListener('click', () => {
      settings.hide()
      api.select(ai.id)
    })
    li.append(btn)
    list.append(li)
    buttons.set(ai.id, btn)
  })
}

/** Slides the glass highlight under the active icon. */
function placeIndicator(): void {
  const btn = state?.activeId && !settings.isOpen ? buttons.get(state.activeId) : undefined
  if (!btn) {
    indicator.style.opacity = '0'
    return
  }
  indicator.style.opacity = '1'
  indicator.style.transform = `translateY(${btn.offsetTop}px)`
  indicator.style.height = `${btn.offsetHeight}px`
}

function render(s: ShellState): void {
  if (state && s.activeId !== state.activeId) settings.hide()
  const structural = !state || state.ais.map((a) => a.id).join() !== s.ais.map((a) => a.id).join()
  const first = !state
  state = s
  root.dataset.platform = s.platform
  root.dataset.glass = s.glass
  root.dataset.maximized = String(s.maximized || s.fullscreen)
  root.dataset.focused = String(s.focused)
  root.style.setProperty('--tint', `${s.appearance.tint}%`)
  root.dataset.motion = s.appearance.reduceMotion ? 'reduce' : 'full'
  if (structural) buildRail(s)

  for (const [id, btn] of buttons) {
    const active = id === s.activeId
    btn.classList.toggle('active', active)
    btn.classList.toggle('loading', !!s.loading[id])
    if (active) btn.setAttribute('aria-current', 'page')
    else btn.removeAttribute('aria-current')
    const count = s.badges[id] ?? 0
    // Unread answer: the icon breathes until the AI is viewed.
    btn.classList.toggle('unread', count > 0)
    const name = s.ais.find((a) => a.id === id)?.name ?? id
    btn.setAttribute('aria-label', count > 0 ? `${name} — réponse non lue` : name)
  }

  const active = s.ais.find((a) => a.id === s.activeId)
  if (active) {
    root.style.setProperty('--accent', active.accent)
  }
  root.classList.toggle('is-loading', !!(s.activeId && s.loading[s.activeId]))
  backBtn.disabled = !s.canGoBack
  forwardBtn.disabled = !s.canGoForward
  maxBtn.innerHTML = s.maximized ? icons.restore : icons.maximize
  maxBtn.setAttribute('aria-label', s.maximized ? 'Restaurer' : 'Agrandir')

  if (first) {
    // No slide on first paint.
    indicator.classList.add('no-anim')
    placeIndicator()
    requestAnimationFrame(() => requestAnimationFrame(() => indicator.classList.remove('no-anim')))
  } else placeIndicator()
}

// Tell main where the AI views go; follows resizes and the rail expand animation.
let rectQueued = false
function reportRect(): void {
  if (rectQueued) return
  rectQueued = true
  requestAnimationFrame(() => {
    rectQueued = false
    const r = content.getBoundingClientRect()
    api.setContentRect({ x: r.left, y: r.top, width: r.width, height: r.height })
  })
}
new ResizeObserver(reportRect).observe(content)
window.addEventListener('resize', () => {
  reportRect()
  placeIndicator()
})

api.onState(render)
api.onPlaySound(playChime)
void api.getState().then((s) => {
  if (s) render(s)
  reportRect()
})
