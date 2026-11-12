import type { ShellState } from '../../shared/protocol'
import './styles/app.css'

const api = window.aicc
const list = document.getElementById('rail-list') as HTMLUListElement
const content = document.getElementById('content') as HTMLElement

let state: ShellState | null = null
const buttons = new Map<string, HTMLButtonElement>()

function buildRail(s: ShellState): void {
  list.replaceChildren()
  buttons.clear()
  s.ais.forEach((ai, i) => {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.className = 'rail-item'
    btn.type = 'button'
    btn.dataset.id = ai.id
    const mod = s.platform === 'darwin' ? '⌘' : 'Ctrl+'
    btn.title = i < 9 ? `${ai.name}  ${mod}${i + 1}` : ai.name
    btn.setAttribute('aria-label', ai.name)
    const img = document.createElement('img')
    img.src = ai.icon
    img.alt = ''
    img.draggable = false
    btn.append(img)
    btn.addEventListener('click', () => api.select(ai.id))
    li.append(btn)
    list.append(li)
    buttons.set(ai.id, btn)
  })
}

function render(s: ShellState): void {
  const structural = !state || state.ais.map((a) => a.id).join() !== s.ais.map((a) => a.id).join()
  state = s
  document.documentElement.dataset.platform = s.platform
  if (structural) buildRail(s)
  for (const [id, btn] of buttons) {
    const active = id === s.activeId
    btn.classList.toggle('active', active)
    btn.classList.toggle('loading', !!s.loading[id])
    if (active) btn.setAttribute('aria-current', 'page')
    else btn.removeAttribute('aria-current')
  }
}

// Tell main where AI views must be placed; it follows every resize of the content area.
function reportRect(): void {
  const r = content.getBoundingClientRect()
  api.setContentRect({ x: r.left, y: r.top, width: r.width, height: r.height })
}
new ResizeObserver(reportRect).observe(content)
window.addEventListener('resize', reportRect)

api.onState(render)
void api.getState().then((s) => {
  if (s) render(s)
  reportRect()
})
