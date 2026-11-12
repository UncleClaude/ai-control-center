import type { AdapterEvent, AdapterSpec } from './types'

type Emit = (event: AdapterEvent) => void
type Log = (level: 'info' | 'warn', message: string) => void

const SETTLE_MS = 1500 // generation must stay stopped this long (agents pause between tool calls)
const LOAD_GRACE_MS = 5000 // ignore activity right after a navigation (history rendering)
const HEALTH_DELAY_MS = 12000
const SNIPPET = 160

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Screen-reader labels and UI chrome that are not part of the answer. */
const NOISE = '.sr-only, [class~="sr-only"], .visually-hidden, button, [role="toolbar"], [role="button"], svg, style, script'
/** "ChatGPT said:", "Claude responded:"… prefixes some sites put in front of each message. */
const SPEAKER = /^\s*[\p{L}\p{N} .'-]{1,30}\s(said|responded|says|wrote|a dit|a répondu|répond)\s*:\s*/iu
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, tr, br, div'

/** The answer's own text: labels and buttons stripped, block boundaries kept as spaces. */
function cleanText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll(NOISE).forEach((n) => n.remove())
  clone.querySelectorAll(BLOCKS).forEach((n) => n.append(' '))
  return normalise(clone.textContent ?? '').replace(SPEAKER, '')
}

/** Message text; when the matched element only holds a label, use its whole turn. */
function textOf(el: Element | null | undefined): string {
  if (!el) return ''
  const own = cleanText(el)
  if (own.length >= 3) return own
  const turn = el.closest('[data-turn-key], [data-testid^="conversation-turn"], article') ?? el.parentElement
  return turn ? cleanText(turn) : own
}

/** Short, stable fingerprint of a message, so a new answer never looks like the previous one. */
function fingerprint(text: string): string {
  let h = 0
  for (let i = 0; i < Math.min(text.length, 200); i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function excerpt(text: string, fromEnd: boolean): string {
  const t = normalise(text)
  if (t.length <= SNIPPET) return t
  return fromEnd ? `…${t.slice(-SNIPPET + 1)}` : `${t.slice(0, SNIPPET - 1)}…`
}

/** The answer ends with a question (also French " ?"). */
function endsWithQuestion(text: string): boolean {
  return /\?\s*[)"»”'*_]*\s*$/.test(text)
}

/**
 * Watches one AI page and reports when a response finishes ("done") or when the AI waits for the
 * user ("needs-input"). Pure DOM observation, no network access.
 *
 * Detection, in order of confidence:
 *   1. the adapter's "generating" selectors (stop button, streaming flags) appear then disappear;
 *   2. fallback: the last assistant message keeps growing (streaming text) then stops.
 * needs-input = approval selectors / buttons, answer choices in the message, or a final question.
 */
export function runAdapter(spec: AdapterSpec, emit: Emit, log: Log): void {
  let generating = false
  let viaFallback = false
  let stoppedAt = 0
  let navigatedAt = Date.now()
  let lastUrl = location.href
  let reportedActionKey = ''
  const usedFallback = new Set<string>()

  // Text-growth fallback state.
  let lastLength = -1
  let growth: number[] = []

  const first = (selectors: string[], root: ParentNode = document): { el: Element; index: number } | null => {
    for (let i = 0; i < selectors.length; i++) {
      try {
        const el = root.querySelector(selectors[i])
        if (el) return { el, index: i }
      } catch {
        /* invalid selector: ignored, reported by health check */
      }
    }
    return null
  }

  const lastAssistant = (): Element | null => {
    for (let i = 0; i < spec.assistantMessage.length; i++) {
      const all = document.querySelectorAll(spec.assistantMessage[i])
      if (all.length) {
        noteFallback('assistantMessage', i)
        return all[all.length - 1]
      }
    }
    return null
  }

  const noteFallback = (field: string, index: number) => {
    if (index === 0 || usedFallback.has(field) || spec.ignorePaths?.test(location.pathname)) return
    usedFallback.add(field)
    log('info', `${field} : sélecteur principal introuvable, repli n°${index} utilisé (${spec.name})`)
  }

  const keyFor = (msg: Element | null): string => {
    const count = spec.assistantMessage.reduce((n, s) => n || document.querySelectorAll(s).length, 0)
    const turn = msg?.closest('[data-turn-key]')?.getAttribute('data-turn-key') ?? ''
    const print = msg ? fingerprint(textOf(msg)) : ''
    return `${location.pathname}#${count}${turn ? `:${turn}` : ''}${print ? `~${print}` : ''}`
  }

  const approvalVisible = (): boolean => {
    if (first(spec.actionRequired)) return true
    if (!spec.approvalButtonText) return false
    const scope = lastAssistant()?.parentElement?.parentElement ?? document.body
    return [...scope.querySelectorAll('button')].some(
      (b) => (b as HTMLElement).offsetParent !== null && spec.approvalButtonText!.test(normalise(b.textContent ?? '')),
    )
  }

  const needsInput = (msg: Element | null): boolean => {
    if (approvalVisible()) return true
    if (!msg) return false
    const text = textOf(msg)
    // Answer buttons count only alongside a question: sites also show follow-up suggestions.
    if (spec.choiceButtons && text.slice(-400).includes('?')) {
      const scope = msg.parentElement ?? msg
      for (const s of spec.choiceButtons) if (scope.querySelectorAll(s).length >= 2) return true
    }
    return endsWithQuestion(text)
  }

  const finish = () => {
    generating = false
    const msg = lastAssistant()
    const wait = needsInput(msg)
    const text = textOf(msg)
    if (!msg) log('warn', `assistantMessage introuvable à la fin d'une réponse — essayés : ${spec.assistantMessage.join(' | ')}`)
    const key = keyFor(msg)
    if (wait) reportedActionKey = key
    emit({ kind: wait ? 'needs-input' : 'done', snippet: excerpt(text, wait), key, url: location.href })
  }

  const evaluate = () => {
    const now = Date.now()
    if (location.href !== lastUrl) {
      lastUrl = location.href
      navigatedAt = now
      lastLength = -1
      growth = []
      window.setTimeout(healthCheck, HEALTH_DELAY_MS)
    }
    const settled = now - navigatedAt > LOAD_GRACE_MS

    const hit = first(spec.generating)
    if (hit) noteFallback('generating', hit.index)
    let active = !!hit

    // Fallback: streaming text in the last assistant message.
    const msg = lastAssistant()
    const length = msg ? (msg.textContent ?? '').length : 0
    if (lastLength >= 0 && length > lastLength && settled) growth.push(now)
    lastLength = length
    growth = growth.filter((t) => now - t < 4000)
    const growing = growth.length >= 3 && now - growth[growth.length - 1] < 1800
    if (!active && growing) {
      active = true
      if (!viaFallback) log('info', `génération détectée par la croissance du texte (aucun sélecteur "generating" ne correspond) — ${spec.name}`)
      viaFallback = true
    }

    if (active) {
      stoppedAt = 0
      // Explicit signals count at once; the text-growth fallback only once the page has settled.
      if (!generating && (hit || settled)) {
        generating = true
        emit({ kind: 'generating', snippet: '', key: keyFor(msg), url: location.href })
      }
    } else if (generating) {
      if (!stoppedAt) stoppedAt = now
      if (now - stoppedAt >= SETTLE_MS) finish()
      else schedule(SETTLE_MS - (now - stoppedAt) + 50)
    } else if (settled) {
      // An approval request can show up on its own (agent paused waiting for the user).
      const key = keyFor(msg)
      if (key !== reportedActionKey && approvalVisible()) {
        reportedActionKey = key
        emit({ kind: 'needs-input', snippet: excerpt(textOf(msg), true), key, url: location.href })
      }
    }
  }

  let timer: number | null = null
  const schedule = (delay = 250) => {
    if (timer !== null) return
    timer = window.setTimeout(() => {
      timer = null
      evaluate()
    }, delay)
  }

  const start = () => {
    new MutationObserver(() => schedule()).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-is-streaming', 'data-talvt-turn-state', 'data-perf-row-streaming', 'aria-busy', 'aria-label', 'data-testid', 'disabled'],
    })
    // Heartbeat: catches the end of a generation even if the last mutation was the stop button.
    window.setInterval(evaluate, 1000)
    window.addEventListener('popstate', () => schedule())
    window.setTimeout(healthCheck, HEALTH_DELAY_MS)
  }

  const warned = new Set<string>()
  const healthCheck = () => {
    if (spec.ignorePaths?.test(location.pathname)) return
    const composer = first(spec.composer)
    if (composer) {
      noteFallback('composer', composer.index)
      return
    }
    // No input at all = not a chat page (signed out, landing page): nothing to report. An input
    // that our selectors miss means the site changed and this adapter needs updating.
    const someInput = document.querySelector('textarea, [contenteditable="true"], [contenteditable=""]')
    if (!someInput || warned.has('composer')) return
    warned.add('composer')
    log(
      'warn',
      `zone de saisie non reconnue — sélecteurs essayés : ${spec.composer.join(' | ')}. L'interface du site a sans doute changé : mettez à jour src/adapters/${spec.name}.ts`,
    )
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}
